// public/js/messages.js — FULL REPLACEMENT

// ─── Markdown cache ────────────────────────────────────────────────────────
const _mdCache = new Map();
const _MD_CACHE_MAX = 400;

function _cachedRenderMd(key, text) {
  if (!text) return '';
  const c = _mdCache.get(key);
  if (c !== undefined) return c;
  const html = renderMd(text);
  _mdCache.set(key, html);
  if (_mdCache.size > _MD_CACHE_MAX)
    _mdCache.delete(_mdCache.keys().next().value);
  return html;
}
function invalidateMdCache(msgId) {
  _mdCache.delete(msgId); _mdCache.delete(msgId + '_stream');
}
function clearMdCache() { _mdCache.clear(); }

// ─── Lazy code block highlighting via IntersectionObserver ─────────────────
// Code blocks are only highlighted when they scroll into view.
// This makes chat switching instant regardless of how many code blocks exist.
let _codeBlockObserver = null;

function _getCodeBlockObserver() {
  if (_codeBlockObserver) return _codeBlockObserver;
  _codeBlockObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const row = entry.target;
      _processRowCodeBlocks(row);
      _codeBlockObserver.unobserve(row);
    });
  }, {
    root: document.getElementById('messagesWrap'),
    rootMargin: '200px 0px', // pre-load 200px above/below viewport
    threshold: 0,
  });
  return _codeBlockObserver;
}

function _processRowCodeBlocks(row) {
  const textEl = row.querySelector('.msg-text');
  const msgId  = row.dataset.msgId;
  if (!textEl || !msgId) return;
  const msg = _findMsg(msgId);
  if (!msg || msg._error) return;
  // Process code blocks (highlight, wrap, etc.)
  processCodeBlocks(textEl, msg.text);
  // File list
  const body = row.querySelector('.msg-body');
  if (body && !row.querySelector('.file-list')) {
    const fl = buildFileList(body);
    if (fl) row.appendChild(fl);
  }
  row.dataset.codeProcessed = '1';
}

function _findMsg(msgId) {
  if (!currentConvoId) return null;
  return getConvo(currentConvoId)?.messages.find(m => m.id === msgId) || null;
}

// ─── renderMessages — DocumentFragment, single DOM write ──────────────────
function renderMessages(messages, activeStreamId = null) {
  const wrap  = document.getElementById('messagesWrap');
  const empty = document.getElementById('emptyState');

  wrap.querySelectorAll('.msg-row').forEach(r => r.remove());

  if (!messages.length) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const obs = _getCodeBlockObserver();
  const frag = document.createDocumentFragment();

  messages.forEach(m => {
    const row = appendMsgEl(m, m.id === activeStreamId, true);
    frag.appendChild(row);
  });

  wrap.appendChild(frag);

  // Observe assistant rows for lazy code block processing
  wrap.querySelectorAll('.msg-row.assistant:not(.streaming):not([data-code-processed])').forEach(row => {
    obs.observe(row);
  });

  // Scroll to bottom
  requestAnimationFrame(() => {
    wrap.scrollTop = wrap.scrollHeight;
    userScrolledUp = false;
    _setScrollBtnVisible(false);
  });
}

