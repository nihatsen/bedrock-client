// public/js/sidepanel.js — FULL REPLACEMENT
// Virtual scrolling: only renders ~50 rows at a time regardless of file size.
// A 2000-line file renders as fast as a 10-line file.

const _langBadgeColours = {
  js:'#f7df1e',javascript:'#f7df1e',ts:'#3178c6',typescript:'#3178c6',
  jsx:'#61dafb',tsx:'#61dafb',py:'#4ea8de',python:'#4ea8de',json:'#7ec87e',
  html:'#e44d26',css:'#7aabdf',sh:'#a78bfa',bash:'#a78bfa',shell:'#a78bfa',
  md:'#6ec6c8',markdown:'#6ec6c8',rust:'#f97316',rs:'#f97316',go:'#00acd7',
  java:'#f89820',cpp:'#6ea8d4',c:'#6ea8d4',ruby:'#e87a90',rb:'#e87a90',
  sql:'#a8d8a8',yaml:'#fbbf24',yml:'#fbbf24',xml:'#e8a87a',
};

let _liveSidePanelInfo = null;
let _wrapOn = true;
let _liveUpdateTimer = null;

// ─── Virtual scroll state ──────────────────────────────────────────────────
const VS_ROW_H   = 21.45;  // px per line: 13px font * 1.65 line-height
const VS_PAD     = 16;     // top/bottom padding inside code
const VS_BUFFER  = 40;     // extra rows to render above/below viewport
let _vsLines     = [];     // array of highlighted HTML strings
let _vsRafPending = false;

// ─── Split highlighted HTML into per-line segments ─────────────────────────
function _splitHtmlLines(html) {
  const lines = []; let line = '', openTags = [], i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i); if (end === -1) { line += html[i++]; continue; }
      const tag = html.slice(i, end+1), isClose = tag.startsWith('</');
      if (!isClose) { if (!tag.endsWith('/>')) openTags.push(tag); line += tag; }
      else { openTags.pop(); line += tag; }
      i = end + 1;
    } else if (html[i] === '\n') {
      const closing = openTags.slice().reverse().map(t => '</' + (t.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1]||'span') + '>').join('');
      lines.push(line + closing); line = openTags.join(''); i++;
    } else { line += html[i++]; }
  }
  if (line) lines.push(line);
  if (lines.length > 0 && lines[lines.length-1] === '') lines.pop();
  return lines;
}

// ─── Full height of virtual container ─────────────────────────────────────
function _vsFullHeight(lineCount) {
  return VS_PAD + lineCount * VS_ROW_H + VS_PAD;
}

// ─── Render only visible slice ─────────────────────────────────────────────
function _vsRenderWindow(scrollTop, clientHeight) {
  const container = document.getElementById('spCodeWrap');
  if (!container || !_vsLines.length) return;

  const total = _vsLines.length;
  const fullH = _vsFullHeight(total);

  // Which lines are visible?
  const firstVisible = Math.max(0, Math.floor((scrollTop - VS_PAD) / VS_ROW_H) - VS_BUFFER);
  const lastVisible  = Math.min(total - 1, Math.ceil((scrollTop + clientHeight - VS_PAD) / VS_ROW_H) + VS_BUFFER);

  // Top spacer height (rows above rendered window)
  const topSpacerH   = VS_PAD + firstVisible * VS_ROW_H;
  // Bottom spacer height
  const bottomSpacerH = (total - 1 - lastVisible) * VS_ROW_H + VS_PAD;

  // Build table rows for visible window
  const parts = ['<table class="sp-code-table"><tbody>'];
  // Top spacer row
  if (topSpacerH > 0) {
    parts.push(`<tr class="sp-spacer"><td style="height:${topSpacerH}px;padding:0" colspan="2"></td></tr>`);
  }
  // Visible rows
  for (let i = firstVisible; i <= lastVisible; i++) {
    parts.push(`<tr class="sp-line"><td class="sp-line-num">${i + 1}</td><td class="sp-line-code">${_vsLines[i] || '\u200B'}</td></tr>`);
  }
  // Bottom spacer row
  if (bottomSpacerH > 0) {
    parts.push(`<tr class="sp-spacer"><td style="height:${bottomSpacerH}px;padding:0" colspan="2"></td></tr>`);
  }
  parts.push('</tbody></table>');

  container.innerHTML = parts.join('');
}

// ─── Schedule a virtual render via rAF (debounced) ─────────────────────────
function _vsScheduleRender() {
  if (_vsRafPending) return;
  _vsRafPending = true;
  requestAnimationFrame(() => {
    _vsRafPending = false;
    const body = document.getElementById('sidePanelBody');
    if (body) _vsRenderWindow(body.scrollTop, body.clientHeight);
  });
}

