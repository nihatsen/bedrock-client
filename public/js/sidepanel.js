// public/js/sidepanel.js — FULL REPLACEMENT

const _langBadgeColours = {
  js:'#f7df1e',javascript:'#f7df1e',ts:'#3178c6',typescript:'#3178c6',
  jsx:'#61dafb',tsx:'#61dafb',py:'#4ea8de',python:'#4ea8de',json:'#7ec87e',
  html:'#e44d26',css:'#7aabdf',sh:'#a78bfa',bash:'#a78bfa',shell:'#a78bfa',
  md:'#6ec6c8',markdown:'#6ec6c8',rust:'#f97316',rs:'#f97316',go:'#00acd7',
  java:'#f89820',cpp:'#6ea8d4',c:'#6ea8d4',ruby:'#e87a90',rb:'#e87a90',
  sql:'#a8d8a8',yaml:'#fbbf24',yml:'#fbbf24',xml:'#e8a87a',
};

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
// VIRTUAL SCROLL — absolute positioning, no spacer rows, table-layout:fixed
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

// Persistent table elements — reused across renders, no recreate overhead
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

// ─── Core render: repositions table + rebuilds only visible rows ───────────
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

  // Skip DOM write if range unchanged
  if (first === _vsLastFirst && last === _vsLastLast) return;

  const prevFirst = _vsLastFirst;
  const prevLast  = _vsLastLast;
  _vsLastFirst = first;
  _vsLastLast  = last;

  // Reposition table using transform (no layout, GPU only)
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
    // Full rebuild — range changed completely or size changed
    // Build as HTML string (fastest for initial fill)
    let html = '';
    for (let i = first; i <= last; i++) {
      html += `<tr class="sp-line"><td class="sp-line-num">${i+1}</td><td class="sp-line-code">${_vsLines[i]||'\u200B'}</td></tr>`;
    }
    _vsTbody.innerHTML = html;
  } else {
    // Incremental update — reuse existing rows, only touch edges

    // Rows scrolled in from top
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

    // Rows scrolled in from bottom
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

    // Remove rows that scrolled out from top
    const removeTop = first - prevFirst;
    if (removeTop > 0) {
      for (let i = 0; i < removeTop && rows.length > 0; i++) {
        _vsTbody.removeChild(rows[0]);
      }
    }

    // Remove rows that scrolled out from bottom
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

async function _renderSidePanelCode(code, lang) {
  const body = document.getElementById('sidePanelBody');
  if (!body) return;

  const hash = _fastHash(code) + (lang || '');
  if (hash === _vsHash) return;
  _vsHash = hash;

  const savedTop    = body.scrollTop;
  const savedLeft   = body.scrollLeft;
  const wasAtBottom = (body.scrollHeight - body.scrollTop - body.clientHeight) < 20;

  // Set container height immediately for correct scrollbar
  const rawLineCount = (code.match(/\n/g) || []).length + 1;
  _vsTotalH = VS_PAD + rawLineCount * VS_ROW_H + VS_PAD;
  const wrap = document.getElementById('spCodeWrap');
  if (wrap) wrap.style.height = _vsTotalH.toFixed(1) + 'px';

  // Reset render state so table rebuilds from scratch
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

  // Reset table
  if (_vsTbody) _vsTbody.innerHTML = '';
  _vsLastFirst = -1; _vsLastLast = -1;

  _vsRenderWindow();

  if (wasAtBottom) {
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; _vsScheduleRender(); });
  } else {
    body.scrollTop  = savedTop;
    body.scrollLeft = savedLeft;
  }
}

function _applyWrapState() {
  const body = document.getElementById('sidePanelBody');
  const btn  = document.getElementById('spWrapBtn');
  if (!body || !btn) return;
  body.classList.toggle('wrap-on', _wrapOn);
  btn.classList.toggle('active', _wrapOn);
  btn.textContent = _wrapOn ? '↵ Wrap: on' : '↵ Wrap';
}

let _vsScrollBound = false;
function _initVirtualScroll() {
  if (_vsScrollBound) return;
  _vsScrollBound = true;
  const body = document.getElementById('sidePanelBody');
  if (body) body.addEventListener('scroll', _vsScheduleRender, { passive: true });
}

