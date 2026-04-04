// public/js/state.js — FULL REPLACEMENT

let conversations  = JSON.parse(localStorage.getItem('brc_convos')  || '[]');
let unreadCounts   = JSON.parse(localStorage.getItem('brc_unread')  || '{}');
let settings       = JSON.parse(localStorage.getItem('brc_settings')|| '{}');
let currentConvoId = null;
let pendingFiles   = [];
let userScrolledUp = false;

let thinkingOn      = localStorage.getItem('brc_thinking_on') === 'true';
let thinkingBudget  = parseInt(localStorage.getItem('brc_thinking_budget') || '10240');
let sidebarHidden   = localStorage.getItem('brc_sidebar_hidden') === 'true';

let spCode = '', spLang = 'text', spFilename = 'code.txt';

const streamRegistry = new Map();

const DEFAULT_MODEL = 'global.anthropic.claude-sonnet-4-6';

let currentModelName = 'Assistant';

// Tracks the currently selected model ID — updated on every model change
let currentModelId = DEFAULT_MODEL;

// ═══════════════════════════════════════════════════════════════════════════
// PUTER / KIMI MODEL SUPPORT
// ═══════════════════════════════════════════════════════════════════════════
const KIMI_MODELS = [
  { id: 'moonshotai/kimi-k2.5',        name: 'Kimi K2.5 (Free)',         supportsThinking: false, maxOutputTokens: 8192, provider: 'puter' },
  { id: 'moonshotai/kimi-k2',           name: 'Kimi K2 (Free)',           supportsThinking: false, maxOutputTokens: 8192, provider: 'puter' },
  { id: 'moonshotai/kimi-k2-thinking',  name: 'Kimi K2 Thinking (Free)', supportsThinking: false, maxOutputTokens: 8192, provider: 'puter' },
  { id: 'moonshotai/kimi-k2-0905',      name: 'Kimi K2 0905 (Free)',     supportsThinking: false, maxOutputTokens: 8192, provider: 'puter' },
];

/** Returns true if modelId is served via Puter.js (client-side) */
function isPuterModel(modelId) {
  if (!modelId) return false;
  return modelId.startsWith('moonshotai/');
}

// ─── Fallback models shown instantly on page load ─────────────────────────
const FALLBACK_MODELS = [
  { id: 'global.anthropic.claude-opus-4-6-v1',              name: '(Global) Claude Opus 4.6',    supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'global.anthropic.claude-opus-4-5-20251101-v1:0',   name: '(Global) Claude Opus 4.5',    supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'global.anthropic.claude-sonnet-4-6',               name: '(Global) Claude Sonnet 4.6',  supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0', name: '(Global) Claude Sonnet 4.5',  supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'global.anthropic.claude-sonnet-4-20250514-v1:0',   name: '(Global) Claude Sonnet 4',    supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'global.anthropic.claude-haiku-4-5-20251001-v1:0',  name: '(Global) Claude Haiku 4.5',   supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'us.anthropic.claude-opus-4-1-20250805-v1:0',       name: '(US) Claude Opus 4.1',        supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'us.anthropic.claude-opus-4-6-v1',                  name: '(US) Claude Opus 4.6',        supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'us.anthropic.claude-opus-4-5-20251101-v1:0',       name: '(US) Claude Opus 4.5',        supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'us.anthropic.claude-opus-4-20250514-v1:0',         name: '(US) Claude Opus 4',          supportsThinking: true,  maxOutputTokens: 32000 },
  { id: 'us.anthropic.claude-sonnet-4-6',                   name: '(US) Claude Sonnet 4.6',      supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',     name: '(US) Claude Sonnet 4.5',      supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'us.anthropic.claude-sonnet-4-20250514-v1:0',       name: '(US) Claude Sonnet 4',        supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',      name: '(US) Claude Haiku 4.5',       supportsThinking: true,  maxOutputTokens: 16384 },
  { id: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',     name: '(US) Claude 3.7 Sonnet',      supportsThinking: true,  maxOutputTokens: 64000 },
  { id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',     name: '(US) Claude 3.5 Sonnet v2',   supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',      name: '(US) Claude 3.5 Haiku',       supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.amazon.nova-premier-v1:0',                      name: '(US) Nova Premier',           supportsThinking: false, maxOutputTokens: 32000 },
  { id: 'us.amazon.nova-pro-v1:0',                          name: '(US) Nova Pro',               supportsThinking: false, maxOutputTokens: 32000 },
  { id: 'us.amazon.nova-lite-v1:0',                         name: '(US) Nova Lite',              supportsThinking: false, maxOutputTokens: 5120  },
  { id: 'us.amazon.nova-micro-v1:0',                        name: '(US) Nova Micro',             supportsThinking: false, maxOutputTokens: 5120  },
  { id: 'us.meta.llama4-maverick-17b-instruct-v1:0',        name: '(US) Llama 4 Maverick 17B',   supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.meta.llama4-scout-17b-instruct-v1:0',           name: '(US) Llama 4 Scout 17B',      supportsThinking: false, maxOutputTokens: 8192  },
  { id: 'us.meta.llama3-3-70b-instruct-v1:0',               name: '(US) Llama 3.3 70B',          supportsThinking: false, maxOutputTokens: 8192  },
];
