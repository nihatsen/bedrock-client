'use strict';

const express                                = require('express');
const { ConverseStreamCommand }              = require('@aws-sdk/client-bedrock-runtime');
const { buildClient, buildConverseMessages } = require('../lib/bedrock');

const router = express.Router();

router.post('/stream', express.json({ limit: '50mb' }), async (req, res) => {
  const {
    messages, systemPrompt, modelId, region, apiKey,
    extendedThinking, thinkingBudget, maxTokens, temperature,
  } = req.body;

  // ── FIX: Basic request validation ──────────────────────────────────────
  // Previously, a missing apiKey or empty messages array would cause an opaque
  // crash deep inside the AWS SDK or buildConverseMessages. Now we fail fast
  // with a clear error message.
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing apiKey' });
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing or empty messages array' });
  }

  res.setHeader('Content-Type',  'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  // FIX: Hint for nginx and similar reverse proxies to not buffer SSE
  res.setHeader('X-Accel-Buffering', 'no');
  // FIX: Flush headers immediately so the client receives the SSE connection
  // without waiting for the first data chunk. Without this, some proxies or
  // compression middleware buffer the entire response.
  res.flushHeaders();

  const send = (type, data = {}) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    // FIX: Flush after each SSE event if the method exists (e.g. behind compression)
    if (typeof res.flush === 'function') res.flush();
  };

  console.log(`[stream] model=${modelId} thinking=${extendedThinking} budget=${thinkingBudget}`);

  try {
    const client   = buildClient({ region, apiKey });
    const convMsgs = buildConverseMessages(messages);

    // FIX: Guard against empty conversation after filtering.
    // buildConverseMessages strips invalid messages and enforces user-first/user-last.
    // If everything gets filtered out, we'd send an empty messages array to Bedrock
    // which would return a cryptic validation error.
    if (convMsgs.length === 0) {
      send('error', { message: 'No valid messages to send (conversation may be empty)' });
      return res.end();
    }

    const system   = systemPrompt ? [{ text: systemPrompt }] : undefined;
    const model    = modelId || 'us.anthropic.claude-sonnet-4-5-20251001-v1:0';

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
      // FIX: Cap the total (maxTokens + budget) at 128000 to stay within any
      // model's absolute output ceiling. Previously this was unbounded — a user
      // could set maxTokens=200000 + budget=32000 = 232000 which exceeds every
      // Bedrock model's limit and causes an API error.
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

      // ── contentBlockStart ──────────────────────────────────────────────
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

      // ── contentBlockDelta ──────────────────────────────────────────────
      if (chunk.contentBlockDelta) {
        const delta = chunk.contentBlockDelta.delta;
        deltaCount++;

        // LOG FIRST 5 DELTAS IN FULL so we can see the actual shape
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

        // Try EVERY possible thinking path
        const thinkText =
          delta?.reasoningContent?.thinkingDelta ||    // standard path
          delta?.reasoningContent?.text ||              // alt path 1
          delta?.thinking?.text ||                      // alt path 2
          delta?.thinking?.thinkingDelta ||             // alt path 3
          delta?.thinkingDelta ||                       // alt path 4
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
          // Encrypted signature — close thinking
          if (inThinking) { send('thinking_end'); inThinking = false; }
          console.log('[stream] signature block, closing thinking');

        } else if (delta?.text !== undefined) {
          // Regular text — close thinking if open
          if (inThinking) {
            send('thinking_end');
            inThinking = false;
            console.log('[stream] → thinking_end (text started)');
          }
          send('text_delta', { text: delta.text });

        } else {
          // Unknown delta shape — log it
          if (deltaCount <= 10) {
            console.log(`[delta #${deltaCount}] UNHANDLED shape:`, JSON.stringify(delta));
          }
        }
      }

      // ── contentBlockStop ────────────────────────────────────────────────
      if (chunk.contentBlockStop) {
        if (inThinking) {
          send('thinking_end');
          inThinking = false;
          console.log('[stream] → thinking_end (contentBlockStop)');
        }
      }

      // ── messageStop ─────────────────────────────────────────────────────
      if (chunk.messageStop) {
        // FIX: Ensure thinking is closed before signaling done.
        // If the model terminates abnormally while still in a thinking block,
        // the client's thinking spinner would spin forever because it never
        // receives a thinking_end event.
        if (inThinking) {
          send('thinking_end');
          inThinking = false;
          console.log('[stream] → thinking_end (forced before done)');
        }
        send('done', { stopReason: chunk.messageStop.stopReason });
      }

      // ── metadata ────────────────────────────────────────────────────────
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
