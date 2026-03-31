// public/js/budget.js — Token calculator, cost tracker, budget enforcement

// ═══════════════════════════════════════════════════════════════════════════
// PRICING DATABASE — per 1M tokens (USD), Standard On-Demand tier
// Source: https://aws.amazon.com/bedrock/pricing/
// ═══════════════════════════════════════════════════════════════════════════
const MODEL_PRICING = {
  // ── Anthropic ──────────────────────────────────────────────────────────
  'claude-sonnet-4-6':    { input: 3.00,  output: 15.00,  name: 'Sonnet 4.6'  },
  'claude-sonnet-4-5':    { input: 3.00,  output: 15.00,  name: 'Sonnet 4.5'  },
  'claude-sonnet-4-2':    { input: 3.00,  output: 15.00,  name: 'Sonnet 4'    },
  'claude-opus-4-6':      { input: 15.00, output: 75.00,  name: 'Opus 4.6'    },
  'claude-opus-4-5':      { input: 10.00, output: 50.00,  name: 'Opus 4.5'    },
  'claude-opus-4-1':      { input: 15.00, output: 75.00,  name: 'Opus 4.1'    },
  'claude-opus-4-2':      { input: 15.00, output: 75.00,  name: 'Opus 4'      },
  'claude-haiku-4':       { input: 0.80,  output: 4.00,   name: 'Haiku 4.5'   },
  'claude-3-7-sonnet':    { input: 3.00,  output: 15.00,  name: '3.7 Sonnet'  },
  'claude-3-5-sonnet':    { input: 3.00,  output: 15.00,  name: '3.5 Sonnet'  },
  'claude-3-5-haiku':     { input: 0.80,  output: 4.00,   name: '3.5 Haiku'   },
  'claude-3-haiku':       { input: 0.25,  output: 1.25,   name: '3 Haiku'     },
  'claude-3-sonnet':      { input: 3.00,  output: 15.00,  name: '3 Sonnet'    },
  'claude-3-opus':        { input: 15.00, output: 75.00,  name: '3 Opus'      },
  'claude-instant':       { input: 0.80,  output: 2.40,   name: 'Instant'     },

  // ── Amazon Nova ────────────────────────────────────────────────────────
  'nova-premier':         { input: 2.50,  output: 10.00,  name: 'Nova Premier' },
  'nova-pro':             { input: 0.80,  output: 3.20,   name: 'Nova Pro'     },
  'nova-lite':            { input: 0.06,  output: 0.24,   name: 'Nova Lite'    },
  'nova-micro':           { input: 0.035, output: 0.14,   name: 'Nova Micro'   },
  'nova-2-lite':          { input: 0.04,  output: 0.16,   name: 'Nova 2 Lite'  },

  // ── Meta Llama ─────────────────────────────────────────────────────────
  'llama4-maverick':      { input: 0.20,  output: 0.60,   name: 'Llama 4 Maverick' },
  'llama4-scout':         { input: 0.17,  output: 0.17,   name: 'Llama 4 Scout'    },
  'llama3-3-70b':         { input: 0.72,  output: 0.72,   name: 'Llama 3.3 70B'    },
  'llama3-2-90b':         { input: 0.72,  output: 0.72,   name: 'Llama 3.2 90B'    },
  'llama3-2-11b':         { input: 0.16,  output: 0.16,   name: 'Llama 3.2 11B'    },
  'llama3-2-3b':          { input: 0.15,  output: 0.15,   name: 'Llama 3.2 3B'     },
  'llama3-2-1b':          { input: 0.10,  output: 0.10,   name: 'Llama 3.2 1B'     },
  'llama3-1-70b':         { input: 0.72,  output: 0.72,   name: 'Llama 3.1 70B'    },
  'llama3-1-8b':          { input: 0.22,  output: 0.22,   name: 'Llama 3.1 8B'     },
  'llama3-70b':           { input: 0.72,  output: 0.72,   name: 'Llama 3 70B'      },
  'llama3-8b':            { input: 0.30,  output: 0.40,   name: 'Llama 3 8B'       },
};

// Default fallback when model not recognized
const DEFAULT_PRICING = { input: 3.00, output: 15.00, name: 'Unknown' };

