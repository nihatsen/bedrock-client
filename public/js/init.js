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

  // 2. Populate model select IMMEDIATELY from fallback — zero wait
  _populateModelSelect(FALLBACK_MODELS);

  // 3. Apply UI state (sync, instant)
  applySidebarState();
  applyThinkingState();
  initScrollWatcher();

  // 4. Render conversations (sync, instant — from localStorage)
  renderChatList();
  if (conversations.length > 0) loadConvo(conversations[0].id);
  else newChat();

  // 5. Settings form (sync)
  syncSettingsForm();

  // 6. Input handlers (sync)
  initDragDrop();
  initPaste();

  // 7. Background: fetch live model list and silently swap
  //    No await — does NOT block anything above
  _loadModelsBackground();

  // 8. API key prompt
  setTimeout(() => { if (!settings.apiKey) openSettings(); }, 300);
}

// ─── Populate select from a model array ───────────────────────────────────
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

  // If saved model not found, select first
  if (sel.selectedIndex < 0 && sel.options.length > 0) sel.selectedIndex = 0;

  onModelChange();
}

// ─── Background model fetch — swaps list when ready, no flash ─────────────
async function _loadModelsBackground() {
  if (!settings.apiKey) return; // No key → fallback is fine, skip fetch

  try {
    const headers = {};
    if (settings.apiKey) headers['x-api-key'] = settings.apiKey;
    if (settings.region) headers['x-region']  = settings.region;

    const res = await fetch('/api/models', { headers });
    if (!res.ok) return;

    const data = await res.json();
    const models = data.models || [];
    if (!models.length) return;

    // Only swap if we got more/different models than the fallback
    if (models.length > FALLBACK_MODELS.length || data.source === 'bedrock') {
      console.log(`[models] Live list loaded: ${models.length} models (${data.source})`);
      _populateModelSelect(models);
    }
  } catch (e) {
    // Silently ignore — fallback list stays
    console.warn('[models] Background fetch failed, using fallback:', e.message);
  }
}

// ─── Public loadModels (called from settings when credentials change) ──────
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
      console.log(`[models] Reloaded: ${models.length} models`);
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
