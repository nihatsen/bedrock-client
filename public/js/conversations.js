// public/js/conversations.js — FULL REPLACEMENT
// Fixes QuotaExceededError by progressively compacting file data on save failure.

function isMobile() { return window.innerWidth <= 768; }
function getConvo(id) { return conversations.find(c => c.id === id); }
function saveUnread() { localStorage.setItem('brc_unread', JSON.stringify(unreadCounts)); }

// ═══════════════════════════════════════════════════════════════════════════
// SAFE SAVE — catches QuotaExceededError and compacts before retrying
// ═══════════════════════════════════════════════════════════════════════════
function saveConvos() {
  if (_trySave()) return;

  // QuotaExceededError (or other write failure) — compact and retry
  console.warn('[storage] Save failed, compacting...');

  // Pass 1: Strip file data from all messages except last 6 in current convo
  _stripFileData(6);
  if (_trySave()) {
    console.log('[storage] Saved after stripping old file data');
    return;
  }

  // Pass 2: Strip ALL file data everywhere
  _stripFileData(0);
  if (_trySave()) {
    console.log('[storage] Saved after stripping all file data');
    toast('Storage full — file attachments removed from history to free space', 'info');
    return;
  }

  // Pass 3: Remove oldest conversations until it fits
  while (conversations.length > 1) {
    const removed = conversations.pop();
    console.warn(`[storage] Dropped oldest conversation: "${removed.title}"`);
    if (_trySave()) {
      toast('Storage full — oldest conversations removed to free space', 'info');
      renderChatList();
      return;
    }
  }

  // Pass 4: Truncate long message text in the single remaining conversation
  if (conversations.length > 0) {
    for (const msg of conversations[0].messages) {
      if (msg.text && msg.text.length > 3000) {
        msg.text = msg.text.slice(0, 3000) + '\n[…truncated to free storage…]';
      }
      if (msg.thinking && msg.thinking.length > 1000) {
        msg.thinking = msg.thinking.slice(0, 1000) + '\n[…truncated…]';
      }
    }
    if (_trySave()) {
      toast('Storage full — messages truncated to free space', 'info');
      return;
    }
  }

  // Final fallback: couldn't save at all
  console.error('[storage] Unable to save even after full compaction');
  toast('⚠ Storage full — could not save. Consider clearing old chats.', 'error');
}

function _trySave() {
  try {
    localStorage.setItem('brc_convos', JSON.stringify(conversations));
    return true;
  } catch (e) {
    if (e.name !== 'QuotaExceededError' && e.code !== 22) {
      console.error('[storage] Unexpected save error:', e);
    }
    return false;
  }
}

/**
 * Strip base64 `.data` from file attachments to free localStorage space.
 * Keeps file metadata (name, type, mediaType, size) so UI still shows cards.
 *
 * @param {number} keepRecentInCurrent - Number of recent messages in the
 *   current conversation whose file data should be preserved. Use 0 to strip all.
 */
function _stripFileData(keepRecentInCurrent) {
  for (const convo of conversations) {
    const msgs = convo.messages;
    const isCurrent = convo.id === currentConvoId;

    // Messages from index 0 to (protectFrom - 1) get their file data stripped.
    // Messages from protectFrom onward keep their data.
    const protectFrom = isCurrent
      ? Math.max(0, msgs.length - keepRecentInCurrent)
      : msgs.length; // non-current convos: strip everything

    for (let i = 0; i < protectFrom; i++) {
      const msg = msgs[i];
      if (!msg.files?.length) continue;
      for (const f of msg.files) {
        if (f.data) {
          delete f.data;
          f._stripped = true; // marker so UI can show "data unavailable"
        }
      }
    }
  }
}

// ─── URL helpers ──────────────────────────────────────────────────────────
function _chatURL(id) { return '/c/' + encodeURIComponent(id); }
function _pushChatURL(id) { history.pushState({ chatId: id }, '', _chatURL(id)); }
function _replaceChatURL(id) { history.replaceState({ chatId: id }, '', _chatURL(id)); }
function _pushRootURL() { history.pushState({ chatId: null }, '', '/'); }
function _replaceRootURL() { history.replaceState({ chatId: null }, '', '/'); }

function bumpConvoToTop(id) {
  const idx = conversations.findIndex(c => c.id === id);
  if (idx > 0) { const [c] = conversations.splice(idx, 1); conversations.unshift(c); saveConvos(); }
}

// ─── Show blank/empty state — no conversation selected ────────────────────
function showBlankState() {
  currentConvoId = null;
  userScrolledUp = false;
  _setScrollBtnVisible(false);

  const wrap = document.getElementById('messagesWrap');
  wrap.querySelectorAll('.msg-row').forEach(r => r.remove());
  document.getElementById('emptyState').style.display = '';

  setStreamingUI(false);
  renderChatList();
  closeSidePanel();
  if (typeof scheduleCostPreview === 'function') scheduleCostPreview();
}

