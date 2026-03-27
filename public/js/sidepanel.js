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
let _wrapOn = true;
let _liveUpdateTimer = null;

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

function _renderSidePanelCode(code, lang) {
  const container = document.getElementById('spCodeWrap');
  const body = document.getElementById('sidePanelBody');
  if (!container) return;

  const savedTop = body ? body.scrollTop : 0;
  const savedLeft = body ? body.scrollLeft : 0;
  const wasAtBottom = body ? (body.scrollHeight - body.scrollTop - body.clientHeight) < 20 : true;

  const tmp = document.createElement('code');
  tmp.className = lang ? `language-${lang}` : 'language-plaintext';
  tmp.textContent = code;
  try { hljs.highlightElement(tmp); } catch(e) {}

  const lineHtmls = _splitHtmlLines(tmp.innerHTML);
  const rowCount = lineHtmls.length;
  const parts = new Array(rowCount + 2);
  parts[0] = '<table class="sp-code-table"><tbody>';
  for (let i = 0; i < rowCount; i++) {
    parts[i+1] = `<tr class="sp-line"><td class="sp-line-num">${i+1}</td><td class="sp-line-code">${lineHtmls[i]||'\u200B'}</td></tr>`;
  }
  parts[rowCount+1] = '</tbody></table>';
  container.innerHTML = parts.join('');

  if (body) {
    if (wasAtBottom) body.scrollTop = body.scrollHeight;
    else { body.scrollTop = savedTop; body.scrollLeft = savedLeft; }
  }
}

function _applyWrapState() {
  const body = document.getElementById('sidePanelBody');
  const btn = document.getElementById('spWrapBtn');
  if (!body || !btn) return;
  body.classList.toggle('wrap-on', _wrapOn);
  btn.classList.toggle('active', _wrapOn);
  btn.textContent = _wrapOn ? '↵ Wrap: on' : '↵ Wrap';
}

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
    if (body) body.scrollTop = body.scrollHeight;
  });
}

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
  const idx = _liveSidePanelInfo.blockIdx;
  const wrap = container.querySelector(`.stream-wrap[data-blockidx="${idx}"]`);
  if (!wrap) return;
  const codeEl = wrap.querySelector('pre code');
  if (!codeEl) return;
  const newCode = codeEl.textContent, newLang = wrap.dataset.lang || 'text';
  if (newCode !== spCode) {
    spCode = newCode; spLang = newLang;
    _renderSidePanelCode(newCode, newLang);
  }
}

function clearLiveSidePanelFor(msgId) {
  if (_liveSidePanelInfo?.msgId === msgId) _liveSidePanelInfo = null;
  if (_liveUpdateTimer) { clearTimeout(_liveUpdateTimer); _liveUpdateTimer = null; }
}

function closeSidePanel() {
  const panel = document.getElementById('sidePanel');
  panel.classList.remove('open'); panel.style.width = '';
  _liveSidePanelInfo = null;
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
function toggleSidePanelWrap() { _wrapOn = !_wrapOn; _applyWrapState(); }

function _initSidePanelResize() {
  const panel = document.getElementById('sidePanel');
  const handle = document.getElementById('spResizeHandle');
  if (!handle || !panel) return;
  let startX = 0, startW = 0, dragging = false;
  const MIN_W = 320;
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
  });
  document.addEventListener('mouseup', function() {
    if (!dragging) return; dragging = false;
    handle.classList.remove('dragging'); panel.classList.remove('no-transition');
    document.body.style.cursor = ''; document.body.style.userSelect = '';
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
  document.addEventListener('touchend', function() { if (!dragging) return; dragging = false; panel.classList.remove('no-transition'); });
  _applyWrapState();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initSidePanelResize);
else _initSidePanelResize();
