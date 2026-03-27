// public/js/artifacts.js — FULL REPLACEMENT

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACTS — hlStreaming, processCodeBlocks, buildFileList, artifact cards
// ═══════════════════════════════════════════════════════════════════════════

const _streamExpanded = {};

function cleanupStreamExpanded(msgId) {
  delete _streamExpanded[msgId];
}

// ─── Language → short label ───────────────────────────────────────────────
function langLabel(lang) {
  const m = {
    javascript:'JS',  js:'JS',   typescript:'TS',   ts:'TS',
    jsx:'JSX',        tsx:'TSX', python:'PY',        py:'PY',
    bash:'SH',        sh:'SH',   shell:'SH',         html:'HTML',
    css:'CSS',        json:'JSON',yaml:'YAML',        yml:'YAML',
    rust:'RS',        go:'GO',   java:'JAVA',         c:'C',
    cpp:'C++',        ruby:'RB', php:'PHP',           sql:'SQL',
    markdown:'MD',    md:'MD',   xml:'XML',           text:'TXT',
  };
  return m[(lang||'').toLowerCase()] || (lang||'TXT').slice(0,6).toUpperCase();
}

// ─── Stable ID for a code block ───────────────────────────────────────────
// Keyed by lang + first 50 chars of code so it stays stable as streaming
// appends to the end. This prevents the expand state from being lost when
// the DOM index shifts (which happens when marked renders partial fences).
function _stableId(lang, code) {
  return (lang || 'text') + '|||' + (code || '').slice(0, 50);
}

// ─── Extract filename from inside code comments ───────────────────────────
function _extractFilenameFromCode(code) {
  if (!code) return null;
  const firstLines = code.split('\n').slice(0, 8);
  for (const line of firstLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(
      /^(?:\/\/|#|\/\*+|\*)\s*(?:[Ff]ile(?:name)?:?\s*)?(?:[^\s]*[/\\])?([a-zA-Z0-9_][a-zA-Z0-9_.-]*\.[a-zA-Z0-9]{1,10})/
    );
    if (m) {
      const fname = m[1];
      if (fname && fname.length >= 3 && fname.length <= 60 && /^[a-zA-Z]/.test(fname)) {
        return fname;
      }
    }
  }
  return null;
}

// ─── Extract filename from surrounding DOM context ────────────────────────
// IMPORTANT: skip .stream-wrap siblings entirely — their header text contains
// the filename of the PREVIOUS code block, not this one.
function _extractFilenameFromDom(pre) {
  if (!pre) return null;
  let el = pre.previousElementSibling;
  let checked = 0;
  while (el && checked < 6) {
    // Skip other code blocks and file-list panels — they contain filenames
    // that belong to those elements, not the current block.
    if (
      el.classList.contains('stream-wrap') ||
      el.classList.contains('file-list')   ||
      el.classList.contains('artifact-cards')
    ) {
      el = el.previousElementSibling;
      // Don't count skipped elements toward the 6-element limit
      continue;
    }

    const text = el.textContent.trim();
    if (text && text.length < 300) {
      // Match a filename (with extension) anywhere in the text, preferring
      // the last occurrence (e.g. "Create src/utils/helper.js:" → "helper.js")
      const re = /(?:^|[/\\ `*:([\s])([a-zA-Z0-9_][a-zA-Z0-9_-]*\.[a-zA-Z][a-zA-Z0-9]{0,9})(?:[`*)\]:\s]|$)/g;
      let last = null;
      let match;
      while ((match = re.exec(text)) !== null) {
        const fname = match[1];
        if (
          fname.length >= 4 &&
          fname.length <= 80 &&
          /^[a-zA-Z]/.test(fname) &&
          !/^\d+$/.test(fname.split('.').pop()) // extension not all-digits
        ) {
          last = fname;
        }
      }
      if (last) return last;
    }

    el = el.previousElementSibling;
    checked++;
  }
  return null;
}

