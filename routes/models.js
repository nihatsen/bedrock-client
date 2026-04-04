'use strict';

const express = require('express');
const router  = express.Router();
const { buildControlClient } = require('../lib/bedrock');

// ─── Curated fallback — generated from live API, deduplicated ─────────────
// Prefer Global inference profiles → US inference profiles → base foundation
// models. Versioned context-window variants (e.g. :48k, :200k) are omitted
// as the base ID already covers them. Audio-only models (Nova Sonic) omitted.
const FALLBACK_MODELS = [

  // ── Claude 4.x — Global (cross-region routing, best availability) ────────
  { id: 'global.anthropic.claude-opus-4-6-v1',               name: '(Global) Claude Opus 4.6',    supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'global.anthropic.claude-opus-4-5-20251101-v1:0',    name: '(Global) Claude Opus 4.5',    supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'global.anthropic.claude-sonnet-4-6',                name: '(Global) Claude Sonnet 4.6',  supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0',  name: '(Global) Claude Sonnet 4.5',  supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'global.anthropic.claude-sonnet-4-20250514-v1:0',    name: '(Global) Claude Sonnet 4',    supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',   name: '(Global) Claude Haiku 4.5',   supportsThinking: true,  maxOutputTokens: 16384 },

  // ── Claude 4.x — US inference profiles ───────────────────────────────────
  { id: 'us.anthropic.claude-opus-4-1-20250805-v1:0',        name: '(US) Claude Opus 4.1',        supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'us.anthropic.claude-opus-4-6-v1',                   name: '(US) Claude Opus 4.6',        supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'us.anthropic.claude-opus-4-5-20251101-v1:0',        name: '(US) Claude Opus 4.5',        supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'us.anthropic.claude-opus-4-20250514-v1:0',          name: '(US) Claude Opus 4',          supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'us.anthropic.claude-sonnet-4-6',                    name: '(US) Claude Sonnet 4.6',      supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',      name: '(US) Claude Sonnet 4.5',      supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0',        name: '(US) Claude Sonnet 4',        supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',       name: '(US) Claude Haiku 4.5',       supportsThinking: true,  maxOutputTokens: 16384 },

  // ── Claude 3.x — US inference profiles ───────────────────────────────────
  { id: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',      name: '(US) Claude 3.7 Sonnet',      supportsThinking: true,  maxOutputTokens: 64000 },
  { id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',      name: '(US) Claude 3.5 Sonnet v2',   supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0',      name: '(US) Claude 3.5 Sonnet',      supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',       name: '(US) Claude 3.5 Haiku',       supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.anthropic.claude-3-opus-20240229-v1:0',          name: '(US) Claude 3 Opus',          supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.anthropic.claude-3-sonnet-20240229-v1:0',        name: '(US) Claude 3 Sonnet',        supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.anthropic.claude-3-haiku-20240307-v1:0',         name: '(US) Claude 3 Haiku',         supportsThinking: false, maxOutputTokens: 8192  },

  // ── Claude — base foundation model IDs (no cross-region prefix) ──────────
  { id: 'anthropic.claude-opus-4-6-v1',                      name: 'Claude Opus 4.6',             supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'anthropic.claude-opus-4-1-20250805-v1:0',           name: 'Claude Opus 4.1',             supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'anthropic.claude-opus-4-5-20251101-v1:0',           name: 'Claude Opus 4.5',             supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'anthropic.claude-opus-4-20250514-v1:0',             name: 'Claude Opus 4',               supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'anthropic.claude-sonnet-4-6',                       name: 'Claude Sonnet 4.6',           supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'anthropic.claude-sonnet-4-5-20250929-v1:0',         name: 'Claude Sonnet 4.5',           supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'anthropic.claude-sonnet-4-20250514-v1:0',           name: 'Claude Sonnet 4',             supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'anthropic.claude-haiku-4-5-20251001-v1:0',          name: 'Claude Haiku 4.5',            supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'anthropic.claude-3-7-sonnet-20250219-v1:0',         name: 'Claude 3.7 Sonnet',           supportsThinking: true,  maxOutputTokens: 64000 },
  { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',         name: 'Claude 3.5 Sonnet v2',        supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',         name: 'Claude 3.5 Sonnet',           supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'anthropic.claude-3-5-haiku-20241022-v1:0',          name: 'Claude 3.5 Haiku',            supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'anthropic.claude-3-sonnet-20240229-v1:0',           name: 'Claude 3 Sonnet',             supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'anthropic.claude-3-haiku-20240307-v1:0',            name: 'Claude 3 Haiku',              supportsThinking: false, maxOutputTokens: 8192  },

  // ── Amazon Nova — Global + US inference profiles ──────────────────────────
  { id: 'global.amazon.nova-2-lite-v1:0',                    name: '(Global) Nova 2 Lite',        supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.amazon.nova-premier-v1:0',                       name: '(US) Nova Premier',           supportsThinking: false, maxOutputTokens: 32000 },
  { id: 'us.amazon.nova-pro-v1:0',                           name: '(US) Nova Pro',               supportsThinking: false, maxOutputTokens: 32000 },
  { id: 'us.amazon.nova-2-lite-v1:0',                        name: '(US) Nova 2 Lite',            supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.amazon.nova-lite-v1:0',                          name: '(US) Nova Lite',              supportsThinking: false, maxOutputTokens: 5120  },
  { id: 'us.amazon.nova-micro-v1:0',                         name: '(US) Nova Micro',             supportsThinking: false, maxOutputTokens: 5120  },

  // ── Amazon Nova — base foundation model IDs ───────────────────────────────
  { id: 'amazon.nova-premier-v1:0',                          name: 'Nova Premier',                supportsThinking: false, maxOutputTokens: 32000 },
  { id: 'amazon.nova-pro-v1:0',                              name: 'Nova Pro',                    supportsThinking: false, maxOutputTokens: 32000 },
  { id: 'amazon.nova-2-lite-v1:0',                           name: 'Nova 2 Lite',                 supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'amazon.nova-lite-v1:0',                             name: 'Nova Lite',                   supportsThinking: false, maxOutputTokens: 5120  },
  { id: 'amazon.nova-micro-v1:0',                            name: 'Nova Micro',                  supportsThinking: false, maxOutputTokens: 5120  },

  // ── Meta Llama — US inference profiles ───────────────────────────────────
  { id: 'us.meta.llama4-maverick-17b-instruct-v1:0',         name: '(US) Llama 4 Maverick 17B',   supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.meta.llama4-scout-17b-instruct-v1:0',            name: '(US) Llama 4 Scout 17B',      supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.meta.llama3-3-70b-instruct-v1:0',                name: '(US) Llama 3.3 70B',          supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.meta.llama3-2-90b-instruct-v1:0',                name: '(US) Llama 3.2 90B',          supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.meta.llama3-2-11b-instruct-v1:0',                name: '(US) Llama 3.2 11B',          supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.meta.llama3-2-3b-instruct-v1:0',                 name: '(US) Llama 3.2 3B',           supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.meta.llama3-2-1b-instruct-v1:0',                 name: '(US) Llama 3.2 1B',           supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.meta.llama3-1-70b-instruct-v1:0',                name: '(US) Llama 3.1 70B',          supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.meta.llama3-1-8b-instruct-v1:0',                 name: '(US) Llama 3.1 8B',           supportsThinking: false, maxOutputTokens: 8192  },

  // ── Meta Llama — base foundation model IDs ───────────────────────────────
  { id: 'meta.llama4-maverick-17b-instruct-v1:0',            name: 'Llama 4 Maverick 17B',        supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'meta.llama4-scout-17b-instruct-v1:0',               name: 'Llama 4 Scout 17B',           supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'meta.llama3-3-70b-instruct-v1:0',                   name: 'Llama 3.3 70B',               supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'meta.llama3-2-90b-instruct-v1:0',                   name: 'Llama 3.2 90B',               supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'meta.llama3-2-11b-instruct-v1:0',                   name: 'Llama 3.2 11B',               supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'meta.llama3-2-3b-instruct-v1:0',                    name: 'Llama 3.2 3B',                supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'meta.llama3-2-1b-instruct-v1:0',                    name: 'Llama 3.2 1B',                supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'meta.llama3-1-70b-instruct-v1:0',                   name: 'Llama 3.1 70B',               supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'meta.llama3-1-8b-instruct-v1:0',                    name: 'Llama 3.1 8B',                supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'meta.llama3-70b-instruct-v1:0',                     name: 'Llama 3 70B',                 supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'meta.llama3-8b-instruct-v1:0',                      name: 'Llama 3 8B',                  supportsThinking: false, maxOutputTokens: 8192  },
  
  // ── Kimi (free via Puter.js — client-side only) ──────────────────────────
  { id: 'moonshotai/kimi-k2.5',        name: 'Kimi K2.5 (Free)',         supportsThinking: false, maxOutputTokens: 8192 },
  { id: 'moonshotai/kimi-k2',           name: 'Kimi K2 (Free)',           supportsThinking: false, maxOutputTokens: 8192 },
  { id: 'moonshotai/kimi-k2-thinking',  name: 'Kimi K2 Thinking (Free)', supportsThinking: false, maxOutputTokens: 8192 },
  { id: 'moonshotai/kimi-k2-0905',      name: 'Kimi K2 0905 (Free)',     supportsThinking: false, maxOutputTokens: 8192 },

];

// ─── Cache for dynamic results ────────────────────────────────────────────
let _cache     = null;
let _cacheKey  = '';
let _cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Infer model properties from ID ──────────────────────────────────────
function inferProps(id) {
  const lo = id.toLowerCase();

  const supportsThinking =
    lo.includes('claude-3-7')      ||
    lo.includes('claude-sonnet-4') ||
    lo.includes('claude-opus-4')   ||
    lo.includes('claude-haiku-4');

  let maxOutputTokens = 8192;
  if      (lo.includes('claude-3-7'))                                        maxOutputTokens = 64000;
  else if (lo.includes('claude-opus-4'))                                     maxOutputTokens = 32000;
  else if (lo.includes('claude-sonnet-4') || lo.includes('claude-haiku-4')) maxOutputTokens = 16384;
  else if (lo.includes('nova-premier')    || lo.includes('nova-pro'))        maxOutputTokens = 32000;
  else if (lo.includes('nova-lite')       || lo.includes('nova-micro'))      maxOutputTokens = 5120;
  else if (lo.includes('nova-2'))                                            maxOutputTokens = 8192;

  return { supportsThinking, maxOutputTokens };
}

// ─── Relevance filters ────────────────────────────────────────────────────
function isRelevantProfile(id) {
  const lo = id.toLowerCase();
  return (
    lo.includes('anthropic') ||
    lo.includes('meta.llama') ||
    lo.includes('amazon.nova')
  );
}

function isRelevantFoundationModel(summary) {
  if (!summary.responseStreamingSupported) return false;
  // Skip context-window variants — the base ID already covers them
  if (summary.modelId && /:\d+k$|:\d+k:/.test(summary.modelId)) return false;
  // Skip audio-only models
  if ((summary.modelId || '').toLowerCase().includes('sonic')) return false;
  const p = (summary.providerName || '').toLowerCase();
  return p === 'anthropic' || p === 'meta' || p === 'amazon';
}

function cleanName(raw) {
  return (raw || '')
    .replace(/^(US|EU|AP|Global)\s+/i, match => `(${match.trim()}) `)
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Dynamic fetch from Bedrock APIs ─────────────────────────────────────
async function fetchFromBedrock(apiKey, region) {
  const models = [];
  const seen   = new Set();

  let client;
  try {
    client = buildControlClient({ apiKey, region });
  } catch (e) {
    console.warn('[models] Cannot build control client:', e.message);
    return [];
  }

  // 1. Inference Profiles
  try {
    const { ListInferenceProfilesCommand } = require('@aws-sdk/client-bedrock');
    let nextToken;
    do {
      const cmd = new ListInferenceProfilesCommand({
        maxResults: 250,
        typeEquals: 'SYSTEM_DEFINED',
        ...(nextToken && { nextToken }),
      });
      const resp = await client.send(cmd);
      for (const p of (resp.inferenceProfileSummaries || [])) {
        const id = p.inferenceProfileId;
        if (!isRelevantProfile(id) || seen.has(id)) continue;
        seen.add(id);
        models.push({
          id,
          name: cleanName(p.inferenceProfileName || id),
          ...inferProps(id),
        });
      }
      nextToken = resp.nextToken;
    } while (nextToken);
    console.log(`[models] Fetched ${models.length} inference profiles`);
  } catch (e) {
    console.warn('[models] ListInferenceProfiles failed:', e.message);
  }

  // 2. Foundation Models
  try {
    const { ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');
    const resp = await client.send(new ListFoundationModelsCommand({}));
    for (const m of (resp.modelSummaries || [])) {
      const id = m.modelId;
      if (!isRelevantFoundationModel(m) || seen.has(id)) continue;
      seen.add(id);
      models.push({
        id,
        name: m.modelName || id,
        ...inferProps(id),
      });
    }
    console.log(`[models] Total after foundation models: ${models.length}`);
  } catch (e) {
    console.warn('[models] ListFoundationModels failed:', e.message);
  }

  // Sort: Anthropic first, then by name
  models.sort((a, b) => {
    const aA = a.id.includes('anthropic') ? 0 : 1;
    const bA = b.id.includes('anthropic') ? 0 : 1;
    if (aA !== bA) return aA - bA;
    return a.name.localeCompare(b.name);
  });

  return models;
}

// ─── Route ────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const region = req.headers['x-region'] || process.env.AWS_REGION || 'us-east-1';

  // Kimi models are always appended (they run client-side via Puter.js)
  const KIMI = [
    { id: 'moonshotai/kimi-k2.5',        name: 'Kimi K2.5 (Free)',         supportsThinking: false, maxOutputTokens: 8192 },
    { id: 'moonshotai/kimi-k2',           name: 'Kimi K2 (Free)',           supportsThinking: false, maxOutputTokens: 8192 },
    { id: 'moonshotai/kimi-k2-thinking',  name: 'Kimi K2 Thinking (Free)', supportsThinking: false, maxOutputTokens: 8192 },
    { id: 'moonshotai/kimi-k2-0905',      name: 'Kimi K2 0905 (Free)',     supportsThinking: false, maxOutputTokens: 8192 },
  ];

  if (apiKey) {
    const cacheKey = `${apiKey.slice(-8)}_${region}`;
    const now      = Date.now();

    if (_cache && _cacheKey === cacheKey && now - _cacheTime < CACHE_TTL) {
      return res.json({ models: [..._cache, ...KIMI], source: 'bedrock-cached' });
    }

    try {
      const dynamic = await fetchFromBedrock(apiKey, region);
      if (dynamic.length > 0) {
        _cache     = dynamic;
        _cacheKey  = cacheKey;
        _cacheTime = now;
        return res.json({ models: [...dynamic, ...KIMI], source: 'bedrock' });
      }
    } catch (e) {
      console.warn('[models] Dynamic fetch error:', e.message);
    }
  }

  // Filter out Kimi from FALLBACK_MODELS (they'll be added separately)
  const bedrockFallback = FALLBACK_MODELS.filter(m => !m.id.startsWith('moonshotai/'));
  return res.json({ models: [...bedrockFallback, ...KIMI], source: 'fallback' });
});


module.exports = router;
