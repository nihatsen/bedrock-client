// public/js/init.js — FULL REPLACEMENT

function recoverInterruptedStreams() {
  let recovered = 0;
  conversations.forEach(convo => {
    const last = convo.messages[convo.messages.length - 1];
    if (last?.role === 'assistant' && !last.stopReason && !last._error) {
      if (last.text || last.thinking) {
        last._error = 'Response interrupted (page was closed). Click ↺ Retry to continue.';
        recovered++;
      } else {
        convo.messages.pop();
        recovered++;
      }
    }
  });
  if (recovered > 0) { saveConvos(); console.log(`[init] Recovered ${recovered} interrupted stream(s)`); }
}

function _cleanupEmptyConversations() {
  const before = conversations.length;
  conversations = conversations.filter(c => c.messages.length > 0);
  if (conversations.length !== before) {
    saveConvos();
    console.log(`[init] Removed ${before - conversations.length} empty conversation(s)`);
  }
}

function _getInitialChatId() {
  const match = window.location.pathname.match(/^\/c\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function init() {
  recoverInterruptedStreams();
  _cleanupEmptyConversations();

  _populateModelSelect(FALLBACK_MODELS);

  applyThinkingState();
  applySidebarState();
  initScrollWatcher();

  renderChatList();

  const urlChatId = _getInitialChatId();

  if (urlChatId) {
    const convo = getConvo(urlChatId);
    if (convo && convo.messages.length > 0) {
      loadConvo(urlChatId, false);
      _replaceChatURL(urlChatId);
    } else {
      showBlankState();
      _replaceRootURL();
      if (convo) toast('Chat not found', 'info');
    }
  } else {
    showBlankState();
    _replaceRootURL();
  }

  syncSettingsForm();
  initDragDrop();
  initPaste();

  const msgInput = document.getElementById('msgInput');
  if (msgInput) {
    msgInput.addEventListener('input', () => {
      if (typeof scheduleCostPreview === 'function') scheduleCostPreview();
    });
  }

  if (typeof updateBudgetDisplay === 'function') updateBudgetDisplay();

  if (settings.apiKey) _loadModelsBackground();

  // Only auto-open settings if no API key AND a Bedrock model is selected
  setTimeout(() => {
    if (!settings.apiKey && !isPuterModel(currentModelId)) openSettings();
  }, 300);
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL SELECT — <optgroup> for Bedrock + Puter Claude + Puter Kimi
// ═══════════════════════════════════════════════════════════════════════════
function _populateModelSelect(bedrockModels) {
  const sel = document.getElementById('modelSelect');
  if (!sel) return;

  const savedId = settings.modelId || DEFAULT_MODEL;
  sel.innerHTML = '';

  // ── Bedrock optgroup ───────────────────────────────────────────────────
  if (bedrockModels.length > 0) {
    const grp = document.createElement('optgroup');
    grp.label = '☁ Amazon Bedrock';
    bedrockModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      opt.dataset.supportsThinking = m.supportsThinking;
      opt.dataset.maxOutputTokens  = m.maxOutputTokens || 32000;
      opt.dataset.provider         = 'bedrock';
      if (m.id === savedId) opt.selected = true;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }

  // ── Split Puter models into Claude and Kimi groups ─────────────────────
  const puterClaude = PUTER_MODELS.filter(m => m.id.includes('claude'));
  const puterKimi   = PUTER_MODELS.filter(m => !m.id.includes('claude'));

  if (puterClaude.length > 0) {
    const grp = document.createElement('optgroup');
    grp.label = '🌐 Free Claude (Puter)';
    puterClaude.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      opt.dataset.supportsThinking = m.supportsThinking || false;
      opt.dataset.maxOutputTokens  = m.maxOutputTokens || 8192;
      opt.dataset.provider         = 'puter';
      if (m.id === savedId) opt.selected = true;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }

  if (puterKimi.length > 0) {
    const grp = document.createElement('optgroup');
    grp.label = '🌙 Free Kimi (Puter)';
    puterKimi.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      opt.dataset.supportsThinking = m.supportsThinking || false;
      opt.dataset.maxOutputTokens  = m.maxOutputTokens || 8192;
      opt.dataset.provider         = 'puter';
      if (m.id === savedId) opt.selected = true;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }

  // Ensure something is selected
  if (!sel.querySelector(`option[value="${CSS.escape(savedId)}"]`) && sel.options.length > 0) {
    sel.selectedIndex = 0;
  }
  onModelChange();
}

async function _loadModelsBackground() {
  try {
    const headers = {};
    if (settings.apiKey) headers['x-api-key'] = settings.apiKey;
    if (settings.region) headers['x-region']  = settings.region;
    const res = await fetch('/api/models', { headers });
    if (!res.ok) return;
    const data = await res.json();
    const models = data.models || [];
    if (!models.length) return;
    // Filter out any puter: models from server response (we add them client-side)
    const bedrockOnly = models.filter(m => !m.id.startsWith('puter:'));
    if (bedrockOnly.length > FALLBACK_MODELS.length || data.source === 'bedrock') {
      console.log(`[models] Live: ${bedrockOnly.length} (${data.source})`);
      _populateModelSelect(bedrockOnly);
      applyThinkingState();
    }
  } catch(e) { console.warn('[models] Background fetch failed:', e.message); }
}

async function loadModels() {
  try {
    const headers = {};
    if (settings.apiKey) headers['x-api-key'] = settings.apiKey;
    if (settings.region) headers['x-region']  = settings.region;
    const res = await fetch('/api/models', { headers });
    const data = await res.json();
    const models = data.models || [];
    const bedrockOnly = models.filter(m => !m.id.startsWith('puter:'));
    if (bedrockOnly.length) { _populateModelSelect(bedrockOnly); applyThinkingState(); }
  } catch(e) { console.error('loadModels:', e); toast('Could not reload models','error'); }
}

window.addEventListener('popstate', e => {
  const chatId = e.state?.chatId;
  if (chatId) {
    const convo = getConvo(chatId);
    if (convo && convo.messages.length > 0) {
      loadConvo(chatId, false);
    } else {
      showBlankState();
      _replaceRootURL();
    }
  } else {
    showBlankState();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSidePanel(); closeImgViewer(); closeSettings(); closePasteViewer(); if (typeof _dismissBudgetWarning === 'function') _dismissBudgetWarning(); }
  if ((e.metaKey||e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  if ((e.metaKey||e.ctrlKey) && e.key === 'n') { e.preventDefault(); newChat(); }
});

window.addEventListener('beforeunload', () => { saveConvos(); saveUnread(); });

init();