// ─── Master filename resolver ──────────────────────────────────────────────
function resolveFilename(code, lang, pre) {
  return _extractFilenameFromCode(code)
      || _extractFilenameFromDom(pre)
      || langToFilename(lang);
}

// Keep old name working for any external callers
function extractFilename(code, lang) {
  return _extractFilenameFromCode(code) || langToFilename(lang);
}

// ─── Safe highlight — always removes data-highlighted first ───────────────
function _hlHighlight(el) {
  if (!el) return;
  el.removeAttribute('data-highlighted');
  try { hljs.highlightElement(el); } catch(e) {}
}

// ─── Shared clipboard copy ────────────────────────────────────────────────
function _copyText(text, btn) {
  const doSuccess = () => {
    const orig = btn.textContent;
    btn.textContent = '✓ Copied';
    btn.classList.add('success');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('success'); }, 1500);
  };
  navigator.clipboard.writeText(text).then(doSuccess).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); doSuccess(); } catch(e) {}
    document.body.removeChild(ta);
  });
}

// ─── Build code header ────────────────────────────────────────────────────
function _buildCodeHeader(lang, fname, lines, toggleBtn, viewBtn, copyBtn, dlBtn) {
  const hdr = document.createElement('div');
  hdr.className = 'code-header';

  const langSpan = document.createElement('span');
  langSpan.className = 'code-lang';
  langSpan.textContent = langLabel(lang);
  langSpan.dataset.lang = lang.toLowerCase();

  const fnameSpan = document.createElement('span');
  fnameSpan.className = 'sw-fname';
  fnameSpan.style.cssText = 'color:var(--text1);font-size:11px;margin-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;';
  fnameSpan.textContent = fname;

  const linesSpan = document.createElement('span');
  linesSpan.className = 'code-lines sw-lines';
  linesSpan.style.marginLeft = '6px';
  linesSpan.textContent = lines + ' line' + (lines !== 1 ? 's' : '');

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'code-actions';
  actionsDiv.append(toggleBtn, viewBtn, copyBtn, dlBtn);

  hdr.append(langSpan, fnameSpan, linesSpan, actionsDiv);
  return hdr;
}

// ─── Build code footer (collapse button at bottom) ────────────────────────
function _buildCodeFooter(onCollapse) {
  const footer = document.createElement('div');
  footer.className = 'code-footer';
  const btn = document.createElement('button');
  btn.className = 'code-footer-btn';
  btn.textContent = '▴ Collapse';
  btn.addEventListener('click', function(e) { e.stopPropagation(); onCollapse(); });
  footer.appendChild(btn);
  return footer;
}

// ─── Build action buttons ─────────────────────────────────────────────────
function _buildActionBtns() {
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'code-btn';
  toggleBtn.textContent = '▾ Expand';
  toggleBtn.title = 'Expand';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'code-btn';
  viewBtn.textContent = '⤢ View';
  viewBtn.title = 'Open in side panel';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'code-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.title = 'Copy to clipboard';

  const dlBtn = document.createElement('button');
  dlBtn.className = 'code-btn';
  dlBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2.5">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`;
  dlBtn.title = 'Download';

  return { toggleBtn, viewBtn, copyBtn, dlBtn };
}