// ═══════════════════════════════════════════════════════════════════════════
// PRICE LOOKUP — match model ID to pricing (longest substring wins)
// ═══════════════════════════════════════════════════════════════════════════
function _getPricing(modelId) {
  if (!modelId) return DEFAULT_PRICING;
  const lo = modelId.toLowerCase();

  let bestKey = null, bestLen = 0;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (lo.includes(key) && key.length > bestLen) {
      bestKey = key;
      bestLen = key.length;
    }
  }
  if (bestKey) return MODEL_PRICING[bestKey];

  // Fallback heuristics
  if (lo.includes('claude'))  return { input: 3.00,  output: 15.00, name: 'Claude' };
  if (lo.includes('nova'))    return { input: 0.80,  output: 3.20,  name: 'Nova'   };
  if (lo.includes('llama'))   return { input: 0.72,  output: 0.72,  name: 'Llama'  };
  return DEFAULT_PRICING;
}

function getPricingForModel(modelId) {
  return _getPricing(modelId);
}

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN ESTIMATION
// ═══════════════════════════════════════════════════════════════════════════
const CHARS_PER_TOKEN = 3.8;
const TOKENS_PER_IMAGE = 1600;

function estimateTextTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateFileTokens(file) {
  if (!file) return 0;
  if (file.type === 'image') return TOKENS_PER_IMAGE;
  if (file.mediaType === 'application/pdf') {
    const pages = Math.max(1, Math.ceil((file.size || 5000) / 3000));
    return pages * 500;
  }
  if (file.data) {
    const textLen = file.data.length * 0.75;
    return Math.ceil(textLen / CHARS_PER_TOKEN);
  }
  return 100;
}

function estimateMessageTokens(msg) {
  let tokens = 0;
  tokens += estimateTextTokens(msg.text);
  if (msg.files) {
    for (const f of msg.files) tokens += estimateFileTokens(f);
  }
  tokens += 10;
  return tokens;
}

