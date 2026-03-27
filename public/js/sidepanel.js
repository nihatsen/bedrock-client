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

// ─── Virtual scroll state ──────────────────────────────────────────────────
const VS_ROW_H  = 21.45;  // 13px * 1.65 line-height
const VS_PAD    = 16;
const VS_BUFFER = 30;

let _vsLines     = [];
let _vsCodeHash  = '';
let _vsLastFirst = -1;
let _vsLastLast  = -1;
let _vsRafId     = 0;
let _vsSuspended = false;  // true while resize is dragging

// ─── Fast hash ────────────────────────────────────────────────────────────
function _fastHash(str) {
  let h = 0;
  const len = Math.min(str.length, 4000); // sample first 4k chars for speed
  for (let i = 0; i < len; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h + '_' + str.length;
}

// ─── Split highlighted HTML into per-line strings ──────────────────────────
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
      const closing = openTags.slice().reverse()
        .map(t => '</' + (t.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1] || 'span') + '>')
        .join('');
      lines.push(line + closing); line = openTags.join(''); i++;
    } else { line += html[i++]; }
  }
  if (line) lines.push(line);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ─── Highlight once and cache ──────────────────────────────────────────────
function _vsHighlight(code, lang) {
  const hash = _fastHash(code);
  if (hash === _vsCodeHash) return;
  _vsCodeHash  = hash;
  _vsLastFirst = -1;
  _vsLastLast  = -1;

  const tmp = document.createElement('code');
  tmp.className = lang ? `language-${lang}` : 'language-plaintext';
  tmp.textContent = code;
  try { hljs.highlightElement(tmp); } catch (e) {}
  _vsLines = _splitHtmlLines(tmp.innerHTML);
}

// ─── Write DOM only when visible range changes ─────────────────────────────
function _vsRenderWindow() {
  if (_vsSuspended) return;  // skip ALL writes during resize drag

  const body      = document.getElementById('sidePanelBody');
  const container = document.getElementById('spCodeWrap');
  if (!body || !container || !_vsLines.length) return;

  const scrollTop    = body.scrollTop;
  const clientHeight = body.clientHeight;
  const total        = _vsLines.length;

  const first = Math.max(0, Math.floor((scrollTop - VS_PAD) / VS_ROW_H) - VS_BUFFER);
  const last  = Math.min(total - 1, Math.ceil((scrollTop + clientHeight - VS_PAD) / VS_ROW_H) + VS_BUFFER);

  // Skip DOM write if range unchanged
  if (first === _vsLastFirst && last === _vsLastLast) return;
  _vsLastFirst = first;
  _vsLastLast  = last;

  const topH    = VS_PAD + first * VS_ROW_H;
  const bottomH = Math.max(0, (total - 1 - last) * VS_ROW_H + VS_PAD);

  const parts = [];
  parts.push('<table class="sp-code-table"><tbody>');
  if (topH > 0) parts.push(
    `<tr class="sp-spacer"><td colspan="2" style="height:${topH.toFixed(1)}px"></td></tr>`
  );
  for (let i = first; i <= last; i++) {
    parts.push(
      `<tr class="sp-line"><td class="sp-line-num">${i + 1}</td>` +
      `<td class="sp-line-code">${_vsLines[i] || '\u200B'}</td></tr>`
    );
  }
  if (bottomH > 0) parts.push(
    `<tr class="sp-spacer"><td colspan="2" style="height:${bottomH.toFixed(1)}px"></td></tr>`
  );
  parts.push('</tbody></table>');

  container.innerHTML = parts.join('');
}

// ─── Schedule via rAF (one pending at a time) ─────────────────────────────
function _vsScheduleRender() {
  if (_vsRafId || _vsSuspended) return;
  _vsRafId = requestAnimationFrame(() => {
    _vsRafId = 0;
    _vsRenderWindow();
  });
}

// ─── Cancel any pending rAF ───────────────────────────────────────────────
function _vsCancelRender() {
  if (_vsRafId) { cancelAnimationFrame(_vsRafId); _vsRafId = 0; }
}

// ─── Pause/resume rendering during resize ─────────────────────────────────
function _vsSuspendRendering() {
  _vsSuspended = true;
  _vsCancelRender();
}

function _vsResumeRendering() {
  _vsSuspended  = false;
  _vsLastFirst  = -1;   // force fresh render on resume
  _vsLastLast   = -1;
  _vsScheduleRender();
}

