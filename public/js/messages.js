// public/js/messages.js — FULL REPLACEMENT
// Markdown render cache + batch rendering for fast chat switching

// ─── Markdown render cache ─────────────────────────────────────────────────
// Key: msgId, Value: rendered HTML string
// Avoids re-running marked.parse() on every chat switch
const _mdCache = new Map();
const _MD_CACHE_MAX = 500; // max entries before LRU trim

function _cachedRenderMd(msgId, text) {
  if (!text) return '';
  const cached = _mdCache.get(msgId);
  if (cached !== undefined) return cached;
  const html = renderMd(text);
  _mdCache.set(msgId, html);
  // Trim cache if too large
  if (_mdCache.size > _MD_CACHE_MAX) {
    const firstKey = _mdCache.keys().next().value;
    _mdCache.delete(firstKey);
  }
  return html;
}

function invalidateMdCache(msgId) { _mdCache.delete(msgId); }
function clearMdCache() { _mdCache.clear(); }

// ─── renderMessages: batch-render for large chats ─────────────────────────
function renderMessages(messages, activeStreamId = null) {
  const wrap = document.getElementById('messagesWrap');

  // Remove old message rows but keep emptyState
  wrap.querySelectorAll('.msg-row').forEach(r => r.remove());

  const empty = document.getElementById('emptyState');
  if (!messages.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  if (messages.length <= 20) {
    // Small chat: render synchronously
    messages.forEach(m => appendMsgEl(m, m.id === activeStreamId));
  } else {
    // Large chat: render first 20 immediately, rest in idle batches
    const FIRST_BATCH = 20;
    const BATCH_SIZE  = 15;

    for (let i = 0; i < FIRST_BATCH && i < messages.length; i++) {
      appendMsgEl(messages[i], messages[i].id === activeStreamId);
    }

    if (messages.length > FIRST_BATCH) {
      _batchRender(messages, FIRST_BATCH, BATCH_SIZE, activeStreamId, wrap);
    }
  }
}

function _batchRender(messages, startIdx, batchSize, activeStreamId, wrap) {
  if (startIdx >= messages.length) return;

  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1));

  idle(deadline => {
    let i = startIdx;
    // Process as many as time allows (or one batch if no deadline API)
    while (i < messages.length) {
      const timeLeft = deadline.timeRemaining ? deadline.timeRemaining() : 5;
      if (timeLeft < 1 && i > startIdx) break; // yield back

      appendMsgEl(messages[i], messages[i].id === activeStreamId);
      i++;

      if (i - startIdx >= batchSize) break;
    }

    if (i < messages.length) {
      _batchRender(messages, i, batchSize, activeStreamId, wrap);
    }
  }, { timeout: 100 });
}

