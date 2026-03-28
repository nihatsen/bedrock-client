// public/js/sidepanel.js — FULL REPLACEMENT
// Fixes: line disappearance with wrap, color flash during streaming, line count enforcement

const _langBadgeColours = {
  js:'#f7df1e',javascript:'#f7df1e',ts:'#3178c6',typescript:'#3178c6',
  jsx:'#61dafb',tsx:'#61dafb',py:'#4ea8de',python:'#4ea8de',json:'#7ec87e',
  html:'#e44d26',css:'#7aabdf',sh:'#a78bfa',bash:'#a78bfa',shell:'#a78bfa',
  md:'#6ec6c8',markdown:'#6ec6c8',rust:'#f97316',rs:'#f97316',go:'#00acd7',
  java:'#f89820',cpp:'#6ea8d4',c:'#6ea8d4',ruby:'#e87a90',rb:'#e87a90',
  sql:'#a8d8a8',yaml:'#fbbf24',yml:'#fbbf24',xml:'#e8a87a',
};

const SP_WIDTH_KEY  = 'brc_sidepanel_width';
const SP_SCROLL_KEY = 'brc_sidepanel_scroll';

let _liveSidePanelInfo = null;
let _wrapOn            = true;
let _liveRafId         = 0;
let _livePendingCode   = null;
let _livePendingLang   = null;

// ─── Highlight cache — prevents color flash during streaming ──────────────
let _bgHighlightedLines = [];
let _bgHighlightedRaw   = [];

