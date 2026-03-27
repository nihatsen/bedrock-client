// public/js/input.js  — FULL REPLACEMENT

// ═══════════════════════════════════════════════════════════════════════════
// INPUT — Drag/drop, paste, file upload, keyboard, resize, scroll button
// ═══════════════════════════════════════════════════════════════════════════

function initDragDrop() {
  const overlay = document.getElementById('dropOverlay');

  // CRITICAL FIX: Replace counter-based dragenter/dragleave approach with
  // a dragover heartbeat approach.
  //
  // The old approach (incrementing a counter on dragenter, decrementing on
  // dragleave) is fragile because dragleave fires for EVERY child element
  // transition, and the counter can reach 0 while the user is still dragging
  // over the window, causing the overlay to flicker or disappear prematurely.
  //
  // New approach: show the overlay as long as dragover keeps firing (which
  // the browser does every ~50ms while a drag is in progress over the window).
  // A 200ms timeout auto-hides the overlay when dragover stops (drag left
  // window or was dropped). This is 100% reliable.
  let hideOverlayTimer = null;

  const showOverlay = () => {
    overlay.classList.add('visible');
    clearTimeout(hideOverlayTimer);
    // Auto-hide if dragover stops firing (drag left window without dropping)
    hideOverlayTimer = setTimeout(() => {
      overlay.classList.remove('visible');
    }, 200);
  };

  const hideOverlayNow = () => {
    clearTimeout(hideOverlayTimer);
    overlay.classList.remove('visible');
  };

  // dragenter needed to call preventDefault so drop is allowed
  document.addEventListener('dragenter', e => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
    }
  });

  // dragover: fires continuously while drag is over the window
  document.addEventListener('dragover', e => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    showOverlay();
  });

  // dragleave: only used to immediately hide when leaving window entirely
  document.addEventListener('dragleave', e => {
    // e.relatedTarget is null when leaving the window/document itself
    if (e.relatedTarget === null) {
      hideOverlayNow();
    }
  });

  document.addEventListener('drop', async e => {
    e.preventDefault();
    hideOverlayNow();

    if (e.dataTransfer?.files?.length) {
      await uploadFiles(Array.from(e.dataTransfer.files));
      return;
    }
    // Handle dropped plain text
    const text = e.dataTransfer?.getData('text/plain');
    if (text) {
      const inp = document.getElementById('msgInput');
      inp.value += text;
      autoResize(inp);
    }
  });

  // ── Input box specific drag highlight ────────────────────────────────
  const box = document.getElementById('inputBox');
  if (box) {
    box.addEventListener('dragover', e => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        e.stopPropagation();
        box.classList.add('drag-over');
      }
    });
    box.addEventListener('dragleave', e => {
      // Only remove class if leaving the box entirely
      if (!box.contains(e.relatedTarget)) {
        box.classList.remove('drag-over');
      }
    });
    box.addEventListener('drop', async e => {
      e.preventDefault();
      e.stopPropagation();
      box.classList.remove('drag-over');
      hideOverlayNow();
      if (e.dataTransfer?.files?.length) {
        await uploadFiles(Array.from(e.dataTransfer.files));
      }
    });
  }
}

function initPaste() {
  document.addEventListener('paste', async e => {
    // Guard: some browsers pass a null or incomplete clipboardData
    if (!e.clipboardData) return;

    const items = Array.from(e.clipboardData.items || []);
    if (!items.length) return;

    // ── Images (highest priority) ──────────────────────────────────────
    const imageItems = items.filter(i => i.kind === 'file' && i.type.startsWith('image/'));
    if (imageItems.length) {
      e.preventDefault();
      const files = imageItems.map(i => i.getAsFile()).filter(Boolean);
      if (files.length) {
        await uploadFiles(files);
        toast(`✓ Pasted ${files.length} image${files.length > 1 ? 's' : ''}`, 'success');
      }
      return;
    }

    // ── Other file types (non-image) ───────────────────────────────────
    const fileItems = items.filter(i => i.kind === 'file');
    if (fileItems.length) {
      // Only intercept if there is no accompanying plain text (allow normal
      // Ctrl+V text paste to work as expected)
      const hasText = items.some(i => i.kind === 'string' && i.type === 'text/plain');
      if (!hasText) {
        e.preventDefault();
        const files = fileItems.map(i => i.getAsFile()).filter(Boolean);
        if (files.length) {
          await uploadFiles(files);
          toast(`✓ Pasted ${files.length} file${files.length > 1 ? 's' : ''}`, 'success');
        }
      }
    }
    // Plain text paste: do nothing — browser handles it natively
  });
}

