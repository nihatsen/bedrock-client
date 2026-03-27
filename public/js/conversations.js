// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATIONS — CRUD + chat list rendering
// ═══════════════════════════════════════════════════════════════════════════

function isMobile() { return window.innerWidth <= 768; }

function getConvo(id) { return conversations.find(c => c.id === id); }
function saveConvos() { localStorage.setItem('brc_convos', JSON.stringify(conversations)); }
function saveUnread() { localStorage.setItem('brc_unread', JSON.stringify(unreadCounts)); }

function bumpConvoToTop(id) {
  const idx = conversations.findIndex(c => c.id === id);
  if (idx > 0) { const [c] = conversations.splice(idx, 1); conversations.unshift(c); saveConvos(); }
}

function newChat() {
  // Don't create duplicate empty chats — reuse the current one
  if (currentConvoId) {
    const current = getConvo(currentConvoId);
    if (current && current.messages.length === 0) {
      // Already on an empty chat — just close sidebar on mobile and focus
      if (isMobile() && !sidebarHidden) toggleSidebar();
      document.getElementById('msgInput')?.focus();
      return;
    }
  }

  const id = Date.now().toString();
  conversations.unshift({ id, title: 'New Conversation', messages: [], createdAt: Date.now() });
  saveConvos();
  loadConvo(id);
}

function loadConvo(id) {
  saveConvos();

  currentConvoId = id;
  userScrolledUp = false;
  _setScrollBtnVisible(false);
  if (unreadCounts[id]) { delete unreadCounts[id]; saveUnread(); }
  const convo = getConvo(id);
  if (!convo) return;

  // Auto-close sidebar on mobile after selecting a conversation
  if (isMobile() && !sidebarHidden) {
    toggleSidebar();
  }

  renderChatList();

  const ctx = streamRegistry.get(id);
  renderMessages(convo.messages, ctx?.assistantMsgId);

  const isStreaming = streamRegistry.has(id);
  setStreamingUI(isStreaming);

  if (isStreaming && ctx) {
    const aMsg = convo.messages.find(m => m.id === ctx.assistantMsgId);
    if (aMsg && aMsg.text) {
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

  // When OPENING sidebar, close side panel if it would be too cramped
  if (!sidebarHidden) {
    const sidePanel = document.getElementById('sidePanel');
    if (sidePanel?.classList.contains('open')) {
      const avail = window.innerWidth - 260; // sidebar width
      if (avail < 700) {
        closeSidePanel();
      }
    }
  }
}

function applySidebarState() {
  if (isMobile() && localStorage.getItem('brc_sidebar_hidden') === null) {
    sidebarHidden = true;
  }
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
