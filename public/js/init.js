// public/js/init.js — FULL REPLACEMENT
// / = blank page (no conversation), /c/{id} = existing chat

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
      // Chat doesn't exist or is empty — blank page
      showBlankState();
      _replaceRootURL();
      if (convo) toast('Chat not found', 'info');
    }
  } else {
    // Root URL — blank page
    showBlankState();
    _replaceRootURL();
  }

  syncSettingsForm();
  initDragDrop();
  initPaste();

  if (settings.apiKey) _loadModelsBackground();
  setTimeout(() => { if (!settings.apiKey) openSettings(); }, 300);

  updateTokenDisplay();
}

function _populateModelSelect(models) {
  const sel = document.getElementById('modelSelect');
  if (!sel) return;

  const savedId = settings.modelId || DEFAULT_MODEL;
  sel.innerHTML = '';

  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    opt.dataset.supportsThinking = m.supportsThinking;
    opt.dataset.maxOutputTokens  = m.maxOutputTokens || 32000;
    if (m.id === savedId) opt.selected = true;
    sel.appendChild(opt);
  });

  if (!sel.querySelector(`option[value="${savedId}"]`) && sel.options.length > 0) {
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
    if (models.length > FALLBACK_MODELS.length || data.source === 'bedrock') {
      console.log(`[models] Live: ${models.length} (${data.source})`);
      _populateModelSelect(models);
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
    if (models.length) { _populateModelSelect(models); applyThinkingState(); }
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
  if (e.key === 'Escape') { closeSidePanel(); closeImgViewer(); closeSettings(); }
  if ((e.metaKey||e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  if ((e.metaKey||e.ctrlKey) && e.key === 'n') { e.preventDefault(); newChat(); }
});

window.addEventListener('beforeunload', () => { saveConvos(); saveUnread(); });

init();