// ─── Main render function ──────────────────────────────────────────────────
function _renderSidePanelCode(code, lang) {
  const body = document.getElementById('sidePanelBody');
  if (!body) return;

  const savedTop  = body.scrollTop;
  const savedLeft = body.scrollLeft;
  const wasAtBottom = (body.scrollHeight - body.scrollTop - body.clientHeight) < 20;

  // 1. Highlight synchronously (fast — just string ops, no DOM)
  const tmp = document.createElement('code');
  tmp.className = lang ? `language-${lang}` : 'language-plaintext';
  tmp.textContent = code;
  try { hljs.highlightElement(tmp); } catch(e) {}

  // 2. Split into line strings (no DOM creation yet)
  _vsLines = _splitHtmlLines(tmp.innerHTML);

  // 3. Render only the visible window
  _vsRenderWindow(wasAtBottom ? 0 : savedTop, body.clientHeight);

  // 4. Restore scroll
  if (wasAtBottom) {
    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  } else {
    body.scrollTop = savedTop;
    body.scrollLeft = savedLeft;
  }
}

// ─── Scroll listener: re-render visible window ─────────────────────────────
function _initVirtualScroll() {
  const body = document.getElementById('sidePanelBody');
  if (!body) return;
  body.addEventListener('scroll', _vsScheduleRender, { passive: true });
  // Re-render on resize
  const ro = new ResizeObserver(_vsScheduleRender);
  ro.observe(body);
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
  if (colour) { langEl.style.color = colour; langEl.style.background = colour+'1a'; langEl.style.border = '1px solid '+colour+'48'; }
  else { langEl.style.color = langEl.style.background = langEl.style.border = ''; }

  const copyBtn = document.getElementById('spCopyBtn');
  copyBtn.textContent = 'Copy'; copyBtn.classList.remove('success');

  _applyWrapState();
  _renderSidePanelCode(code, spLang);

  const panel = document.getElementById('sidePanel');
  panel.style.width = '';
  panel.classList.add('open');

  requestAnimationFrame(() => {
    const body = document.getElementById('sidePanelBody');
    if (body) { body.scrollTop = body.scrollHeight; _vsRenderWindow(body.scrollTop, body.clientHeight); }
  });
}

// ─── Live update during streaming (throttled) ─────────────────────────────
function updateLiveSidePanel(container, msgId) {
  if (!_liveSidePanelInfo || _liveSidePanelInfo.msgId !== msgId) return;
  if (!document.getElementById('sidePanel').classList.contains('open')) { _liveSidePanelInfo = null; return; }
  if (_liveUpdateTimer) return;
  _liveUpdateTimer = setTimeout(() => {
    _liveUpdateTimer = null;
    _doLiveUpdate(container, msgId);
  }, 300);
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

// ─── Close / Copy / Download / Wrap ───────────────────────────────────────
function closeSidePanel() {
  const panel = document.getElementById('sidePanel');
  panel.classList.remove('open'); panel.style.width = '';
  _liveSidePanelInfo = null; _vsLines = [];
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
function toggleSidePanelWrap() { _wrapOn = !_wrapOn; _applyWrapState(); _vsScheduleRender(); }

// ─── Resize handle ─────────────────────────────────────────────────────────
function _initSidePanelResize() {
  const panel = document.getElementById('sidePanel');
  const handle = document.getElementById('spResizeHandle');
  if (!handle || !panel) return;

  let startX = 0, startW = 0, dragging = false;
  const MIN_W = 280;
  const getMaxW = () => Math.min(Math.floor(window.innerWidth * 0.75), window.innerWidth - 400);
  const isMobileView = () => window.innerWidth <= 768;

  handle.addEventListener('mousedown', function(e) {
    if (isMobileView()) return; e.preventDefault();
    dragging = true; startX = e.clientX; startW = panel.offsetWidth;
    handle.classList.add('dragging'); panel.classList.add('no-transition');
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    panel.style.width = Math.max(MIN_W, Math.min(getMaxW(), startW + (startX - e.clientX))) + 'px';
    _vsScheduleRender();
  });
  document.addEventListener('mouseup', function() {
    if (!dragging) return; dragging = false;
    handle.classList.remove('dragging'); panel.classList.remove('no-transition');
    document.body.style.cursor = ''; document.body.style.userSelect = '';
    _vsScheduleRender();
  });
  handle.addEventListener('touchstart', function(e) {
    if (isMobileView()) return;
    dragging = true; startX = e.touches[0].clientX; startW = panel.offsetWidth;
    panel.classList.add('no-transition');
  }, { passive: true });
  document.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    panel.style.width = Math.max(MIN_W, Math.min(getMaxW(), startW + (startX - e.touches[0].clientX))) + 'px';
  }, { passive: true });
  document.addEventListener('touchend', function() {
    if (!dragging) return; dragging = false;
    panel.classList.remove('no-transition'); _vsScheduleRender();
  });

  _initVirtualScroll();
  _applyWrapState();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initSidePanelResize);
else _initSidePanelResize();
