// public/js/stream.js — FULL REPLACEMENT

// ═══════════════════════════════════════════════════════════════════════════
// STREAM — Core streaming + SSE handler + throttled rendering
// ═══════════════════════════════════════════════════════════════════════════

const _renderTimers = {};

// ─── Build savedWraps keyed by stableid (not DOM index) ───────────────────
// Keying by stableid (lang + first 50 chars) means the wrap survives
// re-renders where marked shifts the DOM index of a code block.
function _collectSavedWraps(t) {
  const savedWraps = {};
  t.querySelectorAll('.stream-wrap').forEach(wrap => {
    const key = wrap.dataset.stableid || wrap.dataset.blockidx;
    savedWraps[key] = wrap;
    wrap.remove();
  });
  return savedWraps;
}

function _scheduleRender(msgId, convoId, msg) {
  if (_renderTimers[msgId]) return;
  _renderTimers[msgId] = setTimeout(() => {
    delete _renderTimers[msgId];
    if (currentConvoId !== convoId) return;
    _doRender(msgId, msg);
  }, 150);
}

function _doRender(msgId, msg) {
  const row = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!row) return;
  const t = row.querySelector('.msg-text');
  if (!t) return;

  // 1. Save existing stream-wraps keyed by stableid
  const savedWraps = _collectSavedWraps(t);

  // 2. Remove old streaming indicator
  t.querySelector('.stream-indicator')?.remove();

  // 3. Rebuild markdown
  t.innerHTML = renderMd(msg.text);

  // 4. Process code blocks, reusing saved wraps
  hlStreaming(t, msgId, savedWraps);

  // 5. Live-update side panel (preserves its scroll position internally)
  updateLiveSidePanel(t, msgId);

  // 6. Re-add streaming indicator
  const indicator = document.createElement('div');
  indicator.className = 'stream-indicator';
  indicator.innerHTML = '<span class="stream-spinner-sm"></span><span class="stream-cursor"></span>';
  t.appendChild(indicator);
}

function _flushRender(msgId, msg) {
  if (_renderTimers[msgId]) {
    clearTimeout(_renderTimers[msgId]);
    delete _renderTimers[msgId];
  }
  const row = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!row) return;
  const t = row.querySelector('.msg-text');
  if (!t) return;

  // Use same stableid-keyed collection
  const savedWraps = _collectSavedWraps(t);
  t.querySelector('.stream-indicator')?.remove();
  t.innerHTML = renderMd(msg.text);
  hlStreaming(t, msgId, savedWraps);
  updateLiveSidePanel(t, msgId);
  // No indicator — stream is done
}

function scrollBottomNow() {
  const w = document.getElementById('messagesWrap');
  if (w) w.scrollTop = w.scrollHeight;
}

