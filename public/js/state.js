// ═══════════════════════════════════════════════════════════════════════════
// STATE — All global state variables
// ═══════════════════════════════════════════════════════════════════════════

let conversations  = JSON.parse(localStorage.getItem('brc_convos')  || '[]');
let unreadCounts   = JSON.parse(localStorage.getItem('brc_unread')  || '{}');
let settings       = JSON.parse(localStorage.getItem('brc_settings')|| '{}');
let currentConvoId = null;
let pendingFiles   = [];
let userScrolledUp = false;

// UI prefs (persisted)
let thinkingOn      = localStorage.getItem('brc_thinking_on') === 'true';
let thinkingBudget  = parseInt(localStorage.getItem('brc_thinking_budget') || '10240');
let sidebarHidden   = localStorage.getItem('brc_sidebar_hidden') === 'true';

// Side panel state
let spCode = '', spLang = 'text', spFilename = 'code.txt';

// Active streams
const streamRegistry = new Map();

// FIX: Changed from a fabricated model ID to one that actually exists on Bedrock.
const DEFAULT_MODEL = 'us.anthropic.claude-sonnet-4-20250514-v1:0';

// Track the current model's display name
let currentModelName = 'Assistant';