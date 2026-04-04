// public/js/budget.js — Token calculator, cost tracker, budget enforcement, LIVE preview

// ═══════════════════════════════════════════════════════════════════════════
// PRICING DATABASE — per 1M tokens (USD), Standard On-Demand tier
// ═══════════════════════════════════════════════════════════════════════════
const MODEL_PRICING = {
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
  'nova-premier':         { input: 2.50,  output: 10.00,  name: 'Nova Premier' },
  'nova-pro':             { input: 0.80,  output: 3.20,   name: 'Nova Pro'     },
  'nova-lite':            { input: 0.06,  output: 0.24,   name: 'Nova Lite'    },
  'nova-micro':           { input: 0.035, output: 0.14,   name: 'Nova Micro'   },
  'nova-2-lite':          { input: 0.04,  output: 0.16,   name: 'Nova 2 Lite'  },
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
    // ── Kimi (free via Puter) ──────────────────────────────────────────────
  'kimi-k2.5':           { input: 0, output: 0, name: 'Kimi K2.5 (Free)'      },
  'kimi-k2-thinking':    { input: 0, output: 0, name: 'Kimi K2 Thinking (Free)' },
  'kimi-k2-0905':        { input: 0, output: 0, name: 'Kimi K2 0905 (Free)'   },
  'kimi-k2':             { input: 0, output: 0, name: 'Kimi K2 (Free)'        }
};

const DEFAULT_PRICING = { input: 3.00, output: 15.00, name: 'Unknown' };

// ═══════════════════════════════════════════════════════════════════════════
// PRICE LOOKUP
// ═══════════════════════════════════════════════════════════════════════════
function _getPricing(modelId) {
  if (!modelId) return DEFAULT_PRICING;

  // All Puter models are free
  if (isPuterModel(modelId)) {
    const lo = modelId.toLowerCase();
    if (lo.includes('opus'))         return { input: 0, output: 0, name: 'Opus (Free/Puter)' };
    if (lo.includes('sonnet'))       return { input: 0, output: 0, name: 'Sonnet (Free/Puter)' };
    if (lo.includes('haiku'))        return { input: 0, output: 0, name: 'Haiku (Free/Puter)' };
    if (lo.includes('kimi-k2.5'))    return { input: 0, output: 0, name: 'Kimi K2.5 (Free)' };
    if (lo.includes('kimi-k2-think'))return { input: 0, output: 0, name: 'Kimi K2 Think (Free)' };
    if (lo.includes('kimi'))         return { input: 0, output: 0, name: 'Kimi (Free)' };
    return { input: 0, output: 0, name: 'Free (Puter)' };
  }

  const lo = modelId.toLowerCase();
  let bestKey = null, bestLen = 0;
  for (const key of Object.keys(MODEL_PRICING)) {
    if (lo.includes(key) && key.length > bestLen) { bestKey = key; bestLen = key.length; }
  }
  if (bestKey) return MODEL_PRICING[bestKey];
  if (lo.includes('claude'))  return { input: 3.00,  output: 15.00, name: 'Claude' };
  if (lo.includes('nova'))    return { input: 0.80,  output: 3.20,  name: 'Nova'   };
  if (lo.includes('llama'))   return { input: 0.72,  output: 0.72,  name: 'Llama'  };
  return DEFAULT_PRICING;
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

/** Public helper — used by input.js to show per-file token badges */
function getFileTokenEstimate(file) {
  return estimateFileTokens(file);
}

function estimateMessageTokens(msg) {
  let tokens = 0;
  tokens += estimateTextTokens(msg.text);
  if (msg.files) { for (const f of msg.files) tokens += estimateFileTokens(f); }
  tokens += 10; // per-message overhead
  return tokens;
}

function estimateConversationTokens(messages, newText, newFiles, systemPrompt) {
  let inputTokens = 0;
  const systemTokens = estimateTextTokens(systemPrompt);
  inputTokens += systemTokens;
  let historyTokens = 0;
  for (const msg of messages) historyTokens += estimateMessageTokens(msg);
  inputTokens += historyTokens;
  let newMsgTokens = estimateTextTokens(newText);
  if (newFiles) { for (const f of newFiles) newMsgTokens += estimateFileTokens(f); }
  newMsgTokens += 10;
  inputTokens += newMsgTokens;
  return { inputTokens, newMsgTokens, historyTokens, systemTokens, messageCount: messages.length + 1 };
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

function _loadBudget() { try { return JSON.parse(localStorage.getItem(BUDGET_KEY) || '{}'); } catch(e) { return {}; } }
function _saveBudget(b) { localStorage.setItem(BUDGET_KEY, JSON.stringify(b)); }
function _loadCostLog() { try { return JSON.parse(localStorage.getItem(COST_LOG_KEY) || '{}'); } catch(e) { return {}; } }
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
    totalCost += day.cost; totalInput += day.inputTokens; totalOutput += day.outputTokens; totalReqs += day.requests;
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
    dailyUSD: b.dailyUSD ?? 0, overallUSD: b.overallUSD ?? 0,
    dailyTokens: b.dailyTokens ?? 0, overallTokens: b.overallTokens ?? 0,
    enabled: b.enabled ?? false,
  };
}
function saveBudgetLimits(limits) { _saveBudget(limits); updateBudgetDisplay(); }
function resetCostLog() { localStorage.removeItem(COST_LOG_KEY); updateBudgetDisplay(); toast('Cost log reset', 'success'); }

