// public/js/sidepanel.js — FULL REPLACEMENT

// ═══════════════════════════════════════════════════════════════════════════
// SIDE PANEL — Table-based line numbers, resizable, word-wrap toggle
// ═══════════════════════════════════════════════════════════════════════════

const _langBadgeColours = {
  js:'#f7df1e',         javascript:'#f7df1e',
  ts:'#3178c6',         typescript:'#3178c6',
  jsx:'#61dafb',        tsx:'#61dafb',
  py:'#4ea8de',         python:'#4ea8de',
  json:'#7ec87e',
  html:'#e44d26',
  css:'#7aabdf',
  sh:'#a78bfa',         bash:'#a78bfa',   shell:'#a78bfa',
  md:'#6ec6c8',         markdown:'#6ec6c8',
  rust:'#f97316',       rs:'#f97316',
  go:'#00acd7',
  java:'#f89820',
  cpp:'#6ea8d4',        c:'#6ea8d4',
  ruby:'#e87a90',       rb:'#e87a90',
  sql:'#a8d8a8',
  yaml:'#fbbf24',       yml:'#fbbf24',
  xml:'#e8a87a',
};

let _liveSidePanelInfo = null;
let _wrapOn = true; // wrap ON by default

// ─── Split highlighted HTML into per-line segments ─────────────────────────
// Walks HTML tracking open spans. At each \n it closes open spans, emits
// the line, then re-opens them — so syntax highlighting is never broken.
function _splitHtmlLines(html) {
  const lines    = [];
  let line       = '';
  let openTags   = [];
  let i          = 0;

  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) { line += html[i++]; continue; }

      const tag     = html.slice(i, end + 1);
      const isClose = tag.startsWith('</');

      if (!isClose) {
        if (!tag.endsWith('/>')) openTags.push(tag);
        line += tag;
      } else {
        openTags.pop();
        line += tag;
      }
      i = end + 1;

    } else if (html[i] === '\n') {
      const closing = openTags.slice().reverse()
        .map(t => '</' + (t.match(/^<([a-zA-Z][a-zA-Z0-9]*)/)?.[1] || 'span') + '>')
        .join('');
      lines.push(line + closing);
      line = openTags.join('');
      i++;

    } else {
      line += html[i++];
    }
  }

  if (line) lines.push(line);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ─── Render code into table, preserving scroll position ───────────────────
function _renderSidePanelCode(code, lang) {
  const container = document.getElementById('spCodeWrap');
  const body      = document.getElementById('sidePanelBody');
  if (!container) return;

  // Preserve scroll before re-render so View during streaming doesn't jump
  const savedTop  = body ? body.scrollTop  : 0;
  const savedLeft = body ? body.scrollLeft : 0;

  // 1. Highlight in one pass
  const tmp = document.createElement('code');
  tmp.className = lang ? `language-${lang}` : 'language-plaintext';
  tmp.textContent = code;
  try { hljs.highlightElement(tmp); } catch(e) {}

  // 2. Split into per-line HTML segments
  const lineHtmls = _splitHtmlLines(tmp.innerHTML);

  // 3. Build table — one <tr> per source line
  const table = document.createElement('table');
  table.className = 'sp-code-table';
  const tbody = document.createElement('tbody');

  lineHtmls.forEach((lineHtml, i) => {
    const tr = document.createElement('tr');
    tr.className = 'sp-line';

    const numTd = document.createElement('td');
    numTd.className   = 'sp-line-num';
    numTd.textContent = String(i + 1);

    const codeTd = document.createElement('td');
    codeTd.className = 'sp-line-code';
    codeTd.innerHTML = lineHtml || '\u200B';

    tr.appendChild(numTd);
    tr.appendChild(codeTd);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);

  // Restore scroll position
  if (body) {
    body.scrollTop  = savedTop;
    body.scrollLeft = savedLeft;
  }
}

// ─── Apply current wrap state ──────────────────────────────────────────────
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

  spCode     = code;
  spLang     = lang || 'text';
  spFilename = filename || langToFilename(lang);

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

  const copyBtn = document.getElementById('spCopyBtn');
  copyBtn.textContent = 'Copy';
  copyBtn.classList.remove('success');

  _applyWrapState();
  _renderSidePanelCode(code, spLang);
  document.getElementById('sidePanel').classList.add('open');
}

