// public/js/sidepanel.js — FULL REPLACEMENT
// highlight.js runs in a Web Worker — zero main-thread blocking

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
// WEB WORKER — hljs runs off the main thread
// ═══════════════════════════════════════════════════════════════════════════

let _worker       = null;
let _workerReady  = false;
let _workerQueue  = [];   // { code, lang, hash, resolve }
let _workerBusy   = false;

function _getWorker() {
  if (_worker) return _worker;

  const src = `
importScripts('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js');

onmessage = function(e) {
  const { code, lang, hash } = e.data;
  let html;
  try {
    html = self.hljs.highlight(code, {
      language: lang && self.hljs.getLanguage(lang) ? lang : 'plaintext',
      ignoreIllegals: true
    }).value;
  } catch(_) {
    try { html = self.hljs.highlightAuto(code).value; }
    catch(__) {
      html = code
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;');
    }
  }
  postMessage({ html, hash });
};`;

  const blob = new Blob([src], { type: 'text/javascript' });
  _worker = new Worker(URL.createObjectURL(blob));

  _worker.onmessage = function(e) {
    _workerBusy = false;
    const { html, hash } = e.data;

    // Find the pending request for this hash
    const idx = _workerQueue.findIndex(q => q.hash === hash);
    if (idx !== -1) {
      const req = _workerQueue.splice(idx, 1)[0];
      req.resolve(html);
    }

    // Process next in queue
    _workerFlush();
  };

  _worker.onerror = function() {
    _workerBusy = false;
    _workerReady = false;
    _workerFlush();
  };

  _workerReady = true;
  return _worker;
}

function _workerFlush() {
  if (_workerBusy || !_workerQueue.length) return;
  // Send only the latest request (skip stale ones)
  const req = _workerQueue[_workerQueue.length - 1];
  _workerQueue = [req]; // discard all but latest
  _workerBusy = true;
  _getWorker().postMessage({ code: req.code, lang: req.lang, hash: req.hash });
}

function _highlightAsync(code, lang) {
  return new Promise(resolve => {
    const hash = _fastHash(code) + '_' + (lang || '');
    _workerQueue.push({ code, lang, hash, resolve });
    _workerFlush();
  });
}