function checkBudget(estimatedInputTokens, modelId) {
  const limits = getBudgetLimits();
  if (!limits.enabled) return { allowed: true, reason: null, warning: null };
  const stats = getCostStats();
  const pricing = _getPricing(modelId);
  const estOutputTokens = 2000;
  const estCost = ((estimatedInputTokens / 1_000_000) * pricing.input) + ((estOutputTokens / 1_000_000) * pricing.output);

  if (limits.dailyUSD > 0) {
    if (stats.today.cost >= limits.dailyUSD)
      return { allowed: false, reason: `Daily budget exceeded (${formatUSD(stats.today.cost)} / ${formatUSD(limits.dailyUSD)})` };
    if ((stats.today.cost + estCost) > limits.dailyUSD * 0.9)
      return { allowed: true, warning: `Approaching daily limit (${formatUSD(stats.today.cost)} / ${formatUSD(limits.dailyUSD)})` };
  }
  if (limits.overallUSD > 0 && stats.total.cost >= limits.overallUSD)
    return { allowed: false, reason: `Overall budget exceeded (${formatUSD(stats.total.cost)} / ${formatUSD(limits.overallUSD)})` };
  if (limits.dailyTokens > 0) {
    const todayTok = stats.today.inputTokens + stats.today.outputTokens;
    if (todayTok >= limits.dailyTokens)
      return { allowed: false, reason: `Daily token limit exceeded (${tokStr(todayTok)} / ${tokStr(limits.dailyTokens)})` };
  }
  if (limits.overallTokens > 0) {
    const totalTok = stats.total.inputTokens + stats.total.outputTokens;
    if (totalTok >= limits.overallTokens)
      return { allowed: false, reason: `Overall token limit exceeded (${tokStr(totalTok)} / ${tokStr(limits.overallTokens)})` };
  }
  return { allowed: true, reason: null, warning: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// DETAILED TOKEN ESTIMATE  — single source of truth for the live preview
// ═══════════════════════════════════════════════════════════════════════════
function getDetailedEstimate() {
  const input   = document.getElementById('msgInput');
  const text    = input?.value || '';
  const modelSel = document.getElementById('modelSelect');
  const modelId  = modelSel?.value || currentModelId || '';
  const opt      = modelSel?.selectedOptions[0];
  const pricing  = _getPricing(modelId);
  const canThink = opt?.dataset.supportsThinking === 'true';

  // ── New message ────────────────────────────────────────────────────────
  const newTextTok  = estimateTextTokens(text);
  let newFileTok    = 0;
  const fileDetails = [];
  for (const f of pendingFiles) {
    const ft = estimateFileTokens(f);
    newFileTok += ft;
    fileDetails.push({ name: f.name || f.type || 'file', tokens: ft, type: f.type });
  }
  const newMsgTok = newTextTok + newFileTok + (text.trim() || pendingFiles.length ? 10 : 0);

  // ── System prompt ──────────────────────────────────────────────────────
  const systemTok = estimateTextTokens(settings.system || '');

  // ── History — raw (before optimization) ────────────────────────────────
  let rawMessages = [];
  if (currentConvoId) {
    const convo = getConvo(currentConvoId);
    if (convo) rawMessages = convo.messages.filter(m => !m._error);
  }

  let rawHistTok = 0;
  for (const m of rawMessages) rawHistTok += estimateMessageTokens(m);

  // ── History — optimized (what actually gets sent) ──────────────────────
  let optHistTok = 0, ctxStats = null;
  if (rawMessages.length > 0 && typeof prepareMessagesForSend === 'function') {
    const result = prepareMessagesForSend(rawMessages);
    ctxStats = result.stats;
    for (const m of result.messages) {
      optHistTok += estimateTextTokens(m.text);
      if (m.files) for (const f of m.files) optHistTok += estimateFileTokens(f);
      optHistTok += 10;
    }
  } else {
    optHistTok = rawHistTok;
  }

  const savedTok = Math.max(0, rawHistTok - optHistTok);

  // ── Totals ─────────────────────────────────────────────────────────────
  const totalInput  = systemTok + optHistTok + newMsgTok;
  const thinkBudget = (thinkingOn && canThink) ? thinkingBudget : 0;
  const estOutput   = Math.min(4000, (settings.maxTokens || 16000) / 4);
  const totalEstOut = estOutput + thinkBudget;

  // ── Cost ───────────────────────────────────────────────────────────────
  const inputCost  = (totalInput  / 1_000_000) * pricing.input;
  const outputCost = (totalEstOut / 1_000_000) * pricing.output;
  const totalCost  = inputCost + outputCost;

  // ── Budget ─────────────────────────────────────────────────────────────
  const limits = getBudgetLimits();
  const stats  = getCostStats();

  return {
    newMsg:   { text: newTextTok, files: newFileTok, total: newMsgTok, fileDetails },
    history:  { raw: rawHistTok, optimized: optHistTok, saved: savedTok, msgCount: rawMessages.length, ctxStats },
    system:   systemTok,
    input:    totalInput,
    thinking: thinkBudget,
    output:   { estimated: estOutput, withThinking: totalEstOut },
    cost:     { input: inputCost, output: outputCost, total: totalCost, pricing },
    budget:   { limits, stats },
    modelId,
    hasContent: !!(text.trim() || pendingFiles.length),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE COST PREVIEW — comprehensive real-time display
// ═══════════════════════════════════════════════════════════════════════════
let _previewTimer = null;

function updateCostPreview() {
  const container = document.getElementById('costPreview');
  const rowMain   = document.getElementById('cpRowMain');
  const rowDetail = document.getElementById('cpRowDetail');
  if (!container || !rowMain) return;

  const d = getDetailedEstimate();

  if (!d.hasContent) {
    container.classList.remove('visible');
    const toggleBtn = document.getElementById('cpToggleBtn');
    if (toggleBtn) toggleBtn.classList.remove('has-content');
    return;
  }

  const pr = d.cost.pricing;

  // ═══════════════════════════════════════════════════════════════════════
  // ROW 1 — Main breakdown:
  //   ✏ 245 tok  +  💬 3.2k (12 msgs)  +  📋 120  →  3.6k in  ·  ~4k out  ·  💰 $0.012
  // ═══════════════════════════════════════════════════════════════════════
  const p = [];

  // New message
  let newTip = `New message: ~${d.newMsg.total.toLocaleString()} tokens\n`;
  newTip += `  Text: ~${d.newMsg.text.toLocaleString()} tok`;
  if (d.newMsg.fileDetails.length) {
    newTip += `\n  Files (${d.newMsg.fileDetails.length}): ~${d.newMsg.files.toLocaleString()} tok`;
    for (const fd of d.newMsg.fileDetails) newTip += `\n    ${fd.name}: ~${fd.tokens.toLocaleString()} tok`;
  }
  let newLabel = `✏ ${tokStr(d.newMsg.total)}`;
  if (d.newMsg.files > 0) {
    newLabel += ` <span class="cp-dim">(txt:${tokStr(d.newMsg.text)}+${d.newMsg.fileDetails.length}f:${tokStr(d.newMsg.files)})</span>`;
  }
  p.push(`<span class="cp-chip cp-new" title="${esc(newTip)}">${newLabel}</span>`);

  // History
  if (d.history.msgCount > 0) {
    let histTip = `Chat history: ~${d.history.optimized.toLocaleString()} tokens (${d.history.msgCount} messages)`;
    if (d.history.saved > 100) {
      histTip += `\nRaw (unoptimized): ~${d.history.raw.toLocaleString()} tokens`;
      histTip += `\nSaved by optimization: ~${d.history.saved.toLocaleString()} tokens`;
      if (d.history.ctxStats) {
        if (d.history.ctxStats.dropped) histTip += `\n  ${d.history.ctxStats.dropped} msg(s) summarized`;
        if (d.history.ctxStats.truncated) histTip += `\n  ${d.history.ctxStats.truncated} msg(s) compressed`;
        histTip += `\n  ${d.history.ctxStats.full} msg(s) sent in full`;
      }
    }
    let histLabel = `💬 ${tokStr(d.history.optimized)}`;
    histLabel += ` <span class="cp-dim">(${d.history.msgCount}msg${d.history.msgCount > 1 ? 's' : ''}`;
    if (d.history.saved > 100) histLabel += ` ⚡-${tokStr(d.history.saved)}`;
    histLabel += `)</span>`;
    p.push(`<span class="cp-sep">+</span>`);
    p.push(`<span class="cp-chip cp-hist" title="${esc(histTip)}">${histLabel}</span>`);
  }

  // System
  if (d.system > 0) {
    p.push(`<span class="cp-sep">+</span>`);
    p.push(`<span class="cp-chip cp-sys" title="System prompt: ~${d.system.toLocaleString()} tokens">📋 ${tokStr(d.system)}</span>`);
  }

  // Total input
  const totalTip = `Total input tokens: ~${d.input.toLocaleString()}\n` +
    `  New message: ~${d.newMsg.total.toLocaleString()}\n` +
    `  History: ~${d.history.optimized.toLocaleString()}\n` +
    `  System: ~${d.system.toLocaleString()}\n` +
    `  Overhead: ~${10}`;
  p.push(`<span class="cp-sep">→</span>`);
  p.push(`<span class="cp-chip cp-total" title="${esc(totalTip)}">⟶ ${tokStr(d.input)} in</span>`);

  // Thinking
  if (d.thinking > 0) {
    p.push(`<span class="cp-sep">·</span>`);
    p.push(`<span class="cp-chip cp-think" title="Extended thinking budget: ${tokStr(d.thinking)} tokens (counted as output)">🧠 ${tokStr(d.thinking)}</span>`);
  }

  // Estimated output
  const outTip = `Estimated output: ~${d.output.withThinking.toLocaleString()} tokens\n` +
    `  Response: ~${d.output.estimated.toLocaleString()}\n` +
    (d.thinking > 0 ? `  Thinking: ~${d.thinking.toLocaleString()}\n` : '') +
    `(Actual may vary significantly)`;
  p.push(`<span class="cp-sep">·</span>`);
  p.push(`<span class="cp-chip cp-out" title="${esc(outTip)}">~${tokStr(d.output.withThinking)} out</span>`);

  // Cost
  const costTip = `Estimated cost: ${formatUSD(d.cost.total)}\n` +
    `  Input:  ${tokStr(d.input)} × $${pr.input}/1M = ${formatUSD(d.cost.input)}\n` +
    `  Output: ~${tokStr(d.output.withThinking)} × $${pr.output}/1M = ~${formatUSD(d.cost.output)}\n` +
    `Model: ${pr.name} ($${pr.input}/$${pr.output} per 1M in/out)`;
  p.push(`<span class="cp-sep">·</span>`);
  p.push(`<span class="cp-chip cp-cost" title="${esc(costTip)}">💰 ≈ ${formatUSD(d.cost.total)}</span>`);

  rowMain.innerHTML = p.join('');

  // ═══════════════════════════════════════════════════════════════════════
  // ROW 2 — Detail: savings, budget, model pricing
  // ═══════════════════════════════════════════════════════════════════════
  if (rowDetail) {
    const d2 = [];

    // Savings
    if (d.history.saved > 100 && d.history.ctxStats) {
      const cs = d.history.ctxStats;
      let savLabel = `⚡ Saving ~${tokStr(d.history.saved)}`;
      const savPct = d.history.raw > 0 ? Math.round((d.history.saved / d.history.raw) * 100) : 0;
      if (savPct > 0) savLabel += ` (${savPct}%)`;
      const details = [];
      if (cs.dropped)   details.push(`${cs.dropped} summarized`);
      if (cs.truncated) details.push(`${cs.truncated} compressed`);
      details.push(`${cs.full} full`);
      savLabel += ` <span class="cp-dim">${details.join(', ')}</span>`;
      d2.push(`<span class="cp-chip cp-savings">${savLabel}</span>`);
    } else if (d.history.raw > 5000 && d.history.saved <= 100) {
      d2.push(`<span class="cp-chip cp-warn" title="Large history — consider new chat">⚠ ${tokStr(d.history.raw)} history</span>`);
    }

    // Budget
    if (d.budget.limits.enabled && d.budget.limits.dailyUSD > 0) {
      const remaining = Math.max(0, d.budget.limits.dailyUSD - d.budget.stats.today.cost);
      const pct = Math.round((d.budget.stats.today.cost / d.budget.limits.dailyUSD) * 100);
      const budgetTip = `Daily budget: ${formatUSD(d.budget.limits.dailyUSD)}\nUsed today: ${formatUSD(d.budget.stats.today.cost)} (${pct}%)\nRemaining: ${formatUSD(remaining)}`;
      d2.push(`<span class="cp-chip cp-budget" title="${esc(budgetTip)}">📊 ${formatUSD(remaining)} left today (${pct}%)</span>`);
    }

    // Model & pricing
    d2.push(`<span class="cp-chip cp-pricing" title="$${pr.input} per 1M input · $${pr.output} per 1M output">${pr.name} · $${pr.input}/$${pr.output}</span>`);

    rowDetail.innerHTML = d2.join('<span class="cp-sep">·</span>');
  }

  container.classList.add('visible');

  // Show the toggle button now that there's content
  const toggleBtn = document.getElementById('cpToggleBtn');
  if (toggleBtn) toggleBtn.classList.add('has-content');

  // Apply collapsed state (runs every update so state is always consistent)
  _applyCostPreviewCollapsed();

}

function scheduleCostPreview() {
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(updateCostPreview, 150);
}

// ─── Cost preview toggle ───────────────────────────────────────────────────
const _CP_COLLAPSED_KEY = 'brc_cp_collapsed';
let _cpCollapsed = localStorage.getItem(_CP_COLLAPSED_KEY) === 'true';

function toggleCostPreview() {
  _cpCollapsed = !_cpCollapsed;
  localStorage.setItem(_CP_COLLAPSED_KEY, String(_cpCollapsed));
  _applyCostPreviewCollapsed();
}

function _applyCostPreviewCollapsed() {
  const wrap = document.getElementById('costPreviewWrap');
  const icon = document.getElementById('cpToggleIcon');
  if (!wrap) return;
  wrap.classList.toggle('collapsed', _cpCollapsed);
  if (icon) icon.textContent = _cpCollapsed ? '◉' : '◎';
}


// ═══════════════════════════════════════════════════════════════════════════
// TOPBAR BUDGET DISPLAY — enhanced with per-conversation info
// ═══════════════════════════════════════════════════════════════════════════
function updateBudgetDisplay() {
  const el = document.getElementById('tokenDisplay');
  if (!el) return;

  const stats  = getCostStats();
  const limits = getBudgetLimits();
  const td     = stats.today;
  const tt     = stats.total;
  const todayTok = td.inputTokens + td.outputTokens;

  // Current conversation token count
  let convoTok = 0, convoMsgs = 0;
  if (currentConvoId) {
    const convo = getConvo(currentConvoId);
    if (convo) {
      convoMsgs = convo.messages.length;
      for (const m of convo.messages) convoTok += estimateMessageTokens(m);
    }
  }

  let text = '';
  if (convoMsgs > 0) text += `Chat: ~${tokStr(convoTok)} · `;
  text += `Today: ${tokStr(todayTok)} · ${formatUSD(td.cost)}`;
  if (limits.enabled && limits.dailyUSD > 0) {
    const pct = Math.min(100, Math.round((td.cost / limits.dailyUSD) * 100));
    text += ` (${pct}%)`;
  }
  el.textContent = text;

  // Detailed tooltip
  let tip = '';
  if (convoMsgs > 0) {
    tip += `THIS CHAT:\n`;
    tip += `  Messages: ${convoMsgs}\n`;
    tip += `  Estimated tokens: ~${convoTok.toLocaleString()}\n\n`;
  }
  tip += `TODAY:\n`;
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
  } else { el.style.color = ''; }
}