// ─── New Chat — just show blank page, don't create conversation ───────────
function newChat(pushHistory = true) {
  if (currentConvoId === null) {
    if (isMobile() && !sidebarHidden) toggleSidebar();
    document.getElementById('msgInput')?.focus();
    return;
  }
  showBlankState();
  if (pushHistory) _pushRootURL();
  if (isMobile() && !sidebarHidden) toggleSidebar();
  document.getElementById('msgInput')?.focus();
}

function loadConvo(id, pushHistory = true) {
  saveConvos();
  currentConvoId = id;
  userScrolledUp = false;
  _setScrollBtnVisible(false);
  if (unreadCounts[id]) { delete unreadCounts[id]; saveUnread(); }

  const convo = getConvo(id);
  if (!convo) return;

  if (pushHistory) _pushChatURL(id);

  if (isMobile() && !sidebarHidden) toggleSidebar();

  renderChatList();

  const ctx = streamRegistry.get(id);
  renderMessages(convo.messages, ctx?.assistantMsgId);

  const isStreaming = streamRegistry.has(id);
  setStreamingUI(isStreaming);

  if (isStreaming && ctx) {
    const aMsg = convo.messages.find(m => m.id === ctx.assistantMsgId);
    if (aMsg) {
      requestAnimationFrame(() => {
        if (aMsg.text) _flushRender(aMsg.id, aMsg);
      });
    }
  }

  closeSidePanel();
  if (typeof scheduleCostPreview === 'function') scheduleCostPreview();
  if (typeof updateBudgetDisplay === 'function') updateBudgetDisplay();
}

function deleteChat(id) {
  if (streamRegistry.has(id)) { toast('Stop the current response first', 'error'); return; }
  if (!confirm('Delete this conversation? This cannot be undone.')) return;
  const idx = conversations.findIndex(c => c.id === id);
  if (idx === -1) return;
  conversations.splice(idx, 1);
  delete unreadCounts[id];
  saveConvos(); saveUnread();
  if (currentConvoId === id) {
    if (conversations.length > 0) {
      loadConvo(conversations[0].id, false);
      _replaceChatURL(conversations[0].id);
    } else {
      showBlankState();
      _replaceRootURL();
    }
  } else { renderChatList(); }
}

function clearAll() {
  if (!confirm('Delete all conversations? This cannot be undone.')) return;
  streamRegistry.forEach(ctx => ctx.abortController.abort());
  streamRegistry.clear();
  conversations = []; unreadCounts = {};
  saveConvos(); saveUnread();
  showBlankState();
  _replaceRootURL();
}

function startRename(id, el) {
  const convo = getConvo(id);
  const label = el.querySelector('.chat-item-label');
  const orig = label.textContent;
  label.contentEditable = true; label.focus();
  document.execCommand('selectAll');
  const finish = () => {
    label.contentEditable = false;
    const t = label.textContent.trim();
    if (t) convo.title = t; else label.textContent = orig;
    saveConvos(); renderChatList();
  };
  label.onblur = finish;
  label.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
    if (e.key === 'Escape') { label.textContent = orig; label.contentEditable = false; }
  };
}

function toggleSidebar() {
  sidebarHidden = !sidebarHidden;
  localStorage.setItem('brc_sidebar_hidden', sidebarHidden);
  document.getElementById('sidebar').classList.toggle('collapsed', sidebarHidden);
}

function applySidebarState() {
  if (isMobile() && localStorage.getItem('brc_sidebar_hidden') === null) sidebarHidden = true;
  document.getElementById('sidebar').classList.toggle('collapsed', sidebarHidden);
}

function renderChatList() {
  const el = document.getElementById('chatList');
  el.innerHTML = '';
  conversations.forEach(c => {
    const isStream = streamRegistry.has(c.id);
    const unread   = unreadCounts[c.id] || 0;
    const item     = document.createElement('div');
    item.className = 'chat-item' + (c.id === currentConvoId ? ' active' : '');

    const dot = document.createElement('div'); dot.className = 'chat-item-dot';
    const lbl = document.createElement('span'); lbl.className = 'chat-item-label'; lbl.textContent = c.title;
    item.appendChild(dot); item.appendChild(lbl);

    if (isStream) {
      const s = document.createElement('div'); s.className = 'chat-item-streaming';
      s.innerHTML = '<span></span><span></span><span></span>';
      item.appendChild(s);
    } else if (unread > 0) {
      const b = document.createElement('div'); b.className = 'unread-badge';
      b.textContent = unread > 9 ? '9+' : unread;
      item.appendChild(b);
    }

    const del = document.createElement('button');
    del.className = 'chat-item-delete'; del.innerHTML = '×'; del.title = 'Delete chat';
    del.addEventListener('click', e => { e.stopPropagation(); deleteChat(c.id); });
    item.appendChild(del);

    item.onclick = () => loadConvo(c.id);
    item.ondblclick = e => { e.stopPropagation(); startRename(c.id, item); };
    el.appendChild(item);
  });
}