// ─── appendMsgEl ──────────────────────────────────────────────────────────
function appendMsgEl(msg, isStreaming = false, returnOnly = false) {
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

  if (msg.files?.length) {
    const chips = document.createElement('div'); chips.className = 'file-chips';
    msg.files.forEach(f => {
      if (f.type === 'image') {
        const img = document.createElement('img');
        img.src = `data:${f.mediaType};base64,${f.data}`;
        img.className = 'inline-img'; img.title = 'Click to enlarge';
        img.onclick = () => openImgViewer(img.src);
        body.appendChild(img);
      }
      const chip = document.createElement('div'); chip.className = 'file-chip';
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
        textEl.innerHTML = _cachedRenderMd(msg.id + '_stream', msg.text);
        hlStreaming(textEl, msg.id, {});
      }
      const ind = document.createElement('div');
      ind.className = 'stream-indicator';
      ind.innerHTML = '<span class="stream-spinner-sm"></span><span class="stream-cursor"></span>';
      textEl.appendChild(ind);
    } else {
      // Use cached markdown — no re-parse on chat switch
      textEl.innerHTML = _cachedRenderMd(msg.id, msg.text || '');
      // Code blocks processed lazily by IntersectionObserver (see renderMessages)
      // For individually appended messages (new messages), process immediately when visible
      if (!returnOnly) {
        requestAnimationFrame(() => {
          processCodeBlocks(textEl, msg.text);
          const fl = buildFileList(body);
          if (fl) row.appendChild(fl);
          row.dataset.codeProcessed = '1';
        });
      }
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

  if (!returnOnly) {
    const wrap = document.getElementById('messagesWrap');
    document.getElementById('emptyState').style.display = 'none';
    wrap.appendChild(row);
  }

  return row;
}

// ─── finalizeMsgEl ─────────────────────────────────────────────────────────
function finalizeMsgEl(msg) {
  const row = document.querySelector(`[data-msg-id="${msg.id}"]`);
  if (!row) { invalidateMdCache(msg.id); return; }

  // ── Step 1: Mark as no longer streaming (prevents late _doRender) ──────
  row.classList.remove('streaming');

  // ── Step 2: Remove ALL streaming artifacts from entire row ─────────────
  row.querySelectorAll(
    '.stream-indicator, .stream-cursor, .stream-spinner-sm'
  ).forEach(el => el.remove());

  const body   = row.querySelector('.msg-body');
  const textEl = row.querySelector('.msg-text');
  if (!textEl) return;

  _mdCache.delete(msg.id + '_stream');

  if (msg._error) {
    textEl.innerHTML = buildErrorHTML(msg._error, msg.id);
    row.querySelector('.thinking-block')?.remove();
    return;
  }

  // ── Step 3: Render final text ──────────────────────────────────────────
  const html = renderMd(msg.text || '');
  _mdCache.set(msg.id, html);
  textEl.innerHTML = html;
  processCodeBlocks(textEl, msg.text);
  row.dataset.codeProcessed = '1';

  // ── Step 4: Final safety cleanup (catches any late race-condition) ─────
  row.querySelectorAll(
    '.stream-indicator, .stream-cursor, .stream-spinner-sm'
  ).forEach(el => el.remove());

  // ── Step 5: Thinking block ─────────────────────────────────────────────
  const thinkingEl = body.querySelector('.thinking-block');

  if (msg.thinking) {
    if (thinkingEl) {
      thinkingEl.querySelectorAll('.thinking-cursor,.thinking-progress').forEach(el => el.remove());
      const ic = thinkingEl.querySelector('.thinking-spinner'); if (ic) ic.className = 'thinking-dot';
      const sl = thinkingEl.querySelector('.thinking-header-text');
      if (sl) { const est = Math.round(msg.thinking.length/4); sl.textContent = `REASONING — ${tokStr(est)} est. tokens`; }
      const tl = thinkingEl.querySelector('.thinking-topic');
      if (tl) { tl.textContent = ''; tl.style.display = 'none'; }
      if (!thinkingEl.classList.contains('collapsed')) thinkingEl.classList.add('collapsed');
    }
  } else if (thinkingEl) {
    // No thinking content — remove empty thinking block entirely
    thinkingEl.remove();
  }

  // ── Step 6: Stop badge (placed before thinking block) ──────────────────
  if (msg.stopReason) {
    body.querySelector('.stop-badge')?.remove();
    const sb = document.createElement('div');
    sb.className = `stop-badge ${msg.stopReason}`;
    sb.textContent = msg.stopReason === 'end_turn' ? '✓ Complete' : '⚠ Max tokens';
    const tb = body.querySelector('.thinking-block');
    if (tb) body.insertBefore(sb, tb);
    else body.appendChild(sb);
  }

  // ── Step 7: Update usage in header ─────────────────────────────────────
  if (msg.usage) {
    const hdr = row.querySelector('.msg-header');
    let u = hdr?.querySelector('.msg-usage');
    if (!u && hdr) { u = document.createElement('span'); u.className = 'msg-usage'; hdr.insertBefore(u, hdr.querySelector('.msg-actions')); }
    if (u) u.textContent = `${msg.usage.inputTokens||0}↑ ${msg.usage.outputTokens||0}↓`;
  }

  // ── Step 8: File list ──────────────────────────────────────────────────
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
  if (streamRegistry.has(currentConvoId)) { toast('Stop current response first','error'); return; }
  const convo = getConvo(currentConvoId);
  const msg   = convo?.messages.find(m => m.id === msgId);
  const row   = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!msg || !row) return;

  const textEl   = row.querySelector('.msg-text');
  const origHTML = textEl.innerHTML;

  const ta = document.createElement('textarea');
  ta.className = 'msg-edit-textarea'; ta.value = msg.text || '';
  setTimeout(() => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight+'px'; }, 0);
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight+'px'; };

  const saveBtn = document.createElement('button');
  saveBtn.className = 'msg-edit-save'; saveBtn.textContent = '✓ Save & Resend';
  saveBtn.onclick = () => {
    const t = ta.value.trim();
    if (!t) { toast('Cannot be empty','error'); return; }
    msg.text = t;
    invalidateMdCache(msgId);
    convo.messages.splice(convo.messages.indexOf(msg)+1);
    saveConvos(); renderMessages(convo.messages);
    runStream(currentConvoId);
  };

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'msg-edit-cancel'; cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => { textEl.innerHTML = origHTML; };

  ta.onkeydown = e => {
    if ((e.metaKey||e.ctrlKey) && e.key==='Enter') { e.preventDefault(); saveBtn.click(); }
    if (e.key==='Escape') { e.preventDefault(); cancelBtn.click(); }
  };

  const wrap2 = document.createElement('div'); wrap2.className = 'msg-edit-wrap';
  const acts  = document.createElement('div'); acts.className = 'msg-edit-actions';
  acts.appendChild(saveBtn); acts.appendChild(cancelBtn);
  wrap2.appendChild(ta); wrap2.appendChild(acts);
  textEl.innerHTML = ''; textEl.appendChild(wrap2);
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

