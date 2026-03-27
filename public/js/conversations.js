// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATIONS — CRUD + chat list rendering
// ═══════════════════════════════════════════════════════════════════════════

function getConvo(id) { return conversations.find(c => c.id === id); }
function saveConvos() { localStorage.setItem('brc_convos', JSON.stringify(conversations)); }
function saveUnread() { localStorage.setItem('brc_unread', JSON.stringify(unreadCounts)); }

function bumpConvoToTop(id) {
  const idx = conversations.findIndex(c => c.id === id);
  if (idx > 0) { const [c] = conversations.splice(idx, 1); conversations.unshift(c); saveConvos(); }
}

function newChat() {
  const id = Date.now().toString();
  conversations.unshift({ id, title: 'New Conversation', messages: [], createdAt: Date.now() });
  saveConvos();
  loadConvo(id);
}

function loadConvo(id) {
  // FIX: Save current conversation state BEFORE switching away.
  // During streaming, msg.text is updated in memory every text_delta but
  // only flushed to localStorage on a 2-second interval. Saving here
  // ensures nothing is lost when the user clicks between chats.
  saveConvos();

  currentConvoId = id;
  userScrolledUp = false;
  _setScrollBtnVisible(false);
  if (unreadCounts[id]) { delete unreadCounts[id]; saveUnread(); }
  const convo = getConvo(id);
  if (!convo) return;
  renderChatList();

  const ctx = streamRegistry.get(id);
  renderMessages(convo.messages, ctx?.assistantMsgId);

  // FIX: If this conversation has an active stream, tell the streaming UI
  // and ensure the render cycle picks up the new DOM elements.
  const isStreaming = streamRegistry.has(id);
  setStreamingUI(isStreaming);

  // If actively streaming, kick a render so the new DOM shows latest text
  if (isStreaming && ctx) {
    const aMsg = convo.messages.find(m => m.id === ctx.assistantMsgId);
    if (aMsg && aMsg.text) {
      // Force an immediate render with the latest accumulated text
      setTimeout(() => _flushRender(aMsg.id, aMsg), 50);
    }
  }

  closeSidePanel();
  scrollBottom();
}

function clearAll() {
  if (!confirm('Delete all conversations?')) return;
  streamRegistry.forEach(ctx => ctx.abortController.abort());
  streamRegistry.clear();
  conversations = []; unreadCounts = {};
  saveConvos(); saveUnread(); newChat();
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

// ─── Sidebar ──────────────────────────────────────────────────────────────
function toggleSidebar() {
  sidebarHidden = !sidebarHidden;
  localStorage.setItem('brc_sidebar_hidden', sidebarHidden);
  document.getElementById('sidebar').classList.toggle('collapsed', sidebarHidden);
}

function applySidebarState() {
  document.getElementById('sidebar').classList.toggle('collapsed', sidebarHidden);
}

// ─── Chat list render ─────────────────────────────────────────────────────
function renderChatList() {
  const el = document.getElementById('chatList');
  el.innerHTML = '';
  conversations.forEach(c => {
    const isStream = streamRegistry.has(c.id);
    const unread = unreadCounts[c.id] || 0;
    const item = document.createElement('div');
    item.className = 'chat-item' + (c.id === currentConvoId ? ' active' : '');
    item.innerHTML = `
      <div class="chat-item-dot"></div>
      <span class="chat-item-label">${esc(c.title)}</span>
      ${isStream ? '<div class="chat-item-streaming"><span></span><span></span><span></span></div>'
        : unread > 0 ? `<div class="unread-badge">${unread > 9 ? '9+' : unread}</div>` : ''}`;
    item.onclick = () => loadConvo(c.id);
    item.ondblclick = e => { e.stopPropagation(); startRename(c.id, item); };
    el.appendChild(item);
  });
}