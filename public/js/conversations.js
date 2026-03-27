// public/js/conversations.js — FULL REPLACEMENT

function isMobile() { return window.innerWidth <= 768; }
function getConvo(id) { return conversations.find(c => c.id === id); }
function saveConvos() { localStorage.setItem('brc_convos', JSON.stringify(conversations)); }
function saveUnread() { localStorage.setItem('brc_unread', JSON.stringify(unreadCounts)); }

function bumpConvoToTop(id) {
  const idx = conversations.findIndex(c => c.id === id);
  if (idx > 0) { const [c] = conversations.splice(idx, 1); conversations.unshift(c); saveConvos(); }
}

function newChat() {
  // Don't create duplicate empty chats — find ANY existing empty chat
  const emptyConvo = conversations.find(c => c.messages.length === 0);
  if (emptyConvo) {
    // Already have an empty chat — switch to it
    if (currentConvoId === emptyConvo.id) {
      if (isMobile() && !sidebarHidden) toggleSidebar();
      document.getElementById('msgInput')?.focus();
      return;
    }
    loadConvo(emptyConvo.id);
    return;
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

  if (isMobile() && !sidebarHidden) toggleSidebar();

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

function deleteChat(id) {
  // Can't delete a streaming chat
  if (streamRegistry.has(id)) {
    toast('Stop the current response first', 'error');
    return;
  }

  const idx = conversations.findIndex(c => c.id === id);
  if (idx === -1) return;

  conversations.splice(idx, 1);
  delete unreadCounts[id];
  saveConvos();
  saveUnread();

  // If we deleted the current chat, switch to another
  if (currentConvoId === id) {
    if (conversations.length > 0) {
      loadConvo(conversations[0].id);
    } else {
      newChat();
    }
  } else {
    renderChatList();
  }
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
    const unread = unreadCounts[c.id] || 0;
    const item = document.createElement('div');
    item.className = 'chat-item' + (c.id === currentConvoId ? ' active' : '');

    const dot = document.createElement('div');
    dot.className = 'chat-item-dot';

    const label = document.createElement('span');
    label.className = 'chat-item-label';
    label.textContent = c.title;

    item.appendChild(dot);
    item.appendChild(label);

    if (isStream) {
      const streaming = document.createElement('div');
      streaming.className = 'chat-item-streaming';
      streaming.innerHTML = '<span></span><span></span><span></span>';
      item.appendChild(streaming);
    } else if (unread > 0) {
      const badge = document.createElement('div');
      badge.className = 'unread-badge';
      badge.textContent = unread > 9 ? '9+' : unread;
      item.appendChild(badge);
    }

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'chat-item-delete';
    delBtn.innerHTML = '×';
    delBtn.title = 'Delete chat';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChat(c.id);
    });
    item.appendChild(delBtn);

    item.onclick = () => loadConvo(c.id);
    item.ondblclick = e => { e.stopPropagation(); startRename(c.id, item); };
    el.appendChild(item);
  });
}