async function uploadFiles(files) {
  if (!files || !files.length) return;
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const { files: processed } = await res.json();
    pendingFiles.push(...processed);
    renderFilePreview();
    toast(`✓ ${processed.length} file${processed.length > 1 ? 's' : ''} attached`, 'success');
  } catch (e) {
    console.error('[upload]', e);
    toast('Upload error: ' + e.message, 'error');
  }
}

async function handleFileSelect(event) {
  const files = Array.from(event.target.files || []);
  if (files.length) await uploadFiles(files);
  event.target.value = '';
}

function renderFilePreview() {
  const bar = document.getElementById('filePreviewBar');
  if (!bar) return;
  bar.innerHTML = '';
  pendingFiles.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-preview-chip';
    if (f.type === 'image') {
      const img = document.createElement('img');
      img.src = `data:${f.mediaType};base64,${f.data}`;
      img.className = 'fp-img';
      chip.appendChild(img);
    } else {
      const icon = document.createElement('span');
      icon.textContent = '📄';
      chip.appendChild(icon);
    }
    const name = document.createElement('span');
    name.className = 'fp-name';
    name.textContent = f.name;
    const rm = document.createElement('button');
    rm.className = 'remove-file';
    rm.textContent = '×';
    rm.onclick = () => { pendingFiles.splice(i, 1); renderFilePreview(); };
    chip.appendChild(name);
    chip.appendChild(rm);
    bar.appendChild(chip);
  });
}

function suggest(text) {
  const inp = document.getElementById('msgInput');
  inp.value = text;
  autoResize(inp);
  sendMessage();
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function scrollBottom() {
  const w = document.getElementById('messagesWrap');
  if (w) w.scrollTo({ top: w.scrollHeight, behavior: 'smooth' });
  userScrolledUp = false;
  _setScrollBtnVisible(false);
}

let _scrollBtn = null;

function _createScrollBtn() {
  document.getElementById('scrollBtnJS')?.remove();

  const btn = document.createElement('button');
  btn.id = 'scrollBtnJS';
  btn.style.cssText = `
    position:fixed!important;bottom:100px!important;left:50%!important;
    transform:translateX(-50%) translateY(20px)!important;
    width:52px!important;height:52px!important;border-radius:50%!important;
    background:#3a3a3a!important;border:2px solid #666!important;
    color:#fff!important;cursor:pointer!important;
    display:flex!important;align-items:center!important;justify-content:center!important;
    box-shadow:0 4px 20px rgba(0,0,0,0.7)!important;
    opacity:0!important;pointer-events:none!important;
    transition:opacity 0.2s,transform 0.2s,border-color 0.2s,background 0.2s!important;
    z-index:999999!important;`;
  btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2.5" style="pointer-events:none">
    <polyline points="6 9 12 15 18 9"/></svg>`;
  btn.addEventListener('mouseenter', () => {
    btn.style.background  = '#4a4a4a'; btn.style.borderColor = '#d4a574';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background  = '#3a3a3a'; btn.style.borderColor = '#666';
  });
  btn.addEventListener('click', () => scrollBottom());
  document.body.appendChild(btn);
  _scrollBtn = btn;
}

function _setScrollBtnVisible(show) {
  if (!_scrollBtn) return;
  _scrollBtn.style.opacity       = show ? '1' : '0';
  _scrollBtn.style.pointerEvents = show ? 'all' : 'none';
  _scrollBtn.style.transform     = show
    ? 'translateX(-50%) translateY(0)'
    : 'translateX(-50%) translateY(20px)';
}

function initScrollWatcher() {
  _createScrollBtn();
  const wrap = document.getElementById('messagesWrap');
  if (!wrap) return;
  wrap.addEventListener('scroll', () => {
    const dist = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight;
    userScrolledUp = dist > 80;
    _setScrollBtnVisible(userScrolledUp);
  }, { passive: true });
}

function setStreamingUI(v) {
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  if (sendBtn) sendBtn.disabled = v;
  if (stopBtn) stopBtn.classList.toggle('visible', v);
}

function stopGeneration() {
  const ctx = streamRegistry.get(currentConvoId);
  if (ctx) ctx.abortController.abort();
  streamRegistry.delete(currentConvoId);
  setStreamingUI(false);
  renderChatList();
  const convo = getConvo(currentConvoId);
  if (convo) {
    const last = convo.messages[convo.messages.length - 1];
    if (last?.role === 'assistant') {
      if (!last.text && !last.thinking) last._error = 'Generation cancelled';
      try { finalizeMsgEl(last); } catch(e) {}
      saveConvos();
    }
  }
}