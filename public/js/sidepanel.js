// public/js/sidepanel.js — FULL REPLACEMENT

const _langBadgeColours = {
  js:'#f7df1e',javascript:'#f7df1e',ts:'#3178c6',typescript:'#3178c6',
  jsx:'#61dafb',tsx:'#61dafb',py:'#4ea8de',python:'#4ea8de',json:'#7ec87e',
  html:'#e44d26',css:'#7aabdf',sh:'#a78bfa',bash:'#a78bfa',shell:'#a78bfa',
  md:'#6ec6c8',markdown:'#6ec6c8',rust:'#f97316',rs:'#f97316',go:'#00acd7',
  java:'#f89820',cpp:'#6ea8d4',c:'#6ea8d4',ruby:'#e87a90',rb:'#e87a90',
  sql:'#a8d8a8',yaml:'#fbbf24',yml:'#fbbf24',xml:'#e8a87a',
};

const SP_WIDTH_KEY   = 'brc_sidepanel_width';
const SP_SCROLL_KEY  = 'brc_sidepanel_scroll'; // per-file scroll positions

let _liveSidePanelInfo = null;
let _wrapOn            = true;
let _liveUpdateTimer   = null;

// ═══════════════════════════════════════════════════════════════════════════
// WORKER — highlight + split entirely off main thread
// ═══════════════════════════════════════════════════════════════════════════

const _WORKER_SRC = `
importScripts('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js');

function splitHtmlLines(html) {
  const lines = [];
  let line = '', openTags = [], i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) { line += html[i++]; continue; }
      const tag = html.slice(i, end + 1), isClose = tag.startsWith('</');
      if (!isClose) { if (!tag.endsWith('/>')) openTags.push(tag); line += tag; }
      else { openTags.pop(); line += tag; }
      i = end + 1;
    } else if (html[i] === '\\n') {
      const cl = openTags.slice().reverse()
        .map(t => '</' + (t.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1]||'span') + '>').join('');
      lines.push(line + cl);
      line = openTags.join('');
      i++;
    } else { line += html[i++]; }
  }
  if (line) lines.push(line);
  if (lines.length && lines[lines.length-1] === '') lines.pop();
  return lines;
}

onmessage = function(e) {
  const { code, lang, reqId } = e.data;
  let html;
  try {
    html = self.hljs.highlight(code, {
      language: lang && self.hljs.getLanguage(lang) ? lang : 'plaintext',
      ignoreIllegals: true
    }).value;
  } catch(_) {
    try { html = self.hljs.highlightAuto(code).value; }
    catch(__) { html = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  }
  postMessage({ lines: splitHtmlLines(html), reqId });
};`;

let _worker      = null;
let _reqCounter  = 0;
let _latestReqId = -1;
const _pending   = new Map();

function _getWorker() {
  if (_worker) return _worker;
  const blob = new Blob([_WORKER_SRC], { type: 'text/javascript' });
  _worker = new Worker(URL.createObjectURL(blob));
  _worker.onmessage = e => {
    const { lines, reqId } = e.data;
    const p = _pending.get(reqId);
    _pending.delete(reqId);
    if (p && reqId === _latestReqId) p.resolve(lines);
    else if (p) p.reject(new Error('stale'));
  };
  _worker.onerror = () => {
    _pending.forEach(p => p.reject(new Error('worker error')));
    _pending.clear();
    _worker = null;
  };
  return _worker;
}

function _syncHighlightAndSplit(code, lang) {
  const tmp = document.createElement('code');
  tmp.className = lang ? `language-${lang}` : 'language-plaintext';
  tmp.textContent = code;
  try { hljs.highlightElement(tmp); } catch(e) {}
  const html = tmp.innerHTML;
  const lines = []; let line = '', openTags = [], i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i); if (end === -1) { line += html[i++]; continue; }
      const tag = html.slice(i, end+1), isClose = tag.startsWith('</');
      if (!isClose) { if (!tag.endsWith('/>')) openTags.push(tag); line += tag; }
      else { openTags.pop(); line += tag; }
      i = end+1;
    } else if (html[i] === '\n') {
      const cl = openTags.slice().reverse().map(t => '</' + (t.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1]||'span') + '>').join('');
      lines.push(line+cl); line = openTags.join(''); i++;
    } else { line += html[i++]; }
  }
  if (line) lines.push(line);
  if (lines.length && lines[lines.length-1]==='') lines.pop();
  return lines;
}