let _notifRequested = false;
function _requestNotifPermission() {
  if (_notifRequested) return;
  _notifRequested = true;
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ─── Send message ─────────────────────────────────────────────────────────
async function sendMessage() {
  if (!currentConvoId || streamRegistry.has(currentConvoId)) return;
  const input = document.getElementById('msgInput');
  const text  = input.value.trim();
  if (!text && !pendingFiles.length) return;
  if (!settings.apiKey) { toast('Configure API key in Settings', 'error'); openSettings(); return; }

  _requestNotifPermission();

  const convo = getConvo(currentConvoId);
  if (!convo) return;

  const userMsg = {
    id: Date.now().toString(), role: 'user',
    text, files: [...pendingFiles], createdAt: Date.now()
  };
  if (!convo.messages.length && text)
    convo.title = text.slice(0, 42) + (text.length > 42 ? '…' : '');

  convo.messages.push(userMsg);
  bumpConvoToTop(currentConvoId);
  saveConvos();
  appendMsgEl(userMsg);

  input.value = ''; autoResize(input);
  pendingFiles = []; renderFilePreview();
  userScrolledUp = false;
  _setScrollBtnVisible(false);

  await runStream(currentConvoId);
}

// ─── Run stream ───────────────────────────────────────────────────────────
async function runStream(convoId) {
  const convo = getConvo(convoId);
  if (!convo) return;

  const opt       = document.getElementById('modelSelect').selectedOptions[0];
  const modelMax  = parseInt(opt?.dataset.maxOutputTokens || '32000');
  const userMax   = settings.maxTokens || 16000;
  const effectMax = Math.min(userMax, modelMax);
  const modelId   = opt?.value;
  const canThink  = opt?.dataset.supportsThinking === 'true';
  const useThink  = thinkingOn && canThink;
  const budget    = thinkingBudget;

  const aMsg = {
    id: (Date.now() + 1).toString(), role: 'assistant',
    text: '', thinking: null,
    _thinkingBudget: useThink ? budget : 0,
    createdAt: Date.now(),
    modelName: currentModelName || 'Assistant',
  };
  convo.messages.push(aMsg); saveConvos();

  if (currentConvoId === convoId) {
    appendMsgEl(aMsg, true);
    if (!userScrolledUp) scrollBottomNow();
  }

  setStreamingUI(true); renderChatList();

  const ac = new AbortController();
  streamRegistry.set(convoId, { abortController: ac, assistantMsgId: aMsg.id });

  const apiMsgs = convo.messages.slice(0, -1)
    .filter(m => {
      if (m._error) return false;
      if (!m.text?.trim() && (!m.files || !m.files.length)) return false;
      return true;
    })
    .map(m => ({ role: m.role, text: m.text, files: m.files || [] }));

  const saveInterval = setInterval(() => { saveConvos(); }, 1000);

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: apiMsgs, systemPrompt: settings.system || '',
        modelId, region: settings.region || 'us-east-1',
        apiKey: settings.apiKey, extendedThinking: useThink,
        thinkingBudget: budget, maxTokens: effectMax,
        temperature: parseFloat(settings.temperature || 0.7),
      }),
      signal: ac.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let buf      = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          handleSSE(ev, convoId, aMsg, budget);
        } catch (e) { console.error('[SSE parse]', e, line); }
      }
      if (currentConvoId === convoId && !userScrolledUp) scrollBottomNow();
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      aMsg._error = e.message || 'Connection failed';
      toast('Stream error: ' + aMsg._error, 'error');
    }
  }

  clearInterval(saveInterval);
  streamRegistry.delete(convoId);

  if (currentConvoId === convoId) {
    try {
      _flushRender(aMsg.id, aMsg);
      finalizeMsgEl(aMsg);
      if (!userScrolledUp) scrollBottomNow();
      if (!aMsg._error) {
        const u = aMsg.usage ? ` · ${aMsg.usage.outputTokens || 0} tokens` : '';
        toast(`✓ Complete${u}`, 'success');
        playSound();
        if (document.hidden) sendNotif('◈ Reply ready', aMsg.text.slice(0, 100));
      }
    } catch (err) {
      console.error('[stream] Finalize error (non-fatal):', err);
    } finally {
      setStreamingUI(false);
    }
  } else {
    try {
      const bgRow = document.querySelector(`[data-msg-id="${aMsg.id}"]`);
      if (bgRow) { finalizeMsgEl(aMsg); }
    } catch (err) {
      console.error('[stream] Background finalize error (non-fatal):', err);
    }

    unreadCounts[convoId] = (unreadCounts[convoId] || 0) + 1;
    saveUnread(); playSound();
    sendNotif(
      `◈ Reply in "${getConvo(convoId)?.title?.slice(0, 28)}…"`,
      aMsg.text.slice(0, 120), convoId
    );
    toast(`◈ New reply in "${getConvo(convoId)?.title?.slice(0, 24)}…"`, 'info');
  }

  cleanupStreamExpanded(aMsg.id);
  clearLiveSidePanelFor(aMsg.id);
  saveConvos(); renderChatList();
}