function deleteMessagePair(userMsgId) {
  const convo = getConvo(currentConvoId);
  if (!convo || streamRegistry.has(currentConvoId)) { toast('Stop current response first','error'); return; }
  const idx = convo.messages.findIndex(m => m.id === userMsgId);
  if (idx === -1) return;
  const count = convo.messages[idx+1]?.role === 'assistant' ? 2 : 1;
  convo.messages.slice(idx, idx+count).forEach(m => invalidateMdCache(m.id));
  convo.messages.splice(idx, count);
  saveConvos(); renderMessages(convo.messages);

  if (convo.messages.length === 0) _replaceRootURL();                       // ← NEW
}


function retryMessage(aId) {
  const convo = getConvo(currentConvoId);
  if (!convo || streamRegistry.has(currentConvoId)) { toast('Stop current response first','error'); return; }
  const idx = convo.messages.findIndex(m => m.id === aId);
  if (idx === -1) return;
  convo.messages.slice(idx).forEach(m => invalidateMdCache(m.id));
  convo.messages.splice(idx);
  saveConvos();
  renderMessages(convo.messages);
  const last = convo.messages[convo.messages.length-1];
  if (!last || last.role !== 'user') { toast('Nothing to retry','error'); return; }
  runStream(currentConvoId);
}

function openImgViewer(src) {
  document.getElementById('imgModalImg').src = src;
  document.getElementById('imgModal').classList.add('open');
}
function closeImgViewer() { document.getElementById('imgModal').classList.remove('open'); }