// Fallback synchronous highlight (used if worker fails)
function _highlightSync(code, lang) {
  const tmp = document.createElement('code');
  tmp.className = lang ? `language-${lang}` : 'language-plaintext';
  tmp.textContent = code;
  try { hljs.highlightElement(tmp); } catch(e) {}
  return tmp.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════════
// VIRTUAL SCROLL
// ═══════════════════════════════════════════════════════════════════════════

const VS_ROW_H  = 21.45;
const VS_PAD    = 16;
const VS_BUFFER = 25;

let _vsLines      = [];
let _vsCodeHash   = '';
let _vsLastFirst  = -1;
let _vsLastLast   = -1;
let _vsRafId      = 0;
let _vsSuspended  = false;
let _vsPendingCode = null; // code waiting for worker result

function _fastHash(str) {
  let h = 0;
  const n = Math.min(str.length, 8000);
  for (let i = 0; i < n; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h + '_' + str.length;
}

function _splitHtmlLines(html) {
  const lines = []; let line = '', openTags = [], i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) { line += html[i++]; continue; }
      const tag = html.slice(i, end + 1), isClose = tag.startsWith('</');
      if (!isClose) { if (!tag.endsWith('/>')) openTags.push(tag); line += tag; }
      else { openTags.pop(); line += tag; }
      i = end + 1;
    } else if (html[i] === '\n') {
      const cl = openTags.slice().reverse()
        .map(t => '</' + (t.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1] || 'span') + '>')
        .join('');
      lines.push(line + cl); line = openTags.join(''); i++;
    } else { line += html[i++]; }
  }
  if (line) lines.push(line);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function _vsRenderWindow() {
  if (_vsSuspended) return;

  const body      = document.getElementById('sidePanelBody');
  const container = document.getElementById('spCodeWrap');
  if (!body || !container || !_vsLines.length) return;

  const scrollTop    = body.scrollTop;
  const clientHeight = body.clientHeight;
  const total        = _vsLines.length;

  const first = Math.max(0, Math.floor((scrollTop - VS_PAD) / VS_ROW_H) - VS_BUFFER);
  const last  = Math.min(total - 1, Math.ceil((scrollTop + clientHeight - VS_PAD) / VS_ROW_H) + VS_BUFFER);

  if (first === _vsLastFirst && last === _vsLastLast) return; // no change
  _vsLastFirst = first;
  _vsLastLast  = last;

  const topH    = VS_PAD + first * VS_ROW_H;
  const bottomH = Math.max(0, (total - 1 - last) * VS_ROW_H + VS_PAD);

  const parts = ['<table class="sp-code-table"><tbody>'];
  if (topH > 0) parts.push(`<tr class="sp-spacer"><td colspan="2" style="height:${topH.toFixed(1)}px"></td></tr>`);
  for (let i = first; i <= last; i++) {
    parts.push(`<tr class="sp-line"><td class="sp-line-num">${i + 1}</td><td class="sp-line-code">${_vsLines[i] || '\u200B'}</td></tr>`);
  }
  if (bottomH > 0) parts.push(`<tr class="sp-spacer"><td colspan="2" style="height:${bottomH.toFixed(1)}px"></td></tr>`);
  parts.push('</tbody></table>');

  container.innerHTML = parts.join('');
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

function _vsSetLines(htmlLines) {
  _vsLines     = htmlLines;
  _vsLastFirst = -1;
  _vsLastLast  = -1;

  const container = document.getElementById('spCodeWrap');
  if (container) {
    container.style.height = (VS_PAD + _vsLines.length * VS_ROW_H + VS_PAD).toFixed(1) + 'px';
  }
}

// ─── Main render entry — async (worker) with sync fallback ────────────────
async function _renderSidePanelCode(code, lang) {
  const body = document.getElementById('sidePanelBody');
  if (!body) return;

  const hash = _fastHash(code) + '_' + (lang || '');
  if (hash === _vsCodeHash) return; // same content, skip entirely
  _vsCodeHash = hash;

  const savedTop    = body.scrollTop;
  const savedLeft   = body.scrollLeft;
  const wasAtBottom = (body.scrollHeight - body.scrollTop - body.clientHeight) < 20;

  // Show line count immediately while async highlight runs
  const lineCount = code.split('\n').length;
  const container = document.getElementById('spCodeWrap');
  if (container) {
    container.style.height = (VS_PAD + lineCount * VS_ROW_H + VS_PAD).toFixed(1) + 'px';
  }

  let highlighted;
  try {
    highlighted = await _highlightAsync(code, lang);
  } catch (e) {
    highlighted = _highlightSync(code, lang);
  }

  // If code changed while we were waiting, discard this result
  if (hash !== _vsCodeHash) return;

  _vsSetLines(_splitHtmlLines(highlighted));
  _vsRenderWindow();

  if (wasAtBottom) {
    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
      _vsScheduleRender();
    });
  } else {
    body.scrollTop  = savedTop;
    body.scrollLeft = savedLeft;
  }
}

// ─── Wrap state ────────────────────────────────────────────────────────────
function _applyWrapState() {
  const body = document.getElementById('sidePanelBody');
  const btn  = document.getElementById('spWrapBtn');
  if (!body || !btn) return;
  body.classList.toggle('wrap-on', _wrapOn);
  btn.classList.toggle('active', _wrapOn);
  btn.textContent = _wrapOn ? '↵ Wrap: on' : '↵ Wrap';
}

// ─── Init scroll listener (once) ──────────────────────────────────────────
let _vsScrollBound = false;
function _initVirtualScroll() {
  if (_vsScrollBound) return;
  _vsScrollBound = true;
  const body = document.getElementById('sidePanelBody');
  if (body) body.addEventListener('scroll', _vsScheduleRender, { passive: true });
}

// ─── Open ──────────────────────────────────────────────────────────────────
function openSidePanel(code, lang, filename, streamInfo) {
  _liveSidePanelInfo = streamInfo || null;
  spCode = code; spLang = lang || 'text'; spFilename = filename || langToFilename(lang);

  document.getElementById('sidePanelTitle').textContent = spFilename;
  const langEl = document.getElementById('sidePanelLang');
  langEl.textContent = spLang.toUpperCase();
  const colour = _langBadgeColours[spLang.toLowerCase()];
  if (colour) {
    langEl.style.color = colour;
    langEl.style.background = colour + '1a';
    langEl.style.border = '1px solid ' + colour + '48';
  } else { langEl.style.color = langEl.style.background = langEl.style.border = ''; }

  document.getElementById('spCopyBtn').textContent = 'Copy';
  document.getElementById('spCopyBtn').classList.remove('success');

  _applyWrapState();
  _initVirtualScroll();
  _getWorker(); // warm up worker early

  _vsCodeHash = ''; // force fresh highlight
  _renderSidePanelCode(code, spLang);

  const panel = document.getElementById('sidePanel');
  panel.style.width = '';
  panel.classList.add('open');

  requestAnimationFrame(() => {
    const body = document.getElementById('sidePanelBody');
    if (body) { body.scrollTop = body.scrollHeight; _vsScheduleRender(); }
  });
}

