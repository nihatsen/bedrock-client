'use strict';

const express = require('express');
const router  = express.Router();
const { buildControlClient } = require('../lib/bedrock');

// ─── Curated fallback list (used when dynamic fetch fails) ────────────────
const FALLBACK_MODELS = [
  { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0',      name: 'Claude Sonnet 4 (US)',         supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'us.anthropic.claude-opus-4-20250514-v1:0',        name: 'Claude Opus 4 (US)',           supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',    name: 'Claude 3.7 Sonnet (US)',       supportsThinking: true,  maxOutputTokens: 64000 },
  { id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',    name: 'Claude 3.5 Sonnet v2 (US)',    supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',     name: 'Claude 3.5 Haiku (US)',        supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'anthropic.claude-sonnet-4-20250514-v1:0',         name: 'Claude Sonnet 4',              supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'anthropic.claude-opus-4-20250514-v1:0',           name: 'Claude Opus 4',                supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'anthropic.claude-3-7-sonnet-20250219-v1:0',       name: 'Claude 3.7 Sonnet',            supportsThinking: true,  maxOutputTokens: 64000 },
  { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',       name: 'Claude 3.5 Sonnet v2',         supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'anthropic.claude-3-5-haiku-20241022-v1:0',        name: 'Claude 3.5 Haiku',             supportsThinking: false, maxOutputTokens: 8192  },
];

// ─── Cache for dynamic results ────────────────────────────────────────────
let _cache      = null;
let _cacheKey   = '';
let _cacheTime  = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Infer model properties from its ID string ───────────────────────────
function inferProps(id) {
  const lo = id.toLowerCase();

  // Extended-thinking support
  const supportsThinking =
    lo.includes('claude-3-7')     ||
    lo.includes('claude-sonnet-4') ||
    lo.includes('claude-opus-4')   ||
    lo.includes('claude-haiku-4');

  // Max output tokens (best-effort heuristic)
  let maxOutputTokens = 8192;
  if (lo.includes('claude-3-7'))                                        maxOutputTokens = 64000;
  else if (lo.includes('claude-opus-4'))                                maxOutputTokens = 32000;
  else if (lo.includes('claude-sonnet-4') || lo.includes('claude-haiku-4')) maxOutputTokens = 16384;
  else if (lo.includes('nova-premier') || lo.includes('nova-pro'))      maxOutputTokens = 32000;

  return { supportsThinking, maxOutputTokens };
}

// ─── Filter: only keep models we can actually use with Converse ───────────
function isRelevantProfile(id) {
  const lo = id.toLowerCase();
  return lo.includes('anthropic') ||
         lo.includes('meta.llama') ||
         lo.includes('amazon.nova');
}

function isRelevantFoundationModel(summary) {
  if (!summary.responseStreamingSupported) return false;
  const p = (summary.providerName || '').toLowerCase();
  return p === 'anthropic' || p === 'meta' || p === 'amazon';
}

// ─── Clean up Bedrock's profile / model names ─────────────────────────────
function cleanName(raw) {
  return raw
    .replace(/^(US|EU|AP|Global)\s+/i, match => `(${match.trim()}) `)
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Dynamic fetch ────────────────────────────────────────────────────────
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

  // 1. Inference Profiles (cross-region IDs like us.anthropic.claude-…)
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

  // 2. Foundation Models (direct IDs like anthropic.claude-…)
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
    const aAnth = a.id.includes('anthropic') ? 0 : 1;
    const bAnth = b.id.includes('anthropic') ? 0 : 1;
    if (aAnth !== bAnth) return aAnth - bAnth;
    return a.name.localeCompare(b.name);
  });

  return models;
}

// ─── Route ────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const region = req.headers['x-region'] || process.env.AWS_REGION || 'us-east-1';

  if (apiKey) {
    const cacheKey = `${apiKey.slice(-8)}_${region}`;
    const now = Date.now();

    // Serve from cache if fresh
    if (_cache && _cacheKey === cacheKey && now - _cacheTime < CACHE_TTL) {
      return res.json({ models: _cache, source: 'bedrock-cached' });
    }

    try {
      const dynamic = await fetchFromBedrock(apiKey, region);
      if (dynamic.length > 0) {
        _cache     = dynamic;
        _cacheKey  = cacheKey;
        _cacheTime = now;
        return res.json({ models: dynamic, source: 'bedrock' });
      }
    } catch (e) {
      console.warn('[models] Dynamic fetch error:', e.message);
    }
  }

  // Fallback
  return res.json({ models: FALLBACK_MODELS, source: 'fallback' });
});

module.exports = router;