// ─── SSE event handler ────────────────────────────────────────────────────
function handleSSE(ev, convoId, msg, budget) {
  const isCur  = currentConvoId === convoId;
  const getRow = () => isCur ? document.querySelector(`[data-msg-id="${msg.id}"]`) : null;

  if (ev.type === 'thinking_start') {
    msg.thinking = '';
    if (!isCur) return;
    const row = getRow(); if (!row) return;
    const body = row.querySelector('.msg-body'); if (!body) return;
    row.querySelector('.thinking-block')?.remove();
    body.appendChild(buildThinkingBlock('', true, budget));
  }

  if (ev.type === 'thinking_delta') {
    msg.thinking = (msg.thinking || '') + ev.text;
    if (!isCur) return;
    const row = getRow(); if (!row) return;
    let tb = row.querySelector('.thinking-block');
    if (!tb) {
      const body = row.querySelector('.msg-body');
      if (body) { tb = buildThinkingBlock('', true, budget); body.appendChild(tb); }
    }
    const headerText = row.querySelector('.thinking-header-text');
    if (headerText) {
      const est = Math.round(msg.thinking.length / 4);
      const budgetStr = budget > 0 ? ` / ${tokStr(budget)}` : '';
      headerText.textContent = `THINKING… — ~${tokStr(est)}${budgetStr} tokens`;
    }
    const c = row.querySelector('.thinking-content');
    if (c) {
      const tn = c.firstChild;
      if (tn?.nodeType === Node.TEXT_NODE) { tn.textContent = msg.thinking; }
      else {
        c.innerHTML = '';
        c.appendChild(document.createTextNode(msg.thinking));
        const cur = document.createElement('span'); cur.className = 'thinking-cursor'; c.appendChild(cur);
      }
      c.scrollTop = c.scrollHeight;
    }
    const fill  = row.querySelector('.thinking-progress-fill');
    const label = row.querySelector('.thinking-progress-label');
    if (fill && budget > 0) {
      const est = Math.round(msg.thinking.length / 4);
      fill.style.width = Math.min(100, (est / budget) * 100) + '%';
      if (label) label.textContent = `~${tokStr(est)} / ${tokStr(budget)} tokens`;
    }
  }

  if (ev.type === 'thinking_end') {
    if (!isCur) return;
    const row = getRow(); if (!row) return;
    const tb = row.querySelector('.thinking-block');
    if (tb) {
      tb.querySelector('.thinking-cursor')?.remove();
      tb.querySelector('.thinking-progress')?.remove();
      const h = tb.querySelector('.thinking-header');
      if (h) {
        const est = Math.round((msg.thinking || '').length / 4);
        h.innerHTML = `
          <div class="thinking-dot"></div>
          <span class="thinking-header-text" style="flex:1">REASONING — ${tokStr(est)} est. tokens</span>
          <svg class="thinking-chevron" width="12" height="12" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
        h.onclick = () => tb.classList.toggle('collapsed');
      }
      if (!tb.classList.contains('collapsed')) tb.classList.add('collapsed');
    }
  }

  if (ev.type === 'text_delta') {
    msg.text += ev.text;
    if (!isCur) return;
    _scheduleRender(msg.id, convoId, msg);
  }

  if (ev.type === 'done') {
    msg.stopReason = ev.stopReason;
  }

  if (ev.type === 'usage') {
    msg.usage = { inputTokens: ev.usage?.inputTokens, outputTokens: ev.usage?.outputTokens };
    if (!isCur) return;
    const row = getRow(); if (!row) return;
    const hdr = row.querySelector('.msg-header');
    let u = hdr?.querySelector('.msg-usage');
    if (!u && hdr) {
      u = document.createElement('span'); u.className = 'msg-usage';
      hdr.insertBefore(u, hdr.querySelector('.msg-actions'));
    }
    if (u) u.textContent = `${ev.usage?.inputTokens || 0}↑ ${ev.usage?.outputTokens || 0}↓`;
  }

  if (ev.type === 'error') {
    msg._error = ev.message;
    toast('Bedrock error: ' + ev.message, 'error');
  }
}