// ─── hlStreaming — wraps every <pre> during streaming ─────────────────────
function hlStreaming(container, msgId, savedWraps) {
  if (!savedWraps) savedWraps = {};

  const pres = Array.from(container.querySelectorAll('pre'));
  pres.forEach((pre, idx) => {

    const codeEl = pre.querySelector('code');
    const lang   = (codeEl?.className || '').replace('language-','').split(' ')[0] || 'text';
    const code   = codeEl?.textContent || '';

    // Use stableid (not DOM index) so the wrap survives re-renders where
    // the index shifts (e.g. when marked alternates between rendering
    // partial fences as <pre> vs plain text during streaming).
    const sid = _stableId(lang, code);

    // ── Reuse existing wrap ──────────────────────────────────────────────
    // Look up by stableid first, then fall back to blockidx for compat
    const existing = savedWraps[sid] || savedWraps[String(idx)];
    if (existing) {
      // Re-stamp stableid in case it was previously keyed by idx
      existing.dataset.stableid = sid;
      existing.dataset.blockidx = String(idx);

      const existCode = existing.querySelector('pre code');
      if (existCode && code && existCode.textContent !== code) {
        const savedClass = existCode.className;
        existCode.textContent = code;
        existCode.className   = savedClass;
        _hlHighlight(existCode);

        const lc = existing.querySelector('.sw-lines');
        if (lc) {
          const n = code.split('\n').length;
          lc.textContent = n + ' line' + (n !== 1 ? 's' : '');
        }
        const fnSpan = existing.querySelector('.sw-fname');
        if (fnSpan) {
          // Only update fname from code comments (DOM scan would hit the
          // wrap itself which is already in the DOM)
          const smartName = _extractFilenameFromCode(code) || langToFilename(lang);
          if (smartName !== fnSpan.textContent) {
            fnSpan.textContent     = smartName;
            existing.dataset.fname = smartName;
          }
        }
      }
      pre.replaceWith(existing);
      return;
    }

    // ── Build fresh stream-wrap ──────────────────────────────────────────
    const fname  = resolveFilename(code, lang, pre);
    const lines  = code.split('\n').length;

    if (codeEl) { _hlHighlight(codeEl); }

    const wrap = document.createElement('div');
    wrap.className        = 'stream-wrap';
    wrap.dataset.msgid    = msgId;
    wrap.dataset.blockidx = String(idx);
    wrap.dataset.stableid = sid;
    wrap.dataset.lang     = lang;
    wrap.dataset.fname    = fname;

    const { toggleBtn, viewBtn, copyBtn, dlBtn } = _buildActionBtns();

    const doCollapse = () => {
      if (!_streamExpanded[msgId]) _streamExpanded[msgId] = {};
      _streamExpanded[msgId][sid] = false;
      pre.style.maxHeight = '260px';
      pre.style.overflow  = 'hidden';
      fade.style.display  = '';
      footer.classList.remove('visible');
      toggleBtn.textContent = '▾ Expand';
    };

    const footer = _buildCodeFooter(doCollapse);
    const fade   = document.createElement('div');
    fade.className = 'stream-code-fade';

    const hdr = _buildCodeHeader(lang, fname, lines, toggleBtn, viewBtn, copyBtn, dlBtn);
    wrap.appendChild(hdr);

    pre.style.maxHeight = '260px';
    pre.style.overflow  = 'hidden';
    pre.style.margin = pre.style.borderRadius = pre.style.border = '0';

    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    wrap.appendChild(fade);
    wrap.appendChild(footer);

    // Restore expand state if previously expanded under this stableid
    if (_streamExpanded[msgId]?.[sid]) {
      pre.style.maxHeight = 'none';
      pre.style.overflow  = 'auto';
      fade.style.display  = 'none';
      footer.classList.add('visible');
      toggleBtn.textContent = '▾ Expand';
    }

    toggleBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (!_streamExpanded[msgId]) _streamExpanded[msgId] = {};
      const nowExpanded = !_streamExpanded[msgId][sid];
      _streamExpanded[msgId][sid] = nowExpanded;
      if (nowExpanded) {
        pre.style.maxHeight = 'none';
        pre.style.overflow  = 'auto';
        fade.style.display  = 'none';
        footer.classList.add('visible');
        toggleBtn.textContent = '▾ Expand';
      } else {
        doCollapse();
      }
    });

    viewBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      const cur = wrap.querySelector('pre code')?.textContent || '';
      openSidePanel(cur, lang, wrap.dataset.fname || fname, { msgId, blockIdx: idx });
    });

    copyBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      _copyText(wrap.querySelector('pre code')?.textContent || '', copyBtn);
    });

    dlBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      downloadCode(wrap.querySelector('pre code')?.textContent || '', lang, wrap.dataset.fname || fname);
    });
  });
}

