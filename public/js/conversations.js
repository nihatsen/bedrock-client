// public/js/conversations.js — FULL REPLACEMENT
// New Chat shows blank page. Conversation created only on first message.

function isMobile() { return window.innerWidth <= 768; }
function getConvo(id) { return conversations.find(c => c.id === id); }
function saveConvos() { localStorage.setItem('brc_convos', JSON.stringify(conversations)); }
function saveUnread() { localStorage.setItem('brc_unread', JSON.stringify(unreadCounts)); }

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
    // Already on blank page — just focus input
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
