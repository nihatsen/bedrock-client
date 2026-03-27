// public/js/sidepanel.js — FULL REPLACEMENT
// Worker does highlight + line-split. Main thread only does virtual DOM writes.

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
// WORKER — highlight + split lines entirely off main thread
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
      lines.push(line + cl); line = openTags.join(''); i++;
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
  const lines = splitHtmlLines(html);
  postMessage({ lines, reqId });
};`;

let _worker      = null;
let _workerReady = false;
let _reqCounter  = 0;
const _pending   = new Map(); // reqId → { resolve, reject }
let _latestReqId = -1;        // only apply result from latest request

function _getWorker() {
  if (_worker) return _worker;
  const blob = new Blob([_WORKER_SRC], { type: 'text/javascript' });
  _worker = new Worker(URL.createObjectURL(blob));
  _worker.onmessage = e => {
    const { lines, reqId } = e.data;
    const p = _pending.get(reqId);
    _pending.delete(reqId);
    // Only resolve if this is the latest request (discard stale)
    if (p && reqId === _latestReqId) p.resolve(lines);
    else if (p) p.reject(new Error('stale'));
  };
  _worker.onerror = () => {
    _pending.forEach(p => p.reject(new Error('worker error')));
    _pending.clear();
    _worker = null; _workerReady = false;
  };
  _workerReady = true;
  return _worker;
}

// Fallback sync split+highlight
function _syncHighlightAndSplit(code, lang) {
  const tmp = document.createElement('code');
  tmp.className = lang ? `language-${lang}` : 'language-plaintext';
  tmp.textContent = code;
  try { hljs.highlightElement(tmp); } catch(e) {}
  const html = tmp.innerHTML;

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
        .map(t => '</' + (t.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1]||'span') + '>').join('');
      lines.push(line + cl); line = openTags.join(''); i++;
    } else { line += html[i++]; }
  }
  if (line) lines.push(line);
  if (lines.length && lines[lines.length-1] === '') lines.pop();
  return lines;
}

function _processAsync(code, lang) {
  return new Promise((resolve, reject) => {
    const reqId = ++_reqCounter;
    _latestReqId = reqId;
    // Cancel all older pending requests (they're stale)
    _pending.forEach((p, id) => { if (id < reqId) { p.reject(new Error('stale')); _pending.delete(id); } });
    _pending.set(reqId, { resolve, reject });
    try {
      _getWorker().postMessage({ code, lang, reqId });
    } catch(e) {
      _pending.delete(reqId);
      reject(e);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// VIRTUAL SCROLL
// ═══════════════════════════════════════════════════════════════════════════

const VS_ROW_H  = 21.45;
const VS_PAD    = 16;
const VS_BUFFER = 25;

let _vsLines     = [];
let _vsHash      = '';
let _vsLastFirst = -1;
let _vsLastLast  = -1;
let _vsRafId     = 0;
let _vsSuspended = false;

function _fastHash(s) {
  let h = 0;
  const n = Math.min(s.length, 8000);
  for (let i = 0; i < n; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h + '_' + s.length;
}

// Only write to DOM when visible range actually changes
function _vsRenderWindow() {
  if (_vsSuspended) return;
  const body = document.getElementById('sidePanelBody');
  const wrap = document.getElementById('spCodeWrap');
  if (!body || !wrap || !_vsLines.length) return;

  const scrollTop = body.scrollTop;
  const clientH   = body.clientHeight;
  const total     = _vsLines.length;

  const first = Math.max(0, Math.floor((scrollTop - VS_PAD) / VS_ROW_H) - VS_BUFFER);
  const last  = Math.min(total - 1, Math.ceil((scrollTop + clientH - VS_PAD) / VS_ROW_H) + VS_BUFFER);

  if (first === _vsLastFirst && last === _vsLastLast) return;
  _vsLastFirst = first;
  _vsLastLast  = last;

  const topH    = (VS_PAD + first * VS_ROW_H).toFixed(1);
  const bottomH = Math.max(0, (total - 1 - last) * VS_ROW_H + VS_PAD).toFixed(1);

  // Build HTML with pre-allocated array
  const count  = last - first + 1;
  const parts  = new Array(count + 4);
  let   pi     = 0;

  parts[pi++] = '<table class="sp-code-table"><tbody>';
  if (+topH > 0) parts[pi++] = `<tr class="sp-spacer"><td colspan="2" style="height:${topH}px"></td></tr>`;

  for (let i = first; i <= last; i++) {
    parts[pi++] = `<tr class="sp-line"><td class="sp-line-num">${i + 1}</td><td class="sp-line-code">${_vsLines[i] || '\u200B'}</td></tr>`;
  }

  if (+bottomH > 0) parts[pi++] = `<tr class="sp-spacer"><td colspan="2" style="height:${bottomH}px"></td></tr>`;
  parts[pi++] = '</tbody></table>';

  wrap.innerHTML = parts.slice(0, pi).join('');
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

// ─── Render entry: async worker path with sync fallback ────────────────────
async function _renderSidePanelCode(code, lang) {
  const body = document.getElementById('sidePanelBody');
  if (!body) return;

  const hash = _fastHash(code) + (lang || '');
  if (hash === _vsHash) return;
  _vsHash = hash;

  const savedTop    = body.scrollTop;
  const savedLeft   = body.scrollLeft;
  const wasAtBottom = (body.scrollHeight - body.scrollTop - body.clientHeight) < 20;

  // Set container height immediately (gives correct scrollbar before highlight)
  const rawLineCount = code.split('\n').length;
  const wrap = document.getElementById('spCodeWrap');
  if (wrap) wrap.style.height = (VS_PAD + rawLineCount * VS_ROW_H + VS_PAD).toFixed(1) + 'px';

  let lines;
  try {
    lines = await _processAsync(code, lang);
  } catch (e) {
    if (e.message === 'stale') return; // newer request in flight
    lines = _syncHighlightAndSplit(code, lang);
  }

  // Another request may have started while we awaited — check hash
  if (hash !== _vsHash) return;

  _vsLines     = lines;
  _vsLastFirst = -1;
  _vsLastLast  = -1;

  if (wrap) wrap.style.height = (VS_PAD + lines.length * VS_ROW_H + VS_PAD).toFixed(1) + 'px';

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
    langEl.style.color      = colour;
    langEl.style.background = colour + '1a';
    langEl.style.border     = '1px solid ' + colour + '48';
  } else { langEl.style.color = langEl.style.background = langEl.style.border = ''; }

  const cpBtn = document.getElementById('spCopyBtn');
  cpBtn.textContent = 'Copy'; cpBtn.classList.remove('success');

  _applyWrapState();
  _initVirtualScroll();
  _getWorker(); // warm up

  _vsHash = ''; // force fresh render
  _renderSidePanelCode(code, spLang);

  const panel = document.getElementById('sidePanel');
  panel.style.width = '';
  panel.classList.add('open');

  requestAnimationFrame(() => {
    const body = document.getElementById('sidePanelBody');
    if (body) { body.scrollTop = body.scrollHeight; _vsScheduleRender(); }
  });
}

// ─── Live update ───────────────────────────────────────────────────────────
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

// ─── Close ─────────────────────────────────────────────────────────────────
function closeSidePanel() {
  const panel = document.getElementById('sidePanel');
  panel.classList.remove('open'); panel.style.width = '';
  _liveSidePanelInfo = null;
  _vsLines = []; _vsHash = ''; _vsLastFirst = -1; _vsLastLast = -1;
  _vsSuspended = false; _vsCancelRender();
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
  _vsLastFirst = -1; _vsLastLast = -1; _vsScheduleRender();
}

// ─── Resize ────────────────────────────────────────────────────────────────
function _initSidePanelResize() {
  const panel  = document.getElementById('sidePanel');
  const handle = document.getElementById('spResizeHandle');
  if (!handle || !panel) return;

  let startX = 0, startW = 0, dragging = false;
  const MIN_W = 280;
  const maxW  = () => Math.min(Math.floor(window.innerWidth * 0.75), window.innerWidth - 400);
  const isMob = () => window.innerWidth <= 768;

  handle.addEventListener('mousedown', e => {
    if (isMob()) return; e.preventDefault();
    dragging = true; startX = e.clientX; startW = panel.offsetWidth;
    handle.classList.add('dragging'); panel.classList.add('no-transition');
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    _vsSuspendRendering();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    panel.style.width = Math.max(MIN_W, Math.min(maxW(), startW + (startX - e.clientX))) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return; dragging = false;
    handle.classList.remove('dragging'); panel.classList.remove('no-transition');
    document.body.style.cursor = ''; document.body.style.userSelect = '';
    _vsResumeRendering();
  });
  handle.addEventListener('touchstart', e => {
    if (isMob()) return;
    dragging = true; startX = e.touches[0].clientX; startW = panel.offsetWidth;
    panel.classList.add('no-transition'); _vsSuspendRendering();
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    panel.style.width = Math.max(MIN_W, Math.min(maxW(), startW + (startX - e.touches[0].clientX))) + 'px';
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!dragging) return; dragging = false;
    panel.classList.remove('no-transition'); _vsResumeRendering();
  });

  _applyWrapState(); _initVirtualScroll();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initSidePanelResize);
else _initSidePanelResize();
