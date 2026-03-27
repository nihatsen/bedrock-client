#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════════════
// list-models.js — List all available Amazon Bedrock models
//
// Usage:
//   node list-models.js
//   node list-models.js --region us-west-2
//   node list-models.js --json          (raw JSON output)
//   node list-models.js --fallback      (prints ready-to-paste JS array)
//
// Requires:
//   npm install @aws-sdk/client-bedrock @aws-sdk/client-bedrock-runtime dotenv
// ═══════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } = require('@aws-sdk/client-bedrock');

// ─── CLI args ─────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const RAW     = args.includes('--json');
const FALLBACK= args.includes('--fallback');
const regionArg = args.find(a => a.startsWith('--region'));
const REGION  = regionArg ? regionArg.split('=')[1] || args[args.indexOf('--region') + 1] : (process.env.AWS_REGION || 'us-east-1');
const API_KEY = process.env.AWS_BEARER_TOKEN_BEDROCK;

if (!API_KEY) {
  console.error('\n❌  Missing AWS_BEARER_TOKEN_BEDROCK in .env or environment.\n');
  process.exit(1);
}

// ─── Build client with Bearer token auth ──────────────────────────────────
function buildClient(region, apiKey) {
  const client = new BedrockClient({
    region,
    credentials: () => Promise.resolve({
      accessKeyId:     'bearer-token-auth',
      secretAccessKey: 'bearer-token-auth',
    }),
  });

  // Inject Bearer token, strip SigV4
  client.middlewareStack.add(
    (next) => async (args) => {
      if (args.request?.headers) {
        for (const key of Object.keys(args.request.headers)) {
          if (key.toLowerCase() === 'authorization') delete args.request.headers[key];
        }
        args.request.headers['authorization'] = `Bearer ${apiKey}`;
      }
      return next(args);
    },
    { step: 'finalizeRequest', priority: 'low', name: 'bearerTokenAuth', override: true }
  );

  return client;
}

// ─── Infer model properties from ID ───────────────────────────────────────
function inferProps(id) {
  const lo = id.toLowerCase();

  const supportsThinking =
    lo.includes('claude-3-7')      ||
    lo.includes('claude-sonnet-4') ||
    lo.includes('claude-opus-4')   ||
    lo.includes('claude-haiku-4');

  let maxOutputTokens = 8192;
  if      (lo.includes('claude-3-7'))                                          maxOutputTokens = 64000;
  else if (lo.includes('claude-opus-4'))                                       maxOutputTokens = 32000;
  else if (lo.includes('claude-sonnet-4') || lo.includes('claude-haiku-4'))    maxOutputTokens = 16384;
  else if (lo.includes('nova-premier')    || lo.includes('nova-pro'))          maxOutputTokens = 32000;
  else if (lo.includes('nova-lite')       || lo.includes('nova-micro'))        maxOutputTokens = 5120;
  else if (lo.includes('llama3'))                                               maxOutputTokens = 8192;

  return { supportsThinking, maxOutputTokens };
}

// ─── Relevance filters ─────────────────────────────────────────────────────
function isRelevantProfile(id) {
  const lo = id.toLowerCase();
  return lo.includes('anthropic') || lo.includes('meta.llama') || lo.includes('amazon.nova');
}

function isRelevantFoundationModel(m) {
  if (!m.responseStreamingSupported) return false;
  const p = (m.providerName || '').toLowerCase();
  return p === 'anthropic' || p === 'meta' || p === 'amazon';
}