function appendMsgEl(msg, isStreaming = false) {
  const wrap = document.getElementById('messagesWrap');
  document.getElementById('emptyState').style.display = 'none';

  const row = document.createElement('div');
  row.className = `msg-row ${msg.role}${isStreaming ? ' streaming' : ''}`;
  row.dataset.msgId = msg.id;

  const modelLabel = msg.role === 'assistant'
    ? (msg.modelName || currentModelName || 'Assistant') : null;

  const header = document.createElement('div');
  header.className = 'msg-header';
  header.innerHTML = `
    <span class="role-badge">${msg.role === 'user' ? '👤 You' : `◈ ${esc(modelLabel)}`}</span>
    <span class="msg-time">${fmtTime(msg.createdAt)}</span>
    ${msg.usage ? `<span class="msg-usage">${msg.usage.inputTokens||0}↑ ${msg.usage.outputTokens||0}↓</span>` : ''}`;

  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  const cpBtn = document.createElement('button');
  cpBtn.className = 'msg-action-btn'; cpBtn.textContent = 'Copy';
  cpBtn.onclick = () => navigator.clipboard.writeText(msg.text || '').then(() => {
    cpBtn.textContent = 'Copied!'; setTimeout(() => cpBtn.textContent = 'Copy', 1500);
  });
  actions.appendChild(cpBtn);

  if (msg.role === 'user') {
    const eb = document.createElement('button');
    eb.className = 'msg-action-btn edit-btn'; eb.textContent = '✎ Edit';
    eb.onclick = () => editMessage(msg.id);
    actions.appendChild(eb);
    const db = document.createElement('button');
    db.className = 'msg-action-btn'; db.textContent = '✕';
    db.onclick = () => deleteMessagePair(msg.id);
    actions.appendChild(db);
  }

  if (msg.role === 'assistant') {
    const rb = document.createElement('button');
    rb.className = 'msg-action-btn'; rb.textContent = '↺ Retry';
    rb.onclick = () => retryMessage(msg.id);
    actions.appendChild(rb);
  }

  header.appendChild(actions);

  const body = document.createElement('div');
  body.className = 'msg-body';

  // File chips + inline images
  if (msg.files?.length) {
    const chips = document.createElement('div');
    chips.className = 'file-chips';
    msg.files.forEach(f => {
      if (f.type === 'image') {
        const img = document.createElement('img');
        img.src = `data:${f.mediaType};base64,${f.data}`;
        img.className = 'inline-img'; img.title = 'Click to enlarge';
        img.onclick = () => openImgViewer(img.src);
        body.appendChild(img);
      }
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.innerHTML = `<span class="file-chip-name">${esc(f.name)}</span><span class="file-chip-size">${fmtSize(f.size)}</span>`;
      chips.appendChild(chip);
    });
    body.appendChild(chips);
  }

  const textEl = document.createElement('div');
  textEl.className = 'msg-text';

  if (msg.role === 'assistant' && msg._error) {
    textEl.innerHTML = buildErrorHTML(msg._error, msg.id);
  } else if (msg.role === 'assistant') {
    if (isStreaming) {
      if (msg.text) {
        // Use cache for streaming too (partial render is fine)
        textEl.innerHTML = _cachedRenderMd(msg.id + '_stream', msg.text);
        hlStreaming(textEl, msg.id, {});
      }
      const indicator = document.createElement('div');
      indicator.className = 'stream-indicator';
      indicator.innerHTML = '<span class="stream-spinner-sm"></span><span class="stream-cursor"></span>';
      textEl.appendChild(indicator);
    } else {
      // Use cache — avoids re-running marked.parse on chat switch
      textEl.innerHTML = _cachedRenderMd(msg.id, msg.text || '');
      requestAnimationFrame(() => processCodeBlocks(textEl, msg.text));
    }
  } else {
    textEl.innerHTML = esc(msg.text || '').replace(/\n/g, '<br>');
  }
  body.appendChild(textEl);

  if (msg.stopReason && !isStreaming) {
    const sb = document.createElement('div');
    sb.className = `stop-badge ${msg.stopReason}`;
    sb.textContent = msg.stopReason === 'end_turn' ? '✓ Complete' : '⚠ Max tokens';
    body.appendChild(sb);
  }

  if (msg.thinking != null)
    body.appendChild(buildThinkingBlock(msg.thinking, isStreaming, msg._thinkingBudget));

  row.appendChild(header);
  row.appendChild(body);
  wrap.appendChild(row);

  if (msg.role === 'assistant' && !isStreaming && !msg._error && msg.text) {
    requestAnimationFrame(() => {
      const fl = buildFileList(body);
      if (fl) row.appendChild(fl);
    });
  }

  return row;
}

function finalizeMsgEl(msg) {
  const row = document.querySelector(`[data-msg-id="${msg.id}"]`);
  if (!row) return;
  row.classList.remove('streaming');

  const body   = row.querySelector('.msg-body');
  const textEl = row.querySelector('.msg-text');
  if (!textEl) return;

  textEl.querySelector('.stream-indicator')?.remove();
  textEl.querySelector('.stream-cursor')?.remove();
  textEl.querySelector('.stream-spinner-sm')?.remove();

  // Invalidate the streaming partial cache entry
  _mdCache.delete(msg.id + '_stream');

  if (msg._error) {
    textEl.innerHTML = buildErrorHTML(msg._error, msg.id);
    row.querySelector('.thinking-block')?.remove();
    return;
  }

  // Cache final rendered markdown
  const html = renderMd(msg.text || '');
  _mdCache.set(msg.id, html);
  textEl.innerHTML = html;
  processCodeBlocks(textEl, msg.text);

  const thinkingEl = body.querySelector('.thinking-block');

  if (msg.stopReason) {
    body.querySelector('.stop-badge')?.remove();
    const sb = document.createElement('div');
    sb.className = `stop-badge ${msg.stopReason}`;
    sb.textContent = msg.stopReason === 'end_turn' ? '✓ Complete' : '⚠ Max tokens';
    if (thinkingEl) body.insertBefore(sb, thinkingEl);
    else body.appendChild(sb);
  }

  if (msg.thinking) {
    const tb = body.querySelector('.thinking-block');
    if (tb) {
      tb.querySelector('.thinking-cursor')?.remove();
      tb.querySelector('.thinking-progress')?.remove();
      const ic = tb.querySelector('.thinking-spinner');
      if (ic) ic.className = 'thinking-dot';
      const sl = tb.querySelector('.thinking-header-text');
      if (sl) { const est = Math.round(msg.thinking.length / 4); sl.textContent = `REASONING — ${tokStr(est)} est. tokens`; }
      if (!tb.classList.contains('collapsed')) tb.classList.add('collapsed');
    }
  }

  row.querySelector('.file-list')?.remove();
  requestAnimationFrame(() => {
    const fl = buildFileList(body);
    if (fl) row.appendChild(fl);
  });
}