// ─── processCodeBlocks — finalized messages ───────────────────────────────
function processCodeBlocks(container, fullText) {
  const pres = Array.from(container.querySelectorAll('pre'));
  pres.forEach((pre, idx) => {
    if (pre.closest('.stream-wrap')) return;

    const codeEl  = pre.querySelector('code');
    const lang    = (codeEl?.className || '').replace('language-','').split(' ')[0] || 'text';
    const code    = codeEl?.textContent || '';
    const fname   = resolveFilename(code, lang, pre);
    const lineArr = code.split('\n');
    const lines   = (lineArr[lineArr.length - 1] === '') ? lineArr.length - 1 : lineArr.length;
    const isLong  = lines > 15;

    if (codeEl) { _hlHighlight(codeEl); }

    const wrap = document.createElement('div');
    wrap.className        = 'stream-wrap';
    wrap.dataset.blockidx = String(idx);
    wrap.dataset.stableid = _stableId(lang, code);
    wrap.dataset.lang     = lang;
    wrap.dataset.fname    = fname;

    const { toggleBtn, viewBtn, copyBtn, dlBtn } = _buildActionBtns();

    let isExpanded = !isLong;

    const doCollapse = () => {
      isExpanded = false;
      pre.style.maxHeight = '320px';
      pre.style.overflow  = 'hidden';
      if (fade) fade.style.display = '';
      footer.classList.remove('visible');
      toggleBtn.textContent = '▾ Expand';
    };

    const footer = _buildCodeFooter(doCollapse);
    toggleBtn.textContent = isLong ? '▾ Expand' : '▴ Collapse';

    const hdr = _buildCodeHeader(lang, fname, lines, toggleBtn, viewBtn, copyBtn, dlBtn);
    wrap.appendChild(hdr);

    pre.style.margin = pre.style.borderRadius = pre.style.border = '0';
    pre.replaceWith(wrap);

    let fade = null;

    if (isLong) {
      pre.style.maxHeight = '320px';
      pre.style.overflow  = 'hidden';
      fade = document.createElement('div');
      fade.className = 'stream-code-fade';
      wrap.append(pre, fade);
    } else {
      footer.classList.add('visible');
      wrap.appendChild(pre);
    }

    wrap.appendChild(footer);

    toggleBtn.addEventListener('click', function() {
      isExpanded = !isExpanded;
      if (isExpanded) {
        pre.style.maxHeight = 'none';
        pre.style.overflow  = 'auto';
        if (fade) fade.style.display = 'none';
        footer.classList.add('visible');
        toggleBtn.textContent = '▴ Collapse';
      } else {
        doCollapse();
      }
    });

    viewBtn.addEventListener('click', () => openSidePanel(code, lang, fname, null));
    copyBtn.addEventListener('click', () => _copyText(code, copyBtn));
    dlBtn.addEventListener('click',  () => downloadCode(code, lang, fname));
  });
}