function cleanName(raw) {
  return (raw || '')
    .replace(/^(US|EU|AP|Global)\s+/i, match => `(${match.trim()}) `)
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Fetch ─────────────────────────────────────────────────────────────────
async function fetchModels(region, apiKey) {
  const client = buildClient(region, apiKey);
  const models = [];
  const seen   = new Set();

  // 1. Inference Profiles (cross-region IDs: us.anthropic.claude-…)
  try {
    let nextToken;
    do {
      const cmd  = new ListInferenceProfilesCommand({
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
          source: 'inference-profile',
          ...inferProps(id),
        });
      }
      nextToken = resp.nextToken;
    } while (nextToken);

    console.error(`✓  Inference profiles fetched: ${models.length}`);
  } catch (e) {
    console.error(`⚠️  ListInferenceProfiles failed: ${e.message}`);
  }

  // 2. Foundation Models (direct IDs: anthropic.claude-…)
  const before = models.length;
  try {
    const resp = await client.send(new ListFoundationModelsCommand({}));
    for (const m of (resp.modelSummaries || [])) {
      const id = m.modelId;
      if (!isRelevantFoundationModel(m) || seen.has(id)) continue;
      seen.add(id);
      models.push({
        id,
        name: m.modelName || id,
        source: 'foundation-model',
        ...inferProps(id),
      });
    }
    console.error(`✓  Foundation models fetched: ${models.length - before} new`);
  } catch (e) {
    console.error(`⚠️  ListFoundationModels failed: ${e.message}`);
  }

  // Sort: Anthropic first, then alphabetically
  models.sort((a, b) => {
    const aA = a.id.includes('anthropic') ? 0 : 1;
    const bA = b.id.includes('anthropic') ? 0 : 1;
    if (aA !== bA) return aA - bA;
    return a.name.localeCompare(b.name);
  });

  return models;
}

// ─── Output formatters ─────────────────────────────────────────────────────
function printTable(models) {
  const COL = {
    id:       45,
    name:     44,
    thinking: 9,
    tokens:   8,
    source:   18,
  };

  const hr  = '─'.repeat(Object.values(COL).reduce((a,b) => a + b + 3, 1));
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);

  console.log('\n' + hr);
  console.log(
    '│ ' + pad('Model ID',          COL.id)       +
    ' │ ' + pad('Name',             COL.name)     +
    ' │ ' + pad('Thinking', COL.thinking)         +
    ' │ ' + pad('MaxTok',   COL.tokens)           +
    ' │ ' + pad('Source',   COL.source)           + ' │'
  );
  console.log(hr);

  for (const m of models) {
    console.log(
      '│ ' + pad(m.id,                          COL.id)      +
      ' │ ' + pad(m.name,                        COL.name)   +
      ' │ ' + pad(m.supportsThinking ? '✓' : '', COL.thinking) +
      ' │ ' + pad(m.maxOutputTokens,             COL.tokens) +
      ' │ ' + pad(m.source,                      COL.source) + ' │'
    );
  }

  console.log(hr);
  console.log(`\nTotal: ${models.length} models  (region: ${REGION})\n`);
}

function printFallback(models) {
  const lines = models.map(m =>
    `  { id: '${m.id}', name: '${m.name}', supportsThinking: ${m.supportsThinking}, maxOutputTokens: ${m.maxOutputTokens} },`
  );

  const out = [
    '// ─── Auto-generated fallback model list ────────────────────────────────────',
    `// Region: ${REGION}  |  Generated: ${new Date().toISOString()}`,
    `// Total: ${models.length} models`,
    '//',
    'const FALLBACK_MODELS = [',
    ...lines,
    '];',
  ].join('\n');

  console.log('\n' + out + '\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────
(async () => {
  console.error(`\n🔍  Fetching models from Bedrock  (region: ${REGION}) …\n`);

  try {
    const models = await fetchModels(REGION, API_KEY);

    if (models.length === 0) {
      console.error('\n⚠️  No models returned. Check your API key and region.\n');
      process.exit(1);
    }

    if (RAW) {
      // Raw JSON — pipe to a file: node list-models.js --json > models.json
      console.log(JSON.stringify(models, null, 2));
    } else if (FALLBACK) {
      // Ready-to-paste JS array
      printFallback(models);
    } else {
      // Human-readable table
      printTable(models);
    }
  } catch (err) {
    console.error('\n❌  Fatal error:', err.message, '\n');
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
})();