function _processAsync(code, lang) {
  return new Promise((resolve, reject) => {
    const reqId = ++_reqCounter;
    _latestReqId = reqId;
    _pending.forEach((p, id) => { if (id < reqId) { p.reject(new Error('stale')); _pending.delete(id); } });
    _pending.set(reqId, { resolve, reject });
    try { _getWorker().postMessage({ code, lang, reqId }); }
    catch(e) { _pending.delete(reqId); reject(e); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// VIRTUAL SCROLL
// ═══════════════════════════════════════════════════════════════════════════

const VS_ROW_H  = 21.45;
const VS_PAD    = 16;
const VS_BUFFER = 20;

let _vsLines     = [];
let _vsHash      = '';
let _vsLastFirst = -1;
let _vsLastLast  = -1;
let _vsRafId     = 0;
let _vsSuspended = false;
let _vsTotalH    = 0;

let _vsTable  = null;
let _vsTbody  = null;

function _vsEnsureTable() {
  const wrap = document.getElementById('spCodeWrap');
  if (!wrap) return false;
  if (_vsTable && wrap.contains(_vsTable)) return true;

  _vsTable = document.createElement('table');
  _vsTable.className = 'sp-code-table';
  _vsTable.style.cssText = 'position:absolute;left:0;right:0;top:0;margin:0;';

  _vsTbody = document.createElement('tbody');
  _vsTable.appendChild(_vsTbody);
  wrap.innerHTML = '';
  wrap.appendChild(_vsTable);
  return true;
}

function _fastHash(s) {
  let h = 0;
  const n = Math.min(s.length, 8000);
  for (let i = 0; i < n; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h + '_' + s.length;
}

function _vsRenderWindow() {
  if (_vsSuspended) return;
  const body = document.getElementById('sidePanelBody');
  if (!body || !_vsLines.length) return;
  if (!_vsEnsureTable()) return;

  const scrollTop = body.scrollTop;
  const clientH   = body.clientHeight;
  const total     = _vsLines.length;

  const first = Math.max(0, Math.floor((scrollTop - VS_PAD) / VS_ROW_H) - VS_BUFFER);
  const last  = Math.min(total - 1, Math.ceil((scrollTop + clientH - VS_PAD) / VS_ROW_H) + VS_BUFFER);

  if (first === _vsLastFirst && last === _vsLastLast) return;

  const prevFirst = _vsLastFirst;
  const prevLast  = _vsLastLast;
  _vsLastFirst = first;
  _vsLastLast  = last;

  const topOffset = VS_PAD + first * VS_ROW_H;
  _vsTable.style.transform = `translateY(${topOffset.toFixed(1)}px)`;

  const newCount  = last - first + 1;
  const prevCount = prevFirst === -1 ? 0 : prevLast - prevFirst + 1;
  const rows      = _vsTbody.rows;

  if (
    prevFirst === -1 ||
    first > prevLast + 1 ||
    last  < prevFirst - 1 ||
    newCount !== prevCount
  ) {
    let html = '';
    for (let i = first; i <= last; i++) {
      html += `<tr class="sp-line"><td class="sp-line-num">${i+1}</td><td class="sp-line-code">${_vsLines[i]||'\u200B'}</td></tr>`;
    }
    _vsTbody.innerHTML = html;
  } else {
    if (first < prevFirst) {
      const frag = document.createDocumentFragment();
      for (let i = first; i < prevFirst; i++) {
        const tr = document.createElement('tr');
        tr.className = 'sp-line';
        tr.innerHTML = `<td class="sp-line-num">${i+1}</td><td class="sp-line-code">${_vsLines[i]||'\u200B'}</td>`;
        frag.appendChild(tr);
      }
      _vsTbody.insertBefore(frag, rows[0]);
    }

    if (last > prevLast) {
      const frag = document.createDocumentFragment();
      for (let i = prevLast + 1; i <= last; i++) {
        const tr = document.createElement('tr');
        tr.className = 'sp-line';
        tr.innerHTML = `<td class="sp-line-num">${i+1}</td><td class="sp-line-code">${_vsLines[i]||'\u200B'}</td>`;
        frag.appendChild(tr);
      }
      _vsTbody.appendChild(frag);
    }

    const removeTop = first - prevFirst;
    if (removeTop > 0) {
      for (let i = 0; i < removeTop && rows.length > 0; i++) {
        _vsTbody.removeChild(rows[0]);
      }
    }

    const removeBottom = prevLast - last;
    if (removeBottom > 0) {
      for (let i = 0; i < removeBottom && rows.length > 0; i++) {
        _vsTbody.removeChild(rows[rows.length - 1]);
      }
    }
  }
}

function _vsScheduleRender() {
  if (_vsRafId || _vsSuspended) return;
  _vsRafId = requestAnimationFrame(() => { _vsRafId = 0; _vsRenderWindow(); });
}

function _vsCancelRender() {
  if (_vsRafId) { cancelAnimationFrame(_vsRafId); _vsRafId = 0; }
}

function _vsSuspendRendering() { _vsSuspended = true; _vsCancelRender(); }
function _vsResumeRendering() {
  _vsSuspended = false;
  _vsLastFirst = -1; _vsLastLast = -1;
  _vsScheduleRender();
}

// ─── Scroll position memory (per file by hash) ───────────────────────────
function _saveScrollPos(hash, top) {
  try {
    const map = JSON.parse(sessionStorage.getItem(SP_SCROLL_KEY) || '{}');
    map[hash] = top;
    // keep at most 50 entries
    const keys = Object.keys(map);
    if (keys.length > 50) delete map[keys[0]];
    sessionStorage.setItem(SP_SCROLL_KEY, JSON.stringify(map));
  } catch(e) {}
}

function _loadScrollPos(hash) {
  try {
    const map = JSON.parse(sessionStorage.getItem(SP_SCROLL_KEY) || '{}');
    return map[hash] != null ? map[hash] : null;
  } catch(e) { return null; }
}

// ─── Core render ─────────────────────────────────────────────────────────
// scrollBehavior: 'top' | 'bottom' | 'preserve' | 'remember'
//   top      — scroll to line 1 (new file open, not streaming)
//   bottom   — scroll to last line (streaming / live append)
//   preserve — keep current scroll position (live update tick)
//   remember — restore last saved position for this hash, or top
async function _renderSidePanelCode(code, lang, scrollBehavior = 'preserve') {
  const body = document.getElementById('sidePanelBody');
  if (!body) return;

  const hash = _fastHash(code) + (lang || '');
  const sameContent = hash === _vsHash;

  // For preserve/remember with same content, skip everything
  if (sameContent && scrollBehavior === 'preserve') return;

  _vsHash = hash;

  const savedTop    = body.scrollTop;
  const savedLeft   = body.scrollLeft;
  const atBottom    = (body.scrollHeight - body.scrollTop - body.clientHeight) < 20;

  const rawLineCount = (code.match(/\n/g) || []).length + 1;
  _vsTotalH = VS_PAD + rawLineCount * VS_ROW_H + VS_PAD;
  const wrap = document.getElementById('spCodeWrap');
  if (wrap) wrap.style.height = _vsTotalH.toFixed(1) + 'px';

  _vsLastFirst = -1; _vsLastLast = -1;

  let lines;
  try {
    lines = await _processAsync(code, lang);
  } catch(e) {
    if (e.message === 'stale') return;
    lines = _syncHighlightAndSplit(code, lang);
  }

  if (hash !== _vsHash) return; // superseded

  _vsLines = lines;
  _vsTotalH = VS_PAD + lines.length * VS_ROW_H + VS_PAD;
  if (wrap) wrap.style.height = _vsTotalH.toFixed(1) + 'px';

  if (_vsTbody) _vsTbody.innerHTML = '';
  _vsLastFirst = -1; _vsLastLast = -1;

  // Apply scroll before render so the render window is correct
  if (scrollBehavior === 'top') {
    body.scrollTop = 0;
    body.scrollLeft = 0;
  } else if (scrollBehavior === 'bottom') {
    body.scrollTop = body.scrollHeight;
  } else if (scrollBehavior === 'remember') {
    const remembered = _loadScrollPos(hash);
    body.scrollTop  = remembered != null ? remembered : 0;
    body.scrollLeft = 0;
  } else {
    // preserve
    if (atBottom) {
      body.scrollTop = body.scrollHeight;
    } else {
      body.scrollTop  = savedTop;
      body.scrollLeft = savedLeft;
    }
  }

  _vsRenderWindow();

  // After render, correct scroll (scrollHeight may have changed)
  requestAnimationFrame(() => {
    if (scrollBehavior === 'bottom') {
      body.scrollTop = body.scrollHeight;
    } else if (scrollBehavior === 'preserve' && atBottom) {
      body.scrollTop = body.scrollHeight;
    }
    _vsScheduleRender();
  });
}

function _applyWrapState() {
  const body = document.getElementById('sidePanelBody');
  const btn  = document.getElementById('spWrapBtn');
  if (!body || !btn) return;
  body.classList.toggle('wrap-on', _wrapOn);
  btn.classList.toggle('active', _wrapOn);
  btn.textContent = _wrapOn ? '↵ Wrap: on' : '↵ Wrap';
}

// ─── Scroll watcher — save position on scroll ────────────────────────────
let _scrollSaveTimer = null;
let _vsScrollBound = false;

function _initVirtualScroll() {
  if (_vsScrollBound) return;
  _vsScrollBound = true;
  const body = document.getElementById('sidePanelBody');
  if (!body) return;
  body.addEventListener('scroll', () => {
    _vsScheduleRender();
    // Debounced save of scroll position
    if (_vsHash) {
      clearTimeout(_scrollSaveTimer);
      _scrollSaveTimer = setTimeout(() => {
        _saveScrollPos(_vsHash, body.scrollTop);
      }, 300);
    }
  }, { passive: true });
}

// ─── Panel width persistence ──────────────────────────────────────────────
function _savePanelWidth(w) {
  try { localStorage.setItem(SP_WIDTH_KEY, String(w)); } catch(e) {}
}

function _loadPanelWidth() {
  try { return parseInt(localStorage.getItem(SP_WIDTH_KEY) || '0') || 0; } catch(e) { return 0; }
}

function _applyPanelWidth(panel) {
  const saved = _loadPanelWidth();
  const isMob = () => window.innerWidth <= 768;
  if (saved > 0 && !isMob()) {
    const MAX_W = Math.min(Math.floor(window.innerWidth * 0.75), window.innerWidth - 400);
    const MIN_W = 280;
    panel.style.width = Math.max(MIN_W, Math.min(MAX_W, saved)) + 'px';
  }
}

// ─── openSidePanel ────────────────────────────────────────────────────────
function openSidePanel(code, lang, filename, streamInfo) {
  _liveSidePanelInfo = streamInfo || null;
  spCode = code; spLang = lang || 'text'; spFilename = filename || langToFilename(lang);

  document.getElementById('sidePanelTitle').textContent = spFilename;
  const langEl = document.getElementById('sidePanelLang');
  langEl.textContent = spLang.toUpperCase();
  const colour = _langBadgeColours[spLang.toLowerCase()];
  if (colour) {
    langEl.style.color      = colour;
    langEl.style.background = colour + '1a';
    langEl.style.border     = '1px solid ' + colour + '48';
  } else { langEl.style.color = langEl.style.background = langEl.style.border = ''; }

  const cpBtn = document.getElementById('spCopyBtn');
  cpBtn.textContent = 'Copy'; cpBtn.classList.remove('success');

  _applyWrapState();
  _initVirtualScroll();
  _getWorker();

  // Reset virtual scroll state so table rebuilds fresh
  _vsHash = '';
  _vsTable = null; _vsTbody = null;
  _vsLastFirst = -1; _vsLastLast = -1;

  const panel = document.getElementById('sidePanel');
  const wasOpen = panel.classList.contains('open');

  // Restore saved width before making panel visible
  if (!wasOpen) {
    panel.style.width = '';
    _applyPanelWidth(panel);
  }
  panel.classList.add('open');

  // Scroll behaviour:
  //   streaming → bottom (follow live output)
  //   otherwise → restore remembered position, or top
  const scrollBehavior = streamInfo ? 'bottom' : 'remember';
  _renderSidePanelCode(code, spLang, scrollBehavior);
}

function updateLiveSidePanel(container, msgId) {
  if (!_liveSidePanelInfo || _liveSidePanelInfo.msgId !== msgId) return;
  if (!document.getElementById('sidePanel').classList.contains('open')) {
    _liveSidePanelInfo = null; return;
  }
  if (_liveUpdateTimer) return;
  _liveUpdateTimer = setTimeout(() => {
    _liveUpdateTimer = null; _doLiveUpdate(container, msgId);
  }, 500);
}

function _doLiveUpdate(container, msgId) {
  if (!_liveSidePanelInfo || _liveSidePanelInfo.msgId !== msgId) return;
  const wrap = container.querySelector(`.stream-wrap[data-blockidx="${_liveSidePanelInfo.blockIdx}"]`);
  if (!wrap) return;
  const ce = wrap.querySelector('pre code'); if (!ce) return;
  const nc = ce.textContent, nl = wrap.dataset.lang || 'text';
  if (nc !== spCode) {
    spCode = nc; spLang = nl;
    // During live streaming, follow bottom only if already near bottom
    _renderSidePanelCode(nc, nl, 'preserve');
  }
}

function clearLiveSidePanelFor(msgId) {
  if (_liveSidePanelInfo?.msgId === msgId) _liveSidePanelInfo = null;
  if (_liveUpdateTimer) { clearTimeout(_liveUpdateTimer); _liveUpdateTimer = null; }
}

function closeSidePanel() {
  const panel = document.getElementById('sidePanel');
  panel.classList.remove('open');
  // Do NOT reset panel width on close — persist it
  _liveSidePanelInfo = null;
  _vsLines = []; _vsHash = ''; _vsLastFirst = -1; _vsLastLast = -1;
  _vsSuspended = false; _vsCancelRender();
  _vsTable = null; _vsTbody = null;
  if (_liveUpdateTimer) { clearTimeout(_liveUpdateTimer); _liveUpdateTimer = null; }
}

function copySidePanel() {
  navigator.clipboard.writeText(spCode).then(() => {
    const b = document.getElementById('spCopyBtn');
    b.textContent = '✓ Copied!'; b.classList.add('success');
    setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('success'); }, 2000);
  });
}
function downloadSidePanel() { downloadCode(spCode, spLang, spFilename); }
function toggleSidePanelWrap() {
  _wrapOn = !_wrapOn; _applyWrapState();
  if (_vsTbody) _vsTbody.innerHTML = '';
  _vsLastFirst = -1; _vsLastLast = -1;
  _vsScheduleRender();
}

// ─── Resize: smooth, RAF-throttled, content stays visible ────────────────
function _initSidePanelResize() {
  const panel  = document.getElementById('sidePanel');
  const handle = document.getElementById('spResizeHandle');
  if (!handle || !panel) return;

  let startX       = 0;
  let startW       = 0;
  let dragging     = false;
  let _rafDragId   = 0;
  let _pendingX    = 0;

  const MIN_W = 280;
  const maxW  = () => Math.min(Math.floor(window.innerWidth * 0.75), window.innerWidth - 400);
  const isMob = () => window.innerWidth <= 768;

  function _startDrag(clientX) {
    startX = clientX; startW = panel.offsetWidth; dragging = true;
    handle.classList.add('dragging');
    panel.classList.add('no-transition');
    document.body.style.cursor      = 'col-resize';
    document.body.style.userSelect  = 'none';
    // Suspend virtual scroll updates during drag (keeps content visible, stops JS churn)
    _vsSuspendRendering();
    // Prevent iframe / embedded content from stealing mouse
    panel.style.pointerEvents = 'none';
  }

  function _applyDragWidth() {
    _rafDragId = 0;
    if (!dragging) return;
    const newW = Math.max(MIN_W, Math.min(maxW(), startW + (startX - _pendingX)));
    panel.style.width = newW + 'px';
  }

  function _doDrag(clientX) {
    if (!dragging) return;
    _pendingX = clientX;
    if (_rafDragId) return; // already scheduled for this frame
    _rafDragId = requestAnimationFrame(_applyDragWidth);
  }

  function _endDrag() {
    if (!dragging) return;
    dragging = false;
    if (_rafDragId) { cancelAnimationFrame(_rafDragId); _rafDragId = 0; }

    handle.classList.remove('dragging');
    panel.classList.remove('no-transition');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    panel.style.pointerEvents      = '';

    // Save the new width
    _savePanelWidth(panel.offsetWidth);

    // Resume virtual scroll with a fresh render for the new width
    if (_vsTbody) _vsTbody.innerHTML = '';
    _vsLastFirst = -1; _vsLastLast = -1;
    _vsResumeRendering();
  }

  // Mouse events
  handle.addEventListener('mousedown', e => {
    if (isMob()) return;
    e.preventDefault();
    _startDrag(e.clientX);
  });
  document.addEventListener('mousemove', e => { if (dragging) _doDrag(e.clientX); });
  document.addEventListener('mouseup',   ()  => { if (dragging) _endDrag(); });

  // Touch events
  handle.addEventListener('touchstart', e => {
    if (isMob()) return;
    _startDrag(e.touches[0].clientX);
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    _doDrag(e.touches[0].clientX);
  }, { passive: true });
  document.addEventListener('touchend', () => { if (dragging) _endDrag(); });

  _applyWrapState();
  _initVirtualScroll();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initSidePanelResize);
else _initSidePanelResize();