// ─── Main render entry ─────────────────────────────────────────────────────
function _renderSidePanelCode(code, lang) {
  const body = document.getElementById('sidePanelBody');
  if (!body) return;

  const savedTop    = body.scrollTop;
  const savedLeft   = body.scrollLeft;
  const wasAtBottom = (body.scrollHeight - body.scrollTop - body.clientHeight) < 20;

  _vsHighlight(code, lang);

  // Set exact container height for correct scrollbar
  const container = document.getElementById('spCodeWrap');
  if (container) {
    container.style.height = (VS_PAD + _vsLines.length * VS_ROW_H + VS_PAD).toFixed(1) + 'px';
  }

  _vsLastFirst = -1;
  _vsLastLast  = -1;
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

// ─── Init virtual scroll listener (once) ──────────────────────────────────
let _vsScrollBound = false;
function _initVirtualScroll() {
  if (_vsScrollBound) return;
  _vsScrollBound = true;
  const body = document.getElementById('sidePanelBody');
  if (body) body.addEventListener('scroll', _vsScheduleRender, { passive: true });
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
  } else {
    langEl.style.color = langEl.style.background = langEl.style.border = '';
  }

  document.getElementById('spCopyBtn').textContent = 'Copy';
  document.getElementById('spCopyBtn').classList.remove('success');

  _applyWrapState();
  _initVirtualScroll();

  _vsCodeHash  = '';   // force fresh highlight
  _renderSidePanelCode(code, spLang);

  const panel = document.getElementById('sidePanel');
  panel.style.width = '';
  panel.classList.add('open');

  requestAnimationFrame(() => {
    const body = document.getElementById('sidePanelBody');
    if (body) { body.scrollTop = body.scrollHeight; _vsScheduleRender(); }
  });
}

// ─── Live update (throttled to 400ms) ─────────────────────────────────────
function updateLiveSidePanel(container, msgId) {
  if (!_liveSidePanelInfo || _liveSidePanelInfo.msgId !== msgId) return;
  if (!document.getElementById('sidePanel').classList.contains('open')) {
    _liveSidePanelInfo = null; return;
  }
  if (_liveUpdateTimer) return;
  _liveUpdateTimer = setTimeout(() => {
    _liveUpdateTimer = null;
    _doLiveUpdate(container, msgId);
  }, 400);
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
  panel.classList.remove('open');
  panel.style.width = '';
  _liveSidePanelInfo = null;
  _vsLines = []; _vsCodeHash = ''; _vsLastFirst = -1; _vsLastLast = -1;
  _vsSuspended = false;
  _vsCancelRender();
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
  _wrapOn = !_wrapOn;
  _applyWrapState();
  _vsLastFirst = -1; _vsLastLast = -1;
  _vsScheduleRender();
}

// ─── Resize handle ─────────────────────────────────────────────────────────
function _initSidePanelResize() {
  const panel  = document.getElementById('sidePanel');
  const handle = document.getElementById('spResizeHandle');
  if (!handle || !panel) return;

  let startX = 0, startW = 0, dragging = false;
  const MIN_W       = 280;
  const getMaxW     = () => Math.min(Math.floor(window.innerWidth * 0.75), window.innerWidth - 400);
  const isMobileView = () => window.innerWidth <= 768;

  // ── Mouse ────────────────────────────────────────────────────────────
  handle.addEventListener('mousedown', function(e) {
    if (isMobileView()) return;
    e.preventDefault();
    dragging = true;
    startX   = e.clientX;
    startW   = panel.offsetWidth;
    handle.classList.add('dragging');
    panel.classList.add('no-transition');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';

    // Suspend virtual scroll rendering for the duration of the drag
    _vsSuspendRendering();
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    // Only update the CSS width — no content re-render
    const newW = Math.max(MIN_W, Math.min(getMaxW(), startW + (startX - e.clientX)));
    panel.style.width = newW + 'px';
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    panel.classList.remove('no-transition');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';

    // Resume and render once now that drag is done
    _vsResumeRendering();
  });

  // ── Touch ────────────────────────────────────────────────────────────
  handle.addEventListener('touchstart', function(e) {
    if (isMobileView()) return;
    dragging = true;
    startX   = e.touches[0].clientX;
    startW   = panel.offsetWidth;
    panel.classList.add('no-transition');
    _vsSuspendRendering();
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    const newW = Math.max(MIN_W, Math.min(getMaxW(), startW + (startX - e.touches[0].clientX)));
    panel.style.width = newW + 'px';
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('no-transition');
    _vsResumeRendering();
  });

  _applyWrapState();
  _initVirtualScroll();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initSidePanelResize);
} else {
  _initSidePanelResize();
}
