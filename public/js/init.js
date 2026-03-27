// ═══════════════════════════════════════════════════════════════════════════
// INIT — Bootstrap, model loading, keyboard shortcuts, crash recovery
// ═══════════════════════════════════════════════════════════════════════════

// FIX: Recover interrupted streams on page load.
// If the user closed the tab while a stream was active, the assistant
// message will have text but no stopReason and no _error. Mark it as
// interrupted so the UI shows a retry button.
function recoverInterruptedStreams() {
  let recovered = 0;
  conversations.forEach(convo => {
    const last = convo.messages[convo.messages.length - 1];
    if (last?.role === 'assistant' && !last.stopReason && !last._error) {
      if (last.text || last.thinking) {
        // Has partial content — mark as interrupted with retry option
        last._error = 'Response interrupted (page was closed). Click ↺ Retry to continue.';
        recovered++;
      } else {
        // Empty assistant message — just remove it
        convo.messages.pop();
        recovered++;
      }
    }
  });
  if (recovered > 0) {
    saveConvos();
    console.log(`[init] Recovered ${recovered} interrupted stream(s)`);
  }
}

async function init() {
  // Recover any interrupted streams BEFORE rendering
  recoverInterruptedStreams();

  await loadModels();

  applySidebarState();
  applyThinkingState();

  // Initialize scroll watcher BEFORE loading conversations
  initScrollWatcher();

  renderChatList();
  if (conversations.length > 0) loadConvo(conversations[0].id);
  else newChat();

  syncSettingsForm();
  initDragDrop();
  initPaste();

  setTimeout(() => { if (!settings.apiKey) openSettings(); }, 500);
}

async function loadModels() {
  try {
    // FIX: Pass the API key and region to the backend so it can
    // dynamically fetch the model list from Bedrock's APIs.
    const headers = {};
    if (settings.apiKey) headers['x-api-key'] = settings.apiKey;
    if (settings.region) headers['x-region']  = settings.region;

    const res = await fetch('/api/models', { headers });
    const data = await res.json();
    const models = data.models || [];

    if (data.source && data.source !== 'fallback') {
      console.log(`[models] Loaded ${models.length} models from ${data.source}`);
    }

    const sel = document.getElementById('modelSelect');
    sel.innerHTML = '';
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      opt.dataset.supportsThinking = m.supportsThinking;
      opt.dataset.maxOutputTokens  = m.maxOutputTokens || 32000;
      if (m.id === (settings.modelId || DEFAULT_MODEL)) opt.selected = true;
      sel.appendChild(opt);
    });
    onModelChange();
  } catch (e) { console.error('loadModels:', e); }
}

// ─── Global keyboard shortcuts ────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSidePanel(); closeImgViewer(); closeSettings(); }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); newChat(); }
});

// FIX: Save all state before the tab/window is closed.
// Without this, any streaming text accumulated since the last 1-second
// save interval is lost. This also ensures finished conversations are
// always persisted.
window.addEventListener('beforeunload', () => {
  saveConvos();
  saveUnread();
});

// ─── Boot ─────────────────────────────────────────────────────────────────
init();