// ─── buildFileList ─────────────────────────────────────────────────────────
function buildFileList(container) {
  const wraps = Array.from(container.querySelectorAll('.stream-wrap'));
  if (!wraps.length) return null;

  const files = wraps.map((wrap) => {
    const codeEl  = wrap.querySelector('pre code');
    const code    = codeEl?.textContent || '';
    const lang    = wrap.dataset.lang || 'text';
    const fname   = wrap.dataset.fname || resolveFilename(code, lang, null);
    const lineArr = code.split('\n');
    const lines   = (lineArr[lineArr.length - 1] === '') ? lineArr.length - 1 : lineArr.length;
    const bytes   = new Blob([code]).size;
    const size    = bytes < 1024    ? bytes + ' B'
                  : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB'
                  : (bytes / 1048576).toFixed(1) + ' MB';
    return { code, lang, fname, lines, size };
  });

  const panel = document.createElement('div');
  panel.className = 'file-list';

  const header = document.createElement('div');
  header.className = 'file-list-header';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'fl-title';
  titleSpan.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
    Files <span class="fl-badge">${files.length}</span>`;

  const dlAllBtn = document.createElement('button');
  dlAllBtn.className = 'fl-download-all';
  dlAllBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x12="3"/>
    </svg>
    Download all`;
  dlAllBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    files.forEach((f, i) => setTimeout(() => downloadCode(f.code, f.lang, f.fname), i * 180));
  });

  header.append(titleSpan, dlAllBtn);
  panel.appendChild(header);

  const list = document.createElement('div');
  list.className = 'file-list-items';

  files.forEach((f) => {
    const item = document.createElement('div');
    item.className = 'fl-item';

    const iconDiv = document.createElement('div');
    iconDiv.className    = 'fl-icon';
    iconDiv.textContent  = langLabel(f.lang);
    iconDiv.dataset.lang = f.lang.toLowerCase();

    const infoDiv = document.createElement('div');
    infoDiv.className = 'fl-info';

    const nameDiv = document.createElement('div');
    nameDiv.className   = 'fl-name';
    nameDiv.textContent = f.fname;

    const metaDiv = document.createElement('div');
    metaDiv.className = 'fl-meta';

    const langBadge  = document.createElement('span');
    langBadge.textContent = f.lang.toUpperCase();
    const linesBadge = document.createElement('span');
    linesBadge.textContent = `${f.lines} line${f.lines !== 1 ? 's' : ''}`;
    const sizeBadge  = document.createElement('span');
    sizeBadge.textContent = f.size;

    metaDiv.append(langBadge, linesBadge, sizeBadge);
    infoDiv.append(nameDiv, metaDiv);

    const dlBtn = document.createElement('button');
    dlBtn.className   = 'fl-download';
    dlBtn.textContent = 'Download';

    item.addEventListener('click', () => openSidePanel(f.code, f.lang, f.fname, null));
    dlBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      downloadCode(f.code, f.lang, f.fname);
    });

    item.append(iconDiv, infoDiv, dlBtn);
    list.appendChild(item);
  });

  panel.appendChild(list);
  return panel;
}

// ─── extractArtifacts ────────────────────────────────────────────────────
function extractArtifacts(text) {
  const arts = [];
  const re   = /```(\w*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const lang = m[1] || 'text';
    const code = m[2];
    arts.push({ lang, code, filename: resolveFilename(code, lang, null) });
  }
  return arts;
}

// ─── buildArtifactCards ───────────────────────────────────────────────────
function buildArtifactCards(arts) {
  const wrap = document.createElement('div');
  wrap.className = 'artifact-cards';
  arts.forEach(a => {
    const card = document.createElement('div');
    card.className = 'artifact-card';
    card.innerHTML = `
      <div class="artifact-card-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
          <polyline points="13 2 13 9 20 9"/>
        </svg>
      </div>
      <div class="artifact-card-info">
        <div class="artifact-card-name">${esc(a.filename)}</div>
        <div class="artifact-card-meta">${esc(a.lang.toUpperCase())} · ${a.code.split('\n').length} lines</div>
      </div>`;
    card.addEventListener('click', () => openSidePanel(a.code, a.lang, a.filename, null));
    const dlBtn = document.createElement('button');
    dlBtn.className   = 'artifact-card-download';
    dlBtn.textContent = 'Download';
    dlBtn.addEventListener('click', e => {
      e.stopPropagation();
      downloadCode(a.code, a.lang, a.filename);
    });
    card.appendChild(dlBtn);
    wrap.appendChild(card);
  });
  return wrap;
}
