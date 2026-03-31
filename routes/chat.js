'use strict';

const express                                = require('express');
const { ConverseStreamCommand }              = require('@aws-sdk/client-bedrock-runtime');
const { buildClient, buildConverseMessages } = require('../lib/bedrock');
const { optimizeContext }                    = require('../lib/context');

const router = express.Router();

router.post('/stream', express.json({ limit: '50mb' }), async (req, res) => {
  const {
    messages, systemPrompt, modelId, region, apiKey,
    extendedThinking, thinkingBudget, maxTokens, temperature,
    contextRecentCount, contextMaxMessages,
  } = req.body;

  // ── FIX: Basic request validation ──────────────────────────────────────
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing apiKey' });
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing or empty messages array' });
  }

  res.setHeader('Content-Type',  'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (type, data = {}) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  console.log(`[stream] model=${modelId} thinking=${extendedThinking} budget=${thinkingBudget} msgs=${messages.length}`);

  try {
    const client = buildClient({ region, apiKey });

    // ── Server-side context optimization (safety net) ─────────────────────
    const { messages: optimizedMsgs, stats: ctxStats } = optimizeContext(messages, {
      recentFullCount:  contextRecentCount  || 6,
      maxTotalMessages: contextMaxMessages  || 40,
    });

    if (ctxStats.saved > 0) {
      console.log(`[stream] Context optimized: ~${ctxStats.saved} tokens saved, ${ctxStats.dropped} msgs dropped (${messages.length} → ${optimizedMsgs.length})`);
    }

    const convMsgs = buildConverseMessages(optimizedMsgs);

    if (convMsgs.length === 0) {
      send('error', { message: 'No valid messages to send (conversation may be empty)' });
      return res.end();
    }

    const system = systemPrompt ? [{ text: systemPrompt }] : undefined;
    const model  = modelId || 'us.anthropic.claude-sonnet-4-5-20251001-v1:0';

    const params = {
      modelId: model,
      messages: convMsgs,
      system,
      inferenceConfig: { maxTokens: maxTokens || 32000 },
    };

    if (extendedThinking) {
      const budget = thinkingBudget || 10000;
      console.log(`[stream] enabling thinking, budget=${budget}`);
      params.additionalModelRequestFields = {
        thinking: { type: 'enabled', budget_tokens: budget },
      };
      const desiredTotal = (maxTokens || 32000) + budget;
      params.inferenceConfig.maxTokens   = Math.min(desiredTotal, 128000);
      params.inferenceConfig.temperature = 1;
    } else if (temperature !== undefined) {
      params.inferenceConfig.temperature = temperature;
    }

    const response = await client.send(new ConverseStreamCommand(params));

    let inThinking      = false;
    let thinkingStarted = false;
    let deltaCount      = 0;

    for await (const chunk of response.stream) {

      if (chunk.contentBlockStart) {
        const start = chunk.contentBlockStart.start;
        console.log('[contentBlockStart]', JSON.stringify(start));
        if (start?.reasoningContent !== undefined || start?.thinking !== undefined) {
          inThinking = true;
          if (!thinkingStarted) {
            thinkingStarted = true;
            send('thinking_start');
            console.log('[stream] → thinking_start (from contentBlockStart)');
          }
        } else {
          if (inThinking) {
            send('thinking_end');
            inThinking = false;
          }
        }
      }

      if (chunk.contentBlockDelta) {
        const delta = chunk.contentBlockDelta.delta;
        deltaCount++;

        if (deltaCount <= 5) {
          console.log(`[delta #${deltaCount}] FULL:`, JSON.stringify(delta));
          console.log(`[delta #${deltaCount}] keys:`, Object.keys(delta || {}));
          if (delta) {
            for (const key of Object.keys(delta)) {
              const val = delta[key];
              console.log(`[delta #${deltaCount}]   .${key} =`,
                typeof val === 'string' ? val.slice(0, 80) + '...' : JSON.stringify(val));
            }
          }
        }

        const thinkText =
          delta?.reasoningContent?.thinkingDelta ||
          delta?.reasoningContent?.text ||
          delta?.thinking?.text ||
          delta?.thinking?.thinkingDelta ||
          delta?.thinkingDelta ||
          (delta?.reasoningContent && typeof delta.reasoningContent === 'string' ? delta.reasoningContent : null);

        if (thinkText) {
          if (!thinkingStarted) {
            thinkingStarted = true;
            inThinking = true;
            send('thinking_start');
            console.log('[stream] → thinking_start (inferred from delta)');
          }
          send('thinking_delta', { text: thinkText });

        } else if (delta?.reasoningContent?.signature || delta?.thinking?.signature) {
          if (inThinking) { send('thinking_end'); inThinking = false; }
          console.log('[stream] signature block, closing thinking');

        } else if (delta?.text !== undefined) {
          if (inThinking) {
            send('thinking_end');
            inThinking = false;
            console.log('[stream] → thinking_end (text started)');
          }
          send('text_delta', { text: delta.text });

        } else {
          if (deltaCount <= 10) {
            console.log(`[delta #${deltaCount}] UNHANDLED shape:`, JSON.stringify(delta));
          }
        }
      }

      if (chunk.contentBlockStop) {
        if (inThinking) {
          send('thinking_end');
          inThinking = false;
          console.log('[stream] → thinking_end (contentBlockStop)');
        }
      }

      if (chunk.messageStop) {
        if (inThinking) {
          send('thinking_end');
          inThinking = false;
          console.log('[stream] → thinking_end (forced before done)');
        }
        send('done', { stopReason: chunk.messageStop.stopReason });
      }

      if (chunk.metadata) {
        send('usage', { usage: chunk.metadata.usage });
      }
    }

    console.log(`[stream] done. thinkingStarted=${thinkingStarted} totalDeltas=${deltaCount}`);

  } catch (err) {
    console.error('[stream] Bedrock error:', err);
    send('error', { message: err.message || 'Unknown Bedrock error' });
  } finally {
    res.end();
  }
});

module.exports = router;