function buildErrorHTML(err, msgId) {
  const c = document.createElement('div'); c.className = 'msg-error';
  const e = document.createElement('div'); e.className = 'err-text'; e.textContent = '⚠ ' + err;
  const r = document.createElement('button'); r.className = 'retry-btn'; r.textContent = '↺ Retry';
  r.dataset.retryMsgId = msgId;
  c.appendChild(e); c.appendChild(r);
  const t = document.createElement('div'); t.appendChild(c); return t.innerHTML;
}

document.addEventListener('click', function(e) {
  const btn = e.target.closest('.retry-btn[data-retry-msg-id]');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  retryMessage(btn.dataset.retryMsgId);
});

function editMessage(msgId) {
  if (streamRegistry.has(currentConvoId)) { toast('Stop current response first', 'error'); return; }
  const convo = getConvo(currentConvoId);
  const msg   = convo?.messages.find(m => m.id === msgId);
  const row   = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msg || !row) return;

  const textEl   = row.querySelector('.msg-text');
  const origHTML = textEl.innerHTML;

  const ta = document.createElement('textarea');
  ta.className = 'msg-edit-textarea'; ta.value = msg.text || '';
  setTimeout(() => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }, 0);
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };

  const saveBtn = document.createElement('button');
  saveBtn.className = 'msg-edit-save'; saveBtn.textContent = '✓ Save & Resend';
  saveBtn.onclick = () => {
    const t = ta.value.trim();
    if (!t) { toast('Cannot be empty', 'error'); return; }
    msg.text = t;
    invalidateMdCache(msgId); // invalidate cache for edited message
    convo.messages.splice(convo.messages.indexOf(msg) + 1);
    saveConvos(); renderMessages(convo.messages);
    runStream(currentConvoId);
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'msg-edit-cancel'; cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => { textEl.innerHTML = origHTML; };

  ta.onkeydown = e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
  };

  const wrap = document.createElement('div'); wrap.className = 'msg-edit-wrap';
  const acts = document.createElement('div'); acts.className = 'msg-edit-actions';
  acts.appendChild(saveBtn); acts.appendChild(cancelBtn);
  wrap.appendChild(ta); wrap.appendChild(acts);
  textEl.innerHTML = ''; textEl.appendChild(wrap);
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

function deleteMessagePair(userMsgId) {
  const convo = getConvo(currentConvoId);
  if (!convo || streamRegistry.has(currentConvoId)) { toast('Stop current response first', 'error'); return; }
  const idx = convo.messages.findIndex(m => m.id === userMsgId);
  if (idx === -1) return;
  const w = document.getElementById('messagesWrap');
  const saved = w.scrollTop;
  const count = convo.messages[idx + 1]?.role === 'assistant' ? 2 : 1;
  // Invalidate caches
  convo.messages.slice(idx, idx + count).forEach(m => invalidateMdCache(m.id));
  convo.messages.splice(idx, count);
  saveConvos(); renderMessages(convo.messages);
  requestAnimationFrame(() => { w.scrollTop = saved; });
}

function retryMessage(aId) {
  const convo = getConvo(currentConvoId);
  if (!convo || streamRegistry.has(currentConvoId)) { toast('Stop current response first', 'error'); return; }
  const idx = convo.messages.findIndex(m => m.id === aId);
  if (idx === -1) return;
  // Invalidate caches for removed messages
  convo.messages.slice(idx).forEach(m => invalidateMdCache(m.id));
  convo.messages.splice(idx);
  saveConvos(); renderMessages(convo.messages);
  const last = convo.messages[convo.messages.length - 1];
  if (!last || last.role !== 'user') { toast('Nothing to retry', 'error'); return; }
  runStream(currentConvoId);
}

function openImgViewer(src) {
  document.getElementById('imgModalImg').src = src;
  document.getElementById('imgModal').classList.add('open');
}
function closeImgViewer() { document.getElementById('imgModal').classList.remove('open'); }
