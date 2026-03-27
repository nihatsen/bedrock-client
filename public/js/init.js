// public/js/init.js — FULL REPLACEMENT

// ═══════════════════════════════════════════════════════════════════════════
// INIT — Instant UI, background model loading
// ═══════════════════════════════════════════════════════════════════════════

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
  if (recovered > 0) {
    saveConvos();
    console.log(`[init] Recovered ${recovered} interrupted stream(s)`);
  }
}

function init() {
  // 1. Recover interrupted streams FIRST (sync, fast)
  recoverInterruptedStreams();

  // 2. Apply UI state immediately (sync, instant)
  applySidebarState();
  applyThinkingState();
  initScrollWatcher();

  // 3. Render conversations immediately (sync, instant)
  renderChatList();
  if (conversations.length > 0) loadConvo(conversations[0].id);
  else newChat();

  // 4. Sync settings form (sync, instant)
  syncSettingsForm();

  // 5. Init input handlers (sync, instant)
  initDragDrop();
  initPaste();

  // 6. Load models in BACKGROUND — don't block UI
  loadModels().catch(e => console.warn('[init] Model load failed:', e));

  // 7. Prompt for API key after a short delay
  setTimeout(() => { if (!settings.apiKey) openSettings(); }, 300);
}

async function loadModels() {
  try {
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

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSidePanel(); closeImgViewer(); closeSettings(); }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); newChat(); }
});

window.addEventListener('beforeunload', () => {
  saveConvos();
  saveUnread();
});

// Boot immediately
init();
