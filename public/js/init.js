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

function init() {
  // 1. Recover streams (sync)
  recoverInterruptedStreams();

  // 2. Populate model select from fallback FIRST (instant, zero network)
  _populateModelSelect(FALLBACK_MODELS);

  // 3. Apply thinking state AFTER model select is populated
  //    (so slider max is already set by onModelChange inside _populateModelSelect)
  applyThinkingState();

  // 4. Apply sidebar state
  applySidebarState();

  // 5. Init scroll watcher
  initScrollWatcher();

  // 6. Render conversations from localStorage (instant)
  renderChatList();
  if (conversations.length > 0) loadConvo(conversations[0].id);
  else newChat();

  // 7. Settings form
  syncSettingsForm();

  // 8. Input handlers
  initDragDrop();
  initPaste();

  // 9. Background live model fetch — silently swaps when ready
  if (settings.apiKey) {
    _loadModelsBackground();
  }

  // 10. API key prompt
  setTimeout(() => { if (!settings.apiKey) openSettings(); }, 300);
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

  // If saved model not in list, select first
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
      console.log(`[models] Live list: ${models.length} (${data.source})`);
      _populateModelSelect(models);
      // Re-apply thinking state after model swap to ensure budget/max is correct
      applyThinkingState();
    }
  } catch (e) {
    console.warn('[models] Background fetch failed, using fallback:', e.message);
  }
}

async function loadModels() {
  try {
    const headers = {};
    if (settings.apiKey) headers['x-api-key'] = settings.apiKey;
    if (settings.region) headers['x-region']  = settings.region;
    const res = await fetch('/api/models', { headers });
    const data = await res.json();
    const models = data.models || [];
    if (models.length) {
      _populateModelSelect(models);
      applyThinkingState();
      console.log(`[models] Reloaded: ${models.length}`);
    }
  } catch (e) {
    console.error('loadModels:', e);
    toast('Could not reload models', 'error');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSidePanel(); closeImgViewer(); closeSettings(); }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); newChat(); }
});

window.addEventListener('beforeunload', () => { saveConvos(); saveUnread(); });

init();