// ─── Consistent line counting ─────────────────────────────────────────────
function _rawLineCount(code) {
  if (!code) return 0;
  const parts = code.split('\n');
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKER — now receives rawLineCount and enforces it
// ═══════════════════════════════════════════════════════════════════════════
const _WORKER_SRC = `
importScripts('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js');

function splitHtmlLines(html) {
  var lines = [];
  var line = '', openTags = [], i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      var end = html.indexOf('>', i);
      if (end === -1) { line += html[i++]; continue; }
      var tag = html.slice(i, end + 1), isClose = tag.startsWith('</');
      if (!isClose) { if (!tag.endsWith('/>')) openTags.push(tag); line += tag; }
      else { if (openTags.length > 0) openTags.pop(); line += tag; }
      i = end + 1;
    } else if (html[i] === '\\n') {
      var cl = openTags.slice().reverse()
        .map(function(t) { return '</' + (t.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)||['','span'])[1] + '>'; }).join('');
      lines.push(line + cl);
      line = openTags.join('');
      i++;
    } else { line += html[i++]; }
  }
  if (line) {
    var remaining = openTags.slice().reverse()
      .map(function(t) { return '</' + (t.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)||['','span'])[1] + '>'; }).join('');
    lines.push(line + remaining);
  }
  return lines;
}

onmessage = function(e) {
  var code = e.data.code, lang = e.data.lang, reqId = e.data.reqId, rawLineCount = e.data.rawLineCount;
  var html;
  try {
    html = self.hljs.highlight(code, {
      language: lang && self.hljs.getLanguage(lang) ? lang : 'plaintext',
      ignoreIllegals: true
    }).value;
  } catch(_) {
    try { html = self.hljs.highlightAuto(code).value; }
    catch(__) { html = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  }
  var lines = splitHtmlLines(html);
  if (rawLineCount > 0) {
    while (lines.length < rawLineCount) lines.push('');
    if (lines.length > rawLineCount) lines.length = rawLineCount;
  }
  postMessage({ lines: lines, reqId: reqId });
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
  const rawCount = _rawLineCount(code);
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
      else { if (openTags.length > 0) openTags.pop(); line += tag; }
      i = end+1;
    } else if (html[i] === '\n') {
      const cl = openTags.slice().reverse().map(t => '</' + (t.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1]||'span') + '>').join('');
      lines.push(line+cl); line = openTags.join(''); i++;
    } else { line += html[i++]; }
  }
  if (line) {
    const remaining = openTags.slice().reverse().map(t => '</' + (t.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1]||'span') + '>').join('');
    lines.push(line + remaining);
  }
  // Enforce line count
  while (lines.length < rawCount) lines.push('');
  if (lines.length > rawCount) lines.length = rawCount;
  return lines;
}

function _processAsync(code, lang) {
  const rawCount = _rawLineCount(code);
  return new Promise((resolve, reject) => {
    const reqId = ++_reqCounter;
    _latestReqId = reqId;
    _pending.forEach((p, id) => { if (id < reqId) { p.reject(new Error('stale')); _pending.delete(id); } });
    _pending.set(reqId, { resolve, reject });
    try { _getWorker().postMessage({ code, lang, reqId, rawLineCount: rawCount }); }
    catch(e) { _pending.delete(reqId); reject(e); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// VIRTUAL SCROLL
// ═══════════════════════════════════════════════════════════════════════════
const VS_ROW_H  = 21.45;
const VS_PAD    = 4;
const VS_BUFFER = 20;

let _vsLines     = [];
let _vsHash      = '';
let _vsLastFirst = -1;
let _vsLastLast  = -1;
let _vsRafId     = 0;
let _vsSuspended = false;
let _vsTable     = null;
let _vsTbody     = null;

function _vsEnsureTable() {
  const wrap = document.getElementById('spCodeWrap');
  if (!wrap) return false;
  if (_vsTable && wrap.contains(_vsTable)) return true;
  _vsTable = document.createElement('table');
  _vsTable.className = 'sp-code-table';
  // Position is set dynamically by _vsRenderWindow based on wrap mode
  _vsTable.style.cssText = 'left:0;right:0;top:0;margin:0;';
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

function _vsSetHeight(lineCount) {
  const wrap = document.getElementById('spCodeWrap');
  if (!wrap) return;
  if (_wrapOn) {
    // Wrap mode: table is position:relative, its natural height drives scroll.
    // We only set minHeight so the gutter ::before stretches to at least the viewport.
    wrap.style.height    = '';
    wrap.style.minHeight = '100%';
  } else {
    // Virtual scroll mode: fixed height based on line count
    const h = VS_PAD + lineCount * VS_ROW_H + VS_PAD;
    wrap.style.height    = h.toFixed(1) + 'px';
    wrap.style.minHeight = '';
  }
}


function _vsRenderWindow() {
  if (_vsSuspended) return;
  const body = document.getElementById('sidePanelBody');
  if (!body || !_vsLines.length) return;
  if (!_vsEnsureTable()) return;

  const total = _vsLines.length;

  // ── Wrap mode: render ALL lines, relative position so height flows ─────
  if (_wrapOn) {
    _vsTable.style.position  = 'relative';
    _vsTable.style.transform = 'none';

    // Skip if already rendered this exact set
    if (_vsLastFirst === 0 && _vsLastLast === total - 1) return;
    _vsLastFirst = 0;
    _vsLastLast  = total - 1;

    let html = '';
    for (let i = 0; i < total; i++) {
      html += `<tr class="sp-line"><td class="sp-line-num">${i+1}</td><td class="sp-line-code">${_vsLines[i]||'\u200B'}</td></tr>`;
    }
    _vsTbody.innerHTML = html;
    return;
  }

  // ── Non-wrap: virtual scroll with absolute position + fixed row height ─
  _vsTable.style.position = 'absolute';

  const scrollTop = body.scrollTop;
  const clientH   = body.clientHeight;

  const first = Math.max(0, Math.floor((scrollTop - VS_PAD) / VS_ROW_H) - VS_BUFFER);
  const last  = Math.min(total - 1, Math.ceil((scrollTop + clientH - VS_PAD) / VS_ROW_H) + VS_BUFFER);

  if (first === _vsLastFirst && last === _vsLastLast) return;

  const prevFirst = _vsLastFirst;
  const prevLast  = _vsLastLast;
  _vsLastFirst = first;
  _vsLastLast  = last;

  _vsTable.style.transform = `translateY(${(VS_PAD + first * VS_ROW_H).toFixed(1)}px)`;

  const newCount  = last - first + 1;
  const prevCount = prevFirst === -1 ? 0 : prevLast - prevFirst + 1;
  const rows      = _vsTbody.rows;

  if (prevFirst === -1 || first > prevLast + 1 || last < prevFirst - 1 || newCount !== prevCount) {
    let html = '';
    for (let i = first; i <= last; i++) {
      html += `<tr class="sp-line"><td class="sp-line-num">${i+1}</td><td class="sp-line-code">${_vsLines[i]||'\u200B'}</td></tr>`;
    }
    _vsTbody.innerHTML = html;
  } else {
    if (first < prevFirst) {
      const frag = document.createDocumentFragment();
      for (let i = first; i < prevFirst; i++) {
        const tr = document.createElement('tr'); tr.className = 'sp-line';
        tr.innerHTML = `<td class="sp-line-num">${i+1}</td><td class="sp-line-code">${_vsLines[i]||'\u200B'}</td>`;
        frag.appendChild(tr);
      }
      _vsTbody.insertBefore(frag, rows[0]);
    }
    if (last > prevLast) {
      const frag = document.createDocumentFragment();
      for (let i = prevLast + 1; i <= last; i++) {
        const tr = document.createElement('tr'); tr.className = 'sp-line';
        tr.innerHTML = `<td class="sp-line-num">${i+1}</td><td class="sp-line-code">${_vsLines[i]||'\u200B'}</td>`;
        frag.appendChild(tr);
      }
      _vsTbody.appendChild(frag);
    }
    const removeTop = first - prevFirst;
    if (removeTop > 0)
      for (let i = 0; i < removeTop && rows.length > 0; i++) _vsTbody.removeChild(rows[0]);
    const removeBottom = prevLast - last;
    if (removeBottom > 0)
      for (let i = 0; i < removeBottom && rows.length > 0; i++) _vsTbody.removeChild(rows[rows.length-1]);
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

const _esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ═══════════════════════════════════════════════════════════════════════════
// STREAMING — uses cached highlights for unchanged lines to prevent flicker
// ═══════════════════════════════════════════════════════════════════════════
let _bgHighlightTimer = null;
let _bgHighlightCode  = '';
let _bgHighlightLang  = '';
let _bgHighlightHash  = '';

function _streamAppend(newCode, lang) {
  const body = document.getElementById('sidePanelBody');
  if (!body) return;

  const newHash = _fastHash(newCode) + (lang || '');
  _vsHash = newHash;

  const allRaw = newCode.split('\n');
  if (allRaw.length > 1 && allRaw[allRaw.length - 1] === '') allRaw.pop();
  const newLen = allRaw.length;

  // FIX: Reuse previously highlighted lines for unchanged text.
  // Only the last existing line (still being typed) and truly new lines
  // get plain text. This eliminates the full-white flash on every chunk.
  const newLines = [];
  for (let i = 0; i < newLen; i++) {
    if (i < _bgHighlightedRaw.length && _bgHighlightedRaw[i] === allRaw[i] && i < _bgHighlightedLines.length) {
      // Raw text unchanged since last highlight — keep colored version
      newLines.push(_bgHighlightedLines[i]);
    } else {
      // New or changed line — use plain escaped text
      newLines.push(_esc(allRaw[i]));
    }
  }
  _vsLines = newLines;

  _vsSetHeight(_vsLines.length);

  requestAnimationFrame(() => {
    if (_vsHash !== newHash) return;
    body.scrollTop = body.scrollHeight;
    _vsLastFirst = -1; _vsLastLast = -1;
    _vsRenderWindow();
  });

  _bgHighlightCode = newCode;
  _bgHighlightLang = lang;
  _bgHighlightHash = newHash;
  clearTimeout(_bgHighlightTimer);
  _bgHighlightTimer = setTimeout(_runBackgroundHighlight, 250);
}

async function _runBackgroundHighlight() {
  const code = _bgHighlightCode;
  const lang = _bgHighlightLang;
  const hash = _bgHighlightHash;
  if (!code) return;

  let lines;
  try {
    lines = await _processAsync(code, lang);
  } catch(e) {
    return;
  }

  if (hash !== _vsHash) return;

  // Save to cache so next _streamAppend can reuse colored lines
  _bgHighlightedLines = lines;
  _bgHighlightedRaw   = code.split('\n');
  if (_bgHighlightedRaw.length > 1 && _bgHighlightedRaw[_bgHighlightedRaw.length - 1] === '') {
    _bgHighlightedRaw.pop();
  }

  const body    = document.getElementById('sidePanelBody');
  const atBot   = body ? (body.scrollHeight - body.scrollTop - body.clientHeight) < 40 : false;
  const savedTop = body ? body.scrollTop : 0;

  _vsLines = lines;
  _vsSetHeight(lines.length);
  if (_vsTbody) _vsTbody.innerHTML = '';
  _vsLastFirst = -1; _vsLastLast = -1;
  _vsRenderWindow();

  if (body) {
    body.scrollTop = atBot ? body.scrollHeight : savedTop;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FULL RENDER (static / non-streaming files)
// ═══════════════════════════════════════════════════════════════════════════
async function _renderSidePanelCode(code, lang, scrollBehavior) {
  const body = document.getElementById('sidePanelBody');
  if (!body) return;

  const hash = _fastHash(code) + (lang || '');
  if (hash === _vsHash && scrollBehavior === 'preserve') return;
  _vsHash = hash;

  const savedTop  = body.scrollTop;
  const savedLeft = body.scrollLeft;
  const atBottom  = (body.scrollHeight - body.scrollTop - body.clientHeight) < 20;

  const rawCount = _rawLineCount(code);
  _vsSetHeight(rawCount);
  _vsLastFirst = -1; _vsLastLast = -1;

  let lines;
  try {
    lines = await _processAsync(code, lang);
  } catch(e) {
    if (e.message === 'stale') return;
    lines = _syncHighlightAndSplit(code, lang);
  }

  if (hash !== _vsHash) return;

  _vsLines = lines;
  _bgHighlightedLines = lines;
  _bgHighlightedRaw = code.split('\n');
  if (_bgHighlightedRaw.length > 1 && _bgHighlightedRaw[_bgHighlightedRaw.length - 1] === '') {
    _bgHighlightedRaw.pop();
  }

  _vsSetHeight(lines.length);
  if (_vsTbody) _vsTbody.innerHTML = '';
  _vsLastFirst = -1; _vsLastLast = -1;

  if (scrollBehavior === 'top') {
    body.scrollTop = 0; body.scrollLeft = 0;
  } else if (scrollBehavior === 'bottom') {
    body.scrollTop = body.scrollHeight;
  } else if (scrollBehavior === 'remember') {
    const saved = _loadScrollPos(hash);
    body.scrollTop  = saved != null ? saved : 0;
    body.scrollLeft = 0;
  } else {
    body.scrollTop  = atBottom ? body.scrollHeight : savedTop;
    body.scrollLeft = savedLeft;
  }

  _vsRenderWindow();

  requestAnimationFrame(() => {
    if (scrollBehavior === 'bottom' || (scrollBehavior === 'preserve' && atBottom)) {
      body.scrollTop = body.scrollHeight;
    }
    _vsScheduleRender();
  });
}

// ─── Scroll position memory ────────────────────────────────────────────────
function _saveScrollPos(hash, top) {
  try {
    const map = JSON.parse(sessionStorage.getItem(SP_SCROLL_KEY) || '{}');
    map[hash] = top;
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

function _savePanelWidth(w) {
  try { localStorage.setItem(SP_WIDTH_KEY, String(Math.round(w))); } catch(e) {}
}
function _loadPanelWidth() {
  try { return parseInt(localStorage.getItem(SP_WIDTH_KEY) || '0') || 0; } catch(e) { return 0; }
}
function _applyPanelWidth(panel) {
  if (window.innerWidth <= 768) return;
  const saved = _loadPanelWidth();
  if (!saved) return;
  const MAX_W = Math.min(Math.floor(window.innerWidth * 0.75), window.innerWidth - 400);
  panel.style.width = Math.max(280, Math.min(MAX_W, saved)) + 'px';
}

function _applyWrapState() {
  const body = document.getElementById('sidePanelBody');
  const btn  = document.getElementById('spWrapBtn');
  if (!body || !btn) return;
  body.classList.toggle('wrap-on', _wrapOn);
  btn.classList.toggle('active', _wrapOn);
  btn.textContent = _wrapOn ? '↵ Wrap: on' : '↵ Wrap';
}

let _scrollSaveTimer = null;
let _vsScrollBound   = false;

function _initVirtualScroll() {
  if (_vsScrollBound) return;
  _vsScrollBound = true;
  const body = document.getElementById('sidePanelBody');
  if (!body) return;
  body.addEventListener('scroll', () => {
    _vsScheduleRender();
    if (_vsHash) {
      clearTimeout(_scrollSaveTimer);
      _scrollSaveTimer = setTimeout(() => _saveScrollPos(_vsHash, body.scrollTop), 300);
    }
  }, { passive: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════
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

  if (_liveRafId) { cancelAnimationFrame(_liveRafId); _liveRafId = 0; }
  _livePendingCode = null; _livePendingLang = null;
  clearTimeout(_bgHighlightTimer); _bgHighlightTimer = null;
  _bgHighlightCode = ''; _bgHighlightLang = ''; _bgHighlightHash = '';

  // Reset highlight caches
  _bgHighlightedLines = [];
  _bgHighlightedRaw   = [];

  _vsHash = ''; _vsLines = [];
  _vsTable = null; _vsTbody = null;
  _vsLastFirst = -1; _vsLastLast = -1;

  const panel = document.getElementById('sidePanel');
  panel.style.width = '';
  _applyPanelWidth(panel);
  panel.classList.add('open');

  if (streamInfo) {
    _streamAppend(code, spLang);
  } else {
    _renderSidePanelCode(code, spLang, 'remember');
  }
}

function updateLiveSidePanel(container, msgId) {
  if (!_liveSidePanelInfo || _liveSidePanelInfo.msgId !== msgId) return;
  if (!document.getElementById('sidePanel').classList.contains('open')) {
    _liveSidePanelInfo = null; return;
  }

  const wrap = container.querySelector(`.stream-wrap[data-blockidx="${_liveSidePanelInfo.blockIdx}"]`);
  if (!wrap) return;
  const ce = wrap.querySelector('pre code'); if (!ce) return;
  const nc = ce.textContent, nl = wrap.dataset.lang || 'text';
  if (nc === spCode) return;

  _livePendingCode = nc;
  _livePendingLang = nl;

  if (_liveRafId) return;
  _liveRafId = requestAnimationFrame(() => {
    _liveRafId = 0;
    if (!_livePendingCode) return;
    const code = _livePendingCode, lang = _livePendingLang;
    _livePendingCode = null; _livePendingLang = null;
    spCode = code; spLang = lang;
    _streamAppend(code, lang);
  });
}

function clearLiveSidePanelFor(msgId) {
  if (_liveSidePanelInfo?.msgId === msgId) {
    _liveSidePanelInfo = null;
    if (spCode && document.getElementById('sidePanel').classList.contains('open')) {
      clearTimeout(_bgHighlightTimer);
      _bgHighlightCode = spCode;
      _bgHighlightLang = spLang;
      _bgHighlightHash = _vsHash;
      _runBackgroundHighlight();
    }
  }
  if (_liveRafId) { cancelAnimationFrame(_liveRafId); _liveRafId = 0; }
  _livePendingCode = null; _livePendingLang = null;
}

function closeSidePanel() {
  const panel = document.getElementById('sidePanel');
  panel.classList.remove('open');
  panel.style.width = '';

  _liveSidePanelInfo = null;
  if (_liveRafId) { cancelAnimationFrame(_liveRafId); _liveRafId = 0; }
  _livePendingCode = null; _livePendingLang = null;
  clearTimeout(_bgHighlightTimer); _bgHighlightTimer = null;
  _bgHighlightCode = ''; _bgHighlightLang = ''; _bgHighlightHash = '';

  _bgHighlightedLines = [];
  _bgHighlightedRaw   = [];

  _vsLines = []; _vsHash = '';
  _vsLastFirst = -1; _vsLastLast = -1;
  _vsSuspended = false; _vsCancelRender();
  _vsTable = null; _vsTbody = null;
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
  // Must reset everything since position mode changes between relative/absolute
  _vsSetHeight(_vsLines.length);
  if (_vsTbody) _vsTbody.innerHTML = '';
  _vsLastFirst = -1; _vsLastLast = -1;
  _vsScheduleRender();
}


// ═══════════════════════════════════════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════════════════════════════════════
function _initSidePanelResize() {
  const panel  = document.getElementById('sidePanel');
  const handle = document.getElementById('spResizeHandle');
  if (!handle || !panel) return;

  let startX   = 0, startW = 0, dragging = false;
  let _rafId   = 0, _pendingX = 0;

  const MIN_W = 280;
  const maxW  = () => Math.min(Math.floor(window.innerWidth * 0.75), window.innerWidth - 400);
  const isMob = () => window.innerWidth <= 768;

  function _startDrag(clientX) {
    startX = clientX; startW = panel.offsetWidth; dragging = true;
    handle.classList.add('dragging');
    panel.classList.add('no-transition');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
    _vsSuspendRendering();
  }

  function _commitWidth() {
    _rafId = 0;
    if (!dragging) return;
    panel.style.width = Math.max(MIN_W, Math.min(maxW(), startW + (startX - _pendingX))) + 'px';
  }

  function _doDrag(clientX) {
    if (!dragging) return;
    _pendingX = clientX;
    if (_rafId) return;
    _rafId = requestAnimationFrame(_commitWidth);
  }

  function _endDrag() {
    if (!dragging) return;
    dragging = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = 0; }
    handle.classList.remove('dragging');
    panel.classList.remove('no-transition');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    _savePanelWidth(panel.offsetWidth);
    if (_vsTbody) _vsTbody.innerHTML = '';
    _vsLastFirst = -1; _vsLastLast = -1;
    _vsResumeRendering();
  }

  handle.addEventListener('mousedown', e => {
    if (isMob()) return; e.preventDefault(); _startDrag(e.clientX);
  });
  window.addEventListener('mousemove', e => { if (dragging) _doDrag(e.clientX); });
  window.addEventListener('mouseup',   ()  => { if (dragging) _endDrag(); });

  handle.addEventListener('touchstart', e => {
    if (isMob()) return; _startDrag(e.touches[0].clientX);
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (!dragging) return; _doDrag(e.touches[0].clientX);
  }, { passive: true });
  window.addEventListener('touchend', () => { if (dragging) _endDrag(); });

  _applyWrapState();
  _initVirtualScroll();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initSidePanelResize);
else _initSidePanelResize();