function openSidePanel(code, lang, filename, streamInfo) {
  _liveSidePanelInfo = streamInfo || null;
  spCode = code; spLang = lang || 'text'; spFilename = filename || langToFilename(lang);

  document.getElementById('sidePanelTitle').textContent = spFilename;
  const langEl = document.getElementById('sidePanelLang');
  langEl.textContent = spLang.toUpperCase();
  const colour = _langBadgeColours[spLang.toLowerCase()];
  if (colour) {
    langEl.style.color = colour; langEl.style.background = colour+'1a';
    langEl.style.border = '1px solid '+colour+'48';
  } else { langEl.style.color = langEl.style.background = langEl.style.border = ''; }

  const cpBtn = document.getElementById('spCopyBtn');
  cpBtn.textContent = 'Copy'; cpBtn.classList.remove('success');

  _applyWrapState();
  _initVirtualScroll();
  _getWorker();

  _vsHash = '';
  _vsTable = null; _vsTbody = null; // force fresh table on open
  _renderSidePanelCode(code, spLang);

  const panel = document.getElementById('sidePanel');
  panel.style.width = '';
  panel.classList.add('open');

  requestAnimationFrame(() => {
    const body = document.getElementById('sidePanelBody');
    if (body) { body.scrollTop = body.scrollHeight; _vsScheduleRender(); }
  });
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
  if (nc !== spCode) { spCode = nc; spLang = nl; _renderSidePanelCode(nc, nl); }
}

function clearLiveSidePanelFor(msgId) {
  if (_liveSidePanelInfo?.msgId === msgId) _liveSidePanelInfo = null;
  if (_liveUpdateTimer) { clearTimeout(_liveUpdateTimer); _liveUpdateTimer = null; }
}

function closeSidePanel() {
  const panel = document.getElementById('sidePanel');
  panel.classList.remove('open'); panel.style.width = '';
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

// ─── Resize: hide content during drag ─────────────────────────────────────
function _initSidePanelResize() {
  const panel  = document.getElementById('sidePanel');
  const handle = document.getElementById('spResizeHandle');
  if (!handle || !panel) return;

  let startX = 0, startW = 0, dragging = false;
  const MIN_W = 280;
  const maxW  = () => Math.min(Math.floor(window.innerWidth * 0.75), window.innerWidth - 400);
  const isMob = () => window.innerWidth <= 768;
  let _overlay = null;

  function _startDrag(clientX) {
    startX = clientX; startW = panel.offsetWidth; dragging = true;
    panel.classList.add('no-transition');
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    _vsSuspendRendering();

    // Transparent overlay prevents mouse events reaching content
    if (!_overlay) {
      _overlay = document.createElement('div');
      _overlay.style.cssText = 'position:absolute;inset:0;z-index:9999;cursor:col-resize;';
    }
    const body = document.getElementById('sidePanelBody');
    if (body) body.appendChild(_overlay);

    // Hide code content — browser skips text rendering
    const wrap = document.getElementById('spCodeWrap');
    if (wrap) wrap.style.visibility = 'hidden';
  }

  function _doDrag(clientX) {
    if (!dragging) return;
    panel.style.width = Math.max(MIN_W, Math.min(maxW(), startW + (startX - clientX))) + 'px';
  }

  function _endDrag() {
    if (!dragging) return; dragging = false;
    panel.classList.remove('no-transition');
    document.body.style.cursor = ''; document.body.style.userSelect = '';
    if (_overlay?.parentNode) _overlay.parentNode.removeChild(_overlay);
    const wrap = document.getElementById('spCodeWrap');
    if (wrap) wrap.style.visibility = '';
    // Force fresh render for new width
    if (_vsTbody) _vsTbody.innerHTML = '';
    _vsLastFirst = -1; _vsLastLast = -1;
    _vsResumeRendering();
  }

  handle.addEventListener('mousedown', e => {
    if (isMob()) return; e.preventDefault();
    handle.classList.add('dragging'); _startDrag(e.clientX);
  });
  document.addEventListener('mousemove', e => _doDrag(e.clientX));
  document.addEventListener('mouseup', () => { if (!dragging) return; handle.classList.remove('dragging'); _endDrag(); });
  handle.addEventListener('touchstart', e => { if (isMob()) return; _startDrag(e.touches[0].clientX); }, { passive:true });
  document.addEventListener('touchmove', e => { if (!dragging) return; _doDrag(e.touches[0].clientX); }, { passive:true });
  document.addEventListener('touchend', () => { if (!dragging) return; _endDrag(); });

  _applyWrapState(); _initVirtualScroll();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initSidePanelResize);
else _initSidePanelResize();