// ─── Live update (throttled) ───────────────────────────────────────────────
function updateLiveSidePanel(container, msgId) {
  if (!_liveSidePanelInfo || _liveSidePanelInfo.msgId !== msgId) return;
  if (!document.getElementById('sidePanel').classList.contains('open')) {
    _liveSidePanelInfo = null; return;
  }
  if (_liveUpdateTimer) return;
  _liveUpdateTimer = setTimeout(() => {
    _liveUpdateTimer = null;
    _doLiveUpdate(container, msgId);
  }, 500);
}

function _doLiveUpdate(container, msgId) {
  if (!_liveSidePanelInfo || _liveSidePanelInfo.msgId !== msgId) return;
  const wrap = container.querySelector(`.stream-wrap[data-blockidx="${_liveSidePanelInfo.blockIdx}"]`);
  if (!wrap) return;
  const codeEl = wrap.querySelector('pre code'); if (!codeEl) return;
  const newCode = codeEl.textContent, newLang = wrap.dataset.lang || 'text';
  if (newCode !== spCode) { spCode = newCode; spLang = newLang; _renderSidePanelCode(newCode, newLang); }
}

function clearLiveSidePanelFor(msgId) {
  if (_liveSidePanelInfo?.msgId === msgId) _liveSidePanelInfo = null;
  if (_liveUpdateTimer) { clearTimeout(_liveUpdateTimer); _liveUpdateTimer = null; }
}

// ─── Close ─────────────────────────────────────────────────────────────────
function closeSidePanel() {
  const panel = document.getElementById('sidePanel');
  panel.classList.remove('open'); panel.style.width = '';
  _liveSidePanelInfo = null;
  _vsLines = []; _vsCodeHash = ''; _vsLastFirst = -1; _vsLastLast = -1;
  _vsSuspended = false; _vsCancelRender();
  if (_liveUpdateTimer) { clearTimeout(_liveUpdateTimer); _liveUpdateTimer = null; }
}

function copySidePanel() {
  navigator.clipboard.writeText(spCode).then(() => {
    const btn = document.getElementById('spCopyBtn');
    btn.textContent = '✓ Copied!'; btn.classList.add('success');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('success'); }, 2000);
  });
}
function downloadSidePanel() { downloadCode(spCode, spLang, spFilename); }
function toggleSidePanelWrap() {
  _wrapOn = !_wrapOn; _applyWrapState();
  _vsLastFirst = -1; _vsLastLast = -1; _vsScheduleRender();
}

// ─── Resize handle ─────────────────────────────────────────────────────────
function _initSidePanelResize() {
  const panel  = document.getElementById('sidePanel');
  const handle = document.getElementById('spResizeHandle');
  if (!handle || !panel) return;

  let startX = 0, startW = 0, dragging = false;
  const MIN_W = 280;
  const getMaxW = () => Math.min(Math.floor(window.innerWidth * 0.75), window.innerWidth - 400);
  const isMobileView = () => window.innerWidth <= 768;

  handle.addEventListener('mousedown', e => {
    if (isMobileView()) return; e.preventDefault();
    dragging = true; startX = e.clientX; startW = panel.offsetWidth;
    handle.classList.add('dragging'); panel.classList.add('no-transition');
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    _vsSuspendRendering();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    panel.style.width = Math.max(MIN_W, Math.min(getMaxW(), startW + (startX - e.clientX))) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return; dragging = false;
    handle.classList.remove('dragging'); panel.classList.remove('no-transition');
    document.body.style.cursor = ''; document.body.style.userSelect = '';
    _vsResumeRendering();
  });

  handle.addEventListener('touchstart', e => {
    if (isMobileView()) return;
    dragging = true; startX = e.touches[0].clientX; startW = panel.offsetWidth;
    panel.classList.add('no-transition'); _vsSuspendRendering();
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    panel.style.width = Math.max(MIN_W, Math.min(getMaxW(), startW + (startX - e.touches[0].clientX))) + 'px';
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!dragging) return; dragging = false;
    panel.classList.remove('no-transition'); _vsResumeRendering();
  });

  _applyWrapState(); _initVirtualScroll();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initSidePanelResize);
else _initSidePanelResize();