function estimateConversationTokens(messages, newText, newFiles, systemPrompt) {
  let inputTokens = 0;

  const systemTokens = estimateTextTokens(systemPrompt);
  inputTokens += systemTokens;

  let historyTokens = 0;
  for (const msg of messages) {
    const t = estimateMessageTokens(msg);
    historyTokens += t;
  }
  inputTokens += historyTokens;

  let newMsgTokens = estimateTextTokens(newText);
  if (newFiles) {
    for (const f of newFiles) newMsgTokens += estimateFileTokens(f);
  }
  newMsgTokens += 10;
  inputTokens += newMsgTokens;

  return {
    inputTokens,
    newMsgTokens,
    historyTokens,
    systemTokens,
    messageCount: messages.length + 1,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COST CALCULATION
// ═══════════════════════════════════════════════════════════════════════════
function calculateCost(inputTokens, outputTokens, modelId) {
  const pricing = _getPricing(modelId);
  const inputCost  = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return { inputCost, outputCost, totalCost: inputCost + outputCost, pricing };
}

function formatUSD(amount) {
  if (amount === 0) return '$0.00';
  if (amount < 0.001) return '< $0.001';
  if (amount < 0.01)  return '$' + amount.toFixed(4);
  if (amount < 1)     return '$' + amount.toFixed(3);
  if (amount < 100)   return '$' + amount.toFixed(2);
  return '$' + amount.toFixed(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// COST LOG — persisted in localStorage
// ═══════════════════════════════════════════════════════════════════════════
const BUDGET_KEY   = 'brc_budget';
const COST_LOG_KEY = 'brc_cost_log';

function _loadBudget() {
  try { return JSON.parse(localStorage.getItem(BUDGET_KEY) || '{}'); } catch(e) { return {}; }
}
function _saveBudget(b) { localStorage.setItem(BUDGET_KEY, JSON.stringify(b)); }

function _loadCostLog() {
  try { return JSON.parse(localStorage.getItem(COST_LOG_KEY) || '{}'); } catch(e) { return {}; }
}
function _saveCostLog(log) {
  const keys = Object.keys(log).sort();
  while (keys.length > 90) { delete log[keys.shift()]; }
  localStorage.setItem(COST_LOG_KEY, JSON.stringify(log));
}

function recordCost(inputTokens, outputTokens, modelId) {
  const { totalCost } = calculateCost(inputTokens, outputTokens, modelId);
  const today = new Date().toISOString().slice(0, 10);
  const log = _loadCostLog();

  if (!log[today]) log[today] = { cost: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
  log[today].cost         += totalCost;
  log[today].inputTokens  += (inputTokens || 0);
  log[today].outputTokens += (outputTokens || 0);
  log[today].requests     += 1;

  _saveCostLog(log);
  return totalCost;
}

function getCostStats() {
  const log   = _loadCostLog();
  const today = new Date().toISOString().slice(0, 10);
  const todayData = log[today] || { cost: 0, inputTokens: 0, outputTokens: 0, requests: 0 };

  let totalCost = 0, totalInput = 0, totalOutput = 0, totalReqs = 0;
  for (const day of Object.values(log)) {
    totalCost   += day.cost;
    totalInput  += day.inputTokens;
    totalOutput += day.outputTokens;
    totalReqs   += day.requests;
  }

  return {
    today: todayData,
    total: { cost: totalCost, inputTokens: totalInput, outputTokens: totalOutput, requests: totalReqs },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BUDGET LIMITS
// ═══════════════════════════════════════════════════════════════════════════
function getBudgetLimits() {
  const b = _loadBudget();
  return {
    dailyUSD:      b.dailyUSD      ?? 0,
    overallUSD:    b.overallUSD    ?? 0,
    dailyTokens:   b.dailyTokens   ?? 0,
    overallTokens: b.overallTokens ?? 0,
    enabled:       b.enabled       ?? false,
  };
}

function saveBudgetLimits(limits) {
  _saveBudget(limits);
  updateBudgetDisplay();
}

function resetCostLog() {
  localStorage.removeItem(COST_LOG_KEY);
  updateBudgetDisplay();
  toast('Cost log reset', 'success');
}

function checkBudget(estimatedInputTokens, modelId) {
  const limits = getBudgetLimits();
  if (!limits.enabled) return { allowed: true, reason: null, warning: null };

  const stats   = getCostStats();
  const pricing = _getPricing(modelId);
  const estOutputTokens = 2000;
  const estCost = ((estimatedInputTokens / 1_000_000) * pricing.input) +
                  ((estOutputTokens / 1_000_000) * pricing.output);

  if (limits.dailyUSD > 0) {
    if (stats.today.cost >= limits.dailyUSD) {
      return { allowed: false, reason: `Daily budget exceeded (${formatUSD(stats.today.cost)} / ${formatUSD(limits.dailyUSD)})` };
    }
    if ((stats.today.cost + estCost) > limits.dailyUSD * 0.9) {
      return { allowed: true, warning: `Approaching daily limit (${formatUSD(stats.today.cost)} / ${formatUSD(limits.dailyUSD)})` };
    }
  }

  if (limits.overallUSD > 0 && stats.total.cost >= limits.overallUSD) {
    return { allowed: false, reason: `Overall budget exceeded (${formatUSD(stats.total.cost)} / ${formatUSD(limits.overallUSD)})` };
  }

  if (limits.dailyTokens > 0) {
    const todayTok = stats.today.inputTokens + stats.today.outputTokens;
    if (todayTok >= limits.dailyTokens) {
      return { allowed: false, reason: `Daily token limit exceeded (${tokStr(todayTok)} / ${tokStr(limits.dailyTokens)})` };
    }
  }

  if (limits.overallTokens > 0) {
    const totalTok = stats.total.inputTokens + stats.total.outputTokens;
    if (totalTok >= limits.overallTokens) {
      return { allowed: false, reason: `Overall token limit exceeded (${tokStr(totalTok)} / ${tokStr(limits.overallTokens)})` };
    }
  }

  return { allowed: true, reason: null, warning: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// PRE-SEND COST PREVIEW
// ═══════════════════════════════════════════════════════════════════════════
let _previewTimer = null;

function updateCostPreview() {
  const el = document.getElementById('costPreview');
  if (!el) return;

  const input = document.getElementById('msgInput');
  const text  = input?.value || '';

  if (!text.trim() && !pendingFiles.length) {
    el.style.display = 'none';
    return;
  }

  const modelId = document.getElementById('modelSelect')?.value || currentModelId || '';
  const pricing = _getPricing(modelId);

  let messages = [];
  if (currentConvoId) {
    const convo = getConvo(currentConvoId);
    if (convo) messages = convo.messages.filter(m => !m._error);
  }

  const est = estimateConversationTokens(messages, text, pendingFiles, settings.system || '');

  const thinkBudget = (thinkingOn &&
    document.getElementById('modelSelect')?.selectedOptions[0]?.dataset.supportsThinking === 'true')
    ? thinkingBudget : 0;

  const estOutput     = Math.min(4000, (settings.maxTokens || 16000) / 4);
  const totalEstOut   = estOutput + thinkBudget;
  const inputCost     = (est.inputTokens / 1_000_000) * pricing.input;
  const outputCost    = (totalEstOut / 1_000_000) * pricing.output;
  const totalCost     = inputCost + outputCost;

  const limits = getBudgetLimits();
  const stats  = getCostStats();
  let budgetNote = '';
  if (limits.enabled && limits.dailyUSD > 0) {
    const remaining = Math.max(0, limits.dailyUSD - stats.today.cost);
    budgetNote = ` · ${formatUSD(remaining)} left today`;
  }

  el.style.display = '';
  el.innerHTML =
    `<span class="cost-preview-tokens">~${tokStr(est.inputTokens)} in</span>` +
    `<span class="cost-preview-sep">·</span>` +
    `<span class="cost-preview-history">${est.messageCount} msgs</span>` +
    `<span class="cost-preview-sep">·</span>` +
    `<span class="cost-preview-cost">≈ ${formatUSD(totalCost)}</span>` +
    `<span class="cost-preview-sep">·</span>` +
    `<span class="cost-preview-tokens">${pricing.name || 'model'}</span>` +
    (budgetNote ? `<span class="cost-preview-budget">${budgetNote}</span>` : '') +
    (est.historyTokens > est.newMsgTokens * 3 && est.historyTokens > 5000
      ? `<span class="cost-preview-warn"> · ⚠ ${tokStr(est.historyTokens)} history</span>` : '');
}

function scheduleCostPreview() {
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(updateCostPreview, 300);
}

// ═══════════════════════════════════════════════════════════════════════════
// TOPBAR BUDGET DISPLAY
// ═══════════════════════════════════════════════════════════════════════════
function updateBudgetDisplay() {
  const el = document.getElementById('tokenDisplay');
  if (!el) return;

  const stats  = getCostStats();
  const limits = getBudgetLimits();
  const td     = stats.today;
  const tt     = stats.total;

  const todayTok = td.inputTokens + td.outputTokens;
  let text = `Today: ${tokStr(todayTok)} tok · ${formatUSD(td.cost)}`;
  if (limits.enabled && limits.dailyUSD > 0) {
    const pct = Math.min(100, Math.round((td.cost / limits.dailyUSD) * 100));
    text += ` (${pct}%)`;
  }
  el.textContent = text;

  let tip = `TODAY:\n`;
  tip += `  Input: ${td.inputTokens.toLocaleString()} tokens\n`;
  tip += `  Output: ${td.outputTokens.toLocaleString()} tokens\n`;
  tip += `  Cost: ${formatUSD(td.cost)} (${td.requests} requests)\n`;
  if (limits.enabled && limits.dailyUSD > 0) {
    tip += `  Daily limit: ${formatUSD(limits.dailyUSD)}\n`;
    tip += `  Remaining: ${formatUSD(Math.max(0, limits.dailyUSD - td.cost))}\n`;
  }
  tip += `\nALL TIME:\n`;
  tip += `  Input: ${tt.inputTokens.toLocaleString()} tokens\n`;
  tip += `  Output: ${tt.outputTokens.toLocaleString()} tokens\n`;
  tip += `  Cost: ${formatUSD(tt.cost)} (${tt.requests} requests)`;
  if (limits.enabled && limits.overallUSD > 0) {
    tip += `\n  Overall limit: ${formatUSD(limits.overallUSD)}`;
    tip += `\n  Remaining: ${formatUSD(Math.max(0, limits.overallUSD - tt.cost))}`;
  }
  el.title = tip;

  if (limits.enabled && limits.dailyUSD > 0) {
    const ratio = td.cost / limits.dailyUSD;
    if (ratio >= 1)        el.style.color = 'var(--pink)';
    else if (ratio >= 0.8) el.style.color = 'var(--orange)';
    else                   el.style.color = '';
  } else {
    el.style.color = '';
  }
}
