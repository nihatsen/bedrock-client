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
  recoverInterruptedStreams();

  // Pre-populate model select with saved model so it's never empty
  _prePopulateModelSelect();

  applySidebarState();
  applyThinkingState();
  initScrollWatcher();

  renderChatList();
  if (conversations.length > 0) loadConvo(conversations[0].id);
  else newChat();

  syncSettingsForm();
  initDragDrop();
  initPaste();

  // Load models in background — will replace pre-populated option
  loadModels().catch(e => console.warn('[init] Model load failed:', e));

  setTimeout(() => { if (!settings.apiKey) openSettings(); }, 300);
}

// Show saved model immediately so the select is never empty
function _prePopulateModelSelect() {
  const sel = document.getElementById('modelSelect');
  if (!sel) return;

  const savedId = settings.modelId || DEFAULT_MODEL;
  // If select already has options, skip
  if (sel.options.length > 0) return;

  const opt = document.createElement('option');
  opt.value = savedId;
  // Make a readable name from the ID
  opt.textContent = savedId
    .replace(/^(global|us|eu|ap)\./i, (m) => `(${m.replace('.','').toUpperCase()}) `)
    .replace(/^anthropic\./, '')
    .replace(/^meta\./, '')
    .replace(/^amazon\./, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\s*V\d.*$/, '')
    .trim() + ' (loading…)';
  opt.selected = true;
  sel.appendChild(opt);
  onModelChange();
}

async function loadModels() {
  try {
    const headers = {};
    if (settings.apiKey) headers['x-api-key'] = settings.apiKey;
    if (settings.region) headers['x-region'] = settings.region;

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
      opt.dataset.maxOutputTokens = m.maxOutputTokens || 32000;
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

window.addEventListener('beforeunload', () => { saveConvos(); saveUnread(); });

init();