// ─── Live update during streaming ─────────────────────────────────────────
function updateLiveSidePanel(container, msgId) {
  if (!_liveSidePanelInfo) return;
  if (_liveSidePanelInfo.msgId !== msgId) return;
  if (!document.getElementById('sidePanel').classList.contains('open')) {
    _liveSidePanelInfo = null;
    return;
  }

  const idx  = _liveSidePanelInfo.blockIdx;
  const wrap = container.querySelector(`.stream-wrap[data-blockidx="${idx}"]`);
  if (!wrap) return;

  const codeEl = wrap.querySelector('pre code');
  if (!codeEl) return;

  const newCode = codeEl.textContent;
  const newLang = wrap.dataset.lang || 'text';

  if (newCode !== spCode) {
    spCode = newCode;
    spLang = newLang;
    // _renderSidePanelCode preserves scroll internally
    _renderSidePanelCode(newCode, newLang);
  }
}

function clearLiveSidePanelFor(msgId) {
  if (_liveSidePanelInfo && _liveSidePanelInfo.msgId === msgId) {
    _liveSidePanelInfo = null;
  }
}

// ─── Close ─────────────────────────────────────────────────────────────────
function closeSidePanel() {
  const panel = document.getElementById('sidePanel');
  panel.classList.remove('open');
  // Clear inline width from resize drag so CSS width:0 takes effect
  panel.style.width = '';
  _liveSidePanelInfo = null;
}

// ─── Copy ──────────────────────────────────────────────────────────────────
function copySidePanel() {
  navigator.clipboard.writeText(spCode).then(() => {
    const btn = document.getElementById('spCopyBtn');
    btn.textContent = '✓ Copied!';
    btn.classList.add('success');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('success'); }, 2000);
  });
}

// ─── Download ──────────────────────────────────────────────────────────────
function downloadSidePanel() {
  downloadCode(spCode, spLang, spFilename);
}

// ─── Word-wrap toggle ──────────────────────────────────────────────────────
function toggleSidePanelWrap() {
  _wrapOn = !_wrapOn;
  _applyWrapState();
}

// ─── Resize handle ─────────────────────────────────────────────────────────
function _initSidePanelResize() {
  const panel  = document.getElementById('sidePanel');
  const handle = document.getElementById('spResizeHandle');
  if (!handle || !panel) return;

  let startX   = 0;
  let startW   = 0;
  let dragging = false;

  const MIN_W   = 320;
  const getMaxW = () => Math.min(
    Math.floor(window.innerWidth * 0.75),
    window.innerWidth - 400
  );

  handle.addEventListener('mousedown', function(e) {
    e.preventDefault();
    dragging = true;
    startX   = e.clientX;
    startW   = panel.offsetWidth;
    handle.classList.add('dragging');
    panel.classList.add('no-transition');
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    const delta = startX - e.clientX;
    const newW  = Math.max(MIN_W, Math.min(getMaxW(), startW + delta));
    panel.style.width = newW + 'px';
  });

  document.addEventListener('mouseup', function() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    panel.classList.remove('no-transition');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
  });

  handle.addEventListener('touchstart', function(e) {
    const t  = e.touches[0];
    dragging = true;
    startX   = t.clientX;
    startW   = panel.offsetWidth;
    panel.classList.add('no-transition');
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    const t     = e.touches[0];
    const delta = startX - t.clientX;
    const newW  = Math.max(MIN_W, Math.min(getMaxW(), startW + delta));
    panel.style.width = newW + 'px';
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('no-transition');
  });

  _applyWrapState();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initSidePanelResize);
} else {
  _initSidePanelResize();
}
