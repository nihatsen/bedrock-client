// public/js/artifacts.js — FULL REPLACEMENT

const WRAP_THRESHOLD = 10;
const _streamExpanded = {};

function cleanupStreamExpanded(msgId) { delete _streamExpanded[msgId]; }

function langLabel(lang) {
  const m = { javascript:'JS',js:'JS',typescript:'TS',ts:'TS',jsx:'JSX',tsx:'TSX',python:'PY',py:'PY',bash:'SH',sh:'SH',shell:'SH',html:'HTML',css:'CSS',json:'JSON',yaml:'YAML',yml:'YAML',rust:'RS',go:'GO',java:'JAVA',c:'C',cpp:'C++',ruby:'RB',php:'PHP',sql:'SQL',markdown:'MD',md:'MD',xml:'XML',text:'TXT',env:'ENV',ini:'INI',toml:'TOML' };
  return m[(lang||'').toLowerCase()] || (lang||'TXT').slice(0,6).toUpperCase();
}

function _visibleLines(maxH) { return Math.floor((maxH - 28) / 18.75); }

function _isMsgStreaming(msgId) {
  if (!msgId) return false;
  for (const [, ctx] of streamRegistry) { if (ctx.assistantMsgId === msgId) return true; }
  return false;
}

const _notFilenames = new Set(['node.js','next.js','nuxt.js','vue.js','react.js','angular.js','express.js','nest.js','deno.js','bun.js','three.js','d3.js','jquery.js','lodash.js','moment.js','svelte.js','ember.js','backbone.js','meteor.js','electron.js','gatsby.js','remix.js','astro.js','solid.js','alpine.js','chart.js','anime.js','p5.js','hapi.js','koa.js','fastify.js','vite.js','webpack.js']);

const _nonFileHeadingWords = /\b(output|example\s+output|example\s+response|usage|result|running|terminal|console|log|demo|preview|response|sample|quickstart|quick\s*start|getting\s*started|install|setup|how\s*to|steps|instructions|commands|deploy|project\s+structure|directory\s+structure|folder\s+structure|structure|overview|architecture|diagram|tree|api\s+reference)\b/i;

function _looksLikeFilePath(text) {
  if (/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\.[a-zA-Z]{1,10}/.test(text)) return true;
  if (/^\s*[`*"']?\.[a-zA-Z0-9_.-]+[`*"':)]*\s*$/.test(text)) return true;
  if (text.length <= 60 && /^\s*[`*"']?[a-zA-Z0-9_][a-zA-Z0-9_.-]*\.[a-zA-Z]{1,10}[`*"':)]*\s*$/.test(text)) return true;
  return false;
}

function _stripLeadingDecorators(text) {
  return text.replace(/^[\s\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]+/u, '').replace(/^[\s•·–—\-:>\d.)]+/, '').trim();
}

function _isNonFileContext(pre) {
  if (!pre) return false;
  let el = pre.previousElementSibling, checked = 0;
  while (el && checked < 3) {
    if (el.classList.contains('stream-wrap') || el.classList.contains('file-list') || el.classList.contains('artifact-cards')) { el = el.previousElementSibling; continue; }
    checked++;
    const rawText = el.textContent.trim();
    if (!rawText || rawText.length > 200) { el = el.previousElementSibling; continue; }
    const text = _stripLeadingDecorators(rawText);
    if (_looksLikeFilePath(text)) return false;
    for (const codeEl of el.querySelectorAll('code')) { if (_looksLikeFilePath(codeEl.textContent.trim())) return false; }
    const tag = el.tagName?.toLowerCase();
    const isHeading = ['h1','h2','h3','h4','h5','h6'].includes(tag);
    if ((isHeading || text.length <= 80) && _nonFileHeadingWords.test(text)) return true;
    if (text.length > 10) break;
    el = el.previousElementSibling;
  }
  return false;
}

function _isNonFileContent(code, lang) {
  if (!code) return false;
  const lo = (lang || '').toLowerCase();
  const lines = code.split('\n').filter(l => l.trim());
  const total = lines.length;
  if (total === 0) return false;

  if (code.includes('├') || code.includes('└') || code.includes('│')) return true;
  const asciiTreeLines = lines.filter(l => /^\s*[|`\\]\s*[├└│──|+\\\/\-]/.test(l));
  if (asciiTreeLines.length > total * 0.4 && total > 3) return true;

  if (['bash','sh','shell','zsh'].includes(lo)) {
    const commentLines = lines.filter(l => /^\s*#/.test(l));
    const stepComments = commentLines.filter(l => /^\s*#\s*\d+[.):]\s/i.test(l) || /^\s*#\s*(step|install|setup|clone|run|start|configure|create|build|deploy|seed|open|edit|copy|download|update|migrate|test|check)/i.test(l));
    if (stepComments.length >= 2) return true;
    if (commentLines.length > 0 && commentLines.length / total > 0.3 && total > 3) return true;
  }

  const httpLogLines = lines.filter(l => /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b\s+\d{3}\b/.test(l));
  if (httpLogLines.length >= 2) return true;
  const timestampLines = lines.filter(l => /^\s*\[?\d{1,4}[:\-/.]\d{2}[:\-/.]\d{2}/.test(l.trim()));
  if (timestampLines.length > total * 0.3 && total > 3) return true;
  const serverLines = lines.filter(l => /\b(listening\s+on|running\s+(at|on)|started\s+on|server\s+(is\s+)?running|waiting\s+for\s+requests)\b/i.test(l));
  if (serverLines.length >= 1 && total <= 20) return true;
  const urlLabelLines = lines.filter(l => /^\s*\w+:\s+https?:\/\//.test(l));
  if (urlLabelLines.length >= 2 && total <= 15) return true;

  // Only check plaintext indentation for ACTUAL plaintext, not code languages
  if (['text','txt','plaintext'].includes(lo) || lo === '') {
    // Skip this check if the code has programming-language-like content
    const codeIndicators = lines.filter(l =>
      /\b(const|let|var|function|class|import|export|require|return|if|for|while)\b/.test(l)
    );
    if (codeIndicators.length === 0) {
      const tabbedLines = lines.filter(l => /^\s{2,}\S/.test(l) || l.includes('\t'));
      if (tabbedLines.length > total * 0.4 && total > 5) return true;
    }

    const emojiLines = lines.filter(l => /[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}]/u.test(l));
    if (emojiLines.length > total * 0.3 && total > 3) return true;
  }
  return false;
}


// ═══════════════════════════════════════════════════════════════════════════
// _shouldBeFile — FIXED PRIORITY ORDER
//
// BEFORE: Content checks ran first → could reject files with identifiable names
// AFTER:  Filename checks run first → if we KNOW it's a file, skip heuristics
// ═══════════════════════════════════════════════════════════════════════════

function _shouldBeFile(code, lang, pre) {
  // PRIORITY 1: If code has a filename comment (// filename.js), it's ALWAYS a file
  if (_extractFilenameFromCode(code)) return true;

  // PRIORITY 2: If DOM heading has a clear filename, it's ALWAYS a file
  if (_extractFilenameFromDom(pre)) return true;

  // PRIORITY 3: Content-based rejection (only for blocks without known filenames)
  if (_isNonFileContent(code, lang)) return false;
  if (_isNonFileContext(pre)) return false;

  // PRIORITY 4: Line threshold for unnamed blocks
  if (code.split('\n').length < WRAP_THRESHOLD) return false;

  return true;
}


// ═══════════════════════════════════════════════════════════════════════════
// FILENAME EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

function _extractFilenameFromCode(code) {
  if (!code) return null;
  for (const line of code.split('\n').slice(0, 8)) {
    const t = line.trim(); if (!t) continue;
    const m = t.match(/^(?:\/\/|#|\/\*+|\*|--|;)\s*(?:[Ff]ile(?:name)?:?\s*)?(?:[^\s]*[/\\])?([a-zA-Z0-9_.][a-zA-Z0-9_.-]*\.[a-zA-Z0-9]{1,10})/);
    if (m && m[1].length >= 3 && m[1].length <= 60) return m[1];
  }
  return null;
}

function _extractFilenameFromDom(pre) {
  if (!pre) return null;
  let el = pre.previousElementSibling, checked = 0;
  while (el && checked < 2) {
    if (el.classList.contains('stream-wrap') || el.classList.contains('file-list') || el.classList.contains('artifact-cards')) { el = el.previousElementSibling; continue; }
    checked++;
    const rawText = el.textContent.trim();
    if (!rawText || rawText.length > 200) { el = el.previousElementSibling; continue; }
    const text = _stripLeadingDecorators(rawText);
    if (text.length <= 120) {
      // Path: src/config/database.js
      const pm = text.match(/(?:^|\s)((?:\.?\.?\/)?(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.][a-zA-Z0-9_.-]*\.[a-zA-Z]{1,10})\s*:?\s*$/);
      if (pm) { const f = pm[1].split('/').pop(); if (!_notFilenames.has(f.toLowerCase())) return f; }
      if (text.length <= 60) {
        // Dotfile: .env, .env.example
        const fm = text.match(/^[`*"']?(\.[a-zA-Z][a-zA-Z0-9_.-]*)[`*"':)]*\s*$/);
        if (fm && fm[1].length >= 4) return fm[1];
        // Regular: server.js, package.json
        const fm2 = text.match(/^[`*"']?([a-zA-Z0-9_][a-zA-Z0-9_.-]*\.[a-zA-Z]{1,10})[`*"':)]*\s*$/);
        if (fm2 && !_notFilenames.has(fm2[1].toLowerCase())) return fm2[1];
      }
    }
    // Check inline <code> — but skip CSS-like selectors (.class-name)
    for (const c of el.querySelectorAll('code')) {
      const ct = c.textContent.trim();
      if (ct.length >= 3 && ct.length <= 80) {
        // Skip CSS selectors and similar
        if (/^[.#]\w+[-\w]*$/.test(ct)) continue;
        if (ct.includes('[') && ct.includes(']')) continue;
        // Dotfile
        const dm = ct.match(/(?:.*\/)?(\.[a-zA-Z][a-zA-Z0-9_.-]*)$/);
        if (dm && dm[1].includes('.') && dm[1].length >= 4) return dm[1];
        // Regular file
        const m2 = ct.match(/(?:.*\/)?([a-zA-Z0-9_][a-zA-Z0-9_.-]*\.[a-zA-Z]{1,10})$/);
        if (m2 && !_notFilenames.has(m2[1].toLowerCase())) return m2[1];
      }
    }
    el = el.previousElementSibling;
  }
  return null;
}

function resolveFilename(code, lang, pre) { return _extractFilenameFromCode(code) || _extractFilenameFromDom(pre) || langToFilename(lang); }
function extractFilename(code, lang) { return _extractFilenameFromCode(code) || langToFilename(lang); }
function _hlHighlight(el) { if (!el) return; el.removeAttribute('data-highlighted'); try { hljs.highlightElement(el); } catch(e) {} }

function _copyText(text, btn) {
  const ok = () => { const o = btn.textContent; btn.textContent = '✓ Copied'; btn.classList.add('success'); setTimeout(() => { btn.textContent = o; btn.classList.remove('success'); }, 1500); };
  navigator.clipboard.writeText(text).then(ok).catch(() => { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;top:-9999px'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch(e) {} document.body.removeChild(ta); });
}

function _buildSimpleOverlay(lang, code) {
  const o = document.createElement('div'); o.className = 'code-simple-actions';
  const b = document.createElement('span'); b.className = 'code-simple-lang'; b.textContent = langLabel(lang);
  const c = document.createElement('button'); c.className = 'code-simple-copy'; c.textContent = 'Copy';
  c.addEventListener('click', e => { e.stopPropagation(); _copyText(code, c); });
  o.append(b, c); return o;
}

function _buildCodeHeader(lang, fname, lines) {
  const h = document.createElement('div'); h.className = 'code-header';
  const ls = document.createElement('span'); ls.className = 'code-lang'; ls.textContent = langLabel(lang); ls.dataset.lang = lang.toLowerCase();
  const fs = document.createElement('span'); fs.className = 'sw-fname'; fs.style.cssText = 'color:var(--text1);font-size:11px;margin-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;'; fs.textContent = fname;
  const lc = document.createElement('span'); lc.className = 'code-lines sw-lines'; lc.style.marginLeft = '6px'; lc.textContent = lines + ' line' + (lines !== 1 ? 's' : '');
  const a = document.createElement('div'); a.className = 'code-actions';
  const eb = document.createElement('button'); eb.className = 'code-btn'; eb.dataset.action = 'expand'; eb.textContent = '▾ Expand';
  const vb = document.createElement('button'); vb.className = 'code-btn'; vb.dataset.action = 'view'; vb.textContent = '⤢ View';
  const cb = document.createElement('button'); cb.className = 'code-btn'; cb.dataset.action = 'copy'; cb.textContent = 'Copy';
  const db = document.createElement('button'); db.className = 'code-btn'; db.dataset.action = 'download';
  db.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  a.append(eb, vb, cb, db); h.append(ls, fs, lc, a); return h;
}

function _buildShowMore(totalLines, maxH) {
  const v = _visibleLines(maxH), hid = Math.max(0, totalLines - v);
  const el = document.createElement('div'); el.className = 'code-showmore' + (hid <= 0 ? ' hidden' : '');
  const btn = document.createElement('button'); btn.className = 'code-showmore-btn'; btn.dataset.action = 'expand';
  btn.textContent = hid > 0 ? `▾ Show ${hid} more line${hid !== 1 ? 's' : ''}` : '';
  el.appendChild(btn); return el;
}

function _updateShowMore(wrap, totalLines, maxH, isExp) {
  const sm = wrap.querySelector('.code-showmore'), btn = wrap.querySelector('.code-showmore-btn');
  if (!sm || !btn) return;
  const hid = Math.max(0, totalLines - _visibleLines(maxH));
  btn.textContent = hid > 0 ? `▾ Show ${hid} more line${hid !== 1 ? 's' : ''}` : '';
  if (isExp) sm.classList.add('hidden'); else sm.classList.toggle('hidden', hid <= 0);
}

function _buildCodeFooter() {
  const f = document.createElement('div'); f.className = 'code-footer'; f.dataset.action = 'collapse';
  const b = document.createElement('button'); b.className = 'code-footer-btn'; b.textContent = '▴ Collapse';
  f.appendChild(b); return f;
}

function _getWrapInfo(wrap) {
  const code = wrap.querySelector('pre code')?.textContent || '';
  const lang = wrap.dataset.lang || 'text';
  return { code, lang, fname: wrap.dataset.fname || langToFilename(lang), msgId: wrap.dataset.msgid || null, blockIdx: parseInt(wrap.dataset.blockidx || '0') };
}

function _setExpanded(wrap, expanded) {
  const preWrap = wrap.querySelector('.code-pre-wrap');
  const fade = wrap.querySelector('.stream-code-fade');
  const footer = wrap.querySelector('.code-footer');
  const showMore = wrap.querySelector('.code-showmore');
  const expandBtn = wrap.querySelector('.code-btn[data-action="expand"]');
  const msgId = wrap.dataset.msgid, idx = wrap.dataset.blockidx || '0';
  const maxH = parseInt(wrap.dataset.maxh || '260');
  if (!preWrap) return;
  if (!_streamExpanded[msgId]) _streamExpanded[msgId] = {};
  _streamExpanded[msgId][idx] = expanded;
  if (expanded) {
    const streaming = _isMsgStreaming(msgId);
    preWrap.style.maxHeight = streaming ? '70vh' : 'none';
    preWrap.style.overflow = 'auto';
    if (fade) fade.style.display = 'none';
    if (showMore) showMore.classList.add('hidden');
    if (footer) footer.classList.add('visible');
    if (expandBtn) expandBtn.textContent = '▴ Collapse';
    requestAnimationFrame(() => { preWrap.scrollTop = preWrap.scrollHeight; });
  } else {
    preWrap.style.maxHeight = maxH + 'px';
    preWrap.style.overflow = 'hidden';
    if (fade) fade.style.display = '';
    if (expandBtn) expandBtn.textContent = '▾ Expand';
    if (footer) footer.classList.remove('visible');
    const code = wrap.querySelector('pre code')?.textContent || '';
    _updateShowMore(wrap, code.split('\n').length, maxH, false);
  }
}

function _toggleExpand(wrap) {
  const msgId = wrap.dataset.msgid, idx = wrap.dataset.blockidx || '0';
  _setExpanded(wrap, !(_streamExpanded[msgId]?.[idx] || false));
}

document.addEventListener('click', function(e) {
  const codeBtn = e.target.closest('.code-btn[data-action]');
  if (codeBtn) {
    e.stopPropagation();
    const wrap = codeBtn.closest('.stream-wrap'); if (!wrap) return;
    const info = _getWrapInfo(wrap);
    switch (codeBtn.dataset.action) {
      case 'expand': _toggleExpand(wrap); break;
      case 'view': openSidePanel(info.code, info.lang, info.fname, info.msgId ? { msgId: info.msgId, blockIdx: info.blockIdx } : null); break;
      case 'copy': _copyText(info.code, codeBtn); break;
      case 'download': downloadCode(info.code, info.lang, info.fname); break;
    }
    return;
  }
  const footer = e.target.closest('.code-footer[data-action="collapse"]');
  if (footer) { e.stopPropagation(); const w = footer.closest('.stream-wrap'); if (w) _setExpanded(w, false); return; }
  const sm = e.target.closest('.code-showmore');
  if (sm) { e.stopPropagation(); const w = sm.closest('.stream-wrap'); if (w) _setExpanded(w, true); return; }
}, true);


// ═══════════════════════════════════════════════════════════════════════════
// hlStreaming
// ═══════════════════════════════════════════════════════════════════════════
function hlStreaming(container, msgId, savedWraps) {
  if (!savedWraps) savedWraps = {};
  const pres = Array.from(container.querySelectorAll('pre'));
  pres.forEach((pre, idx) => {
    const codeEl = pre.querySelector('code');
    const lang = (codeEl?.className || '').replace('language-','').split(' ')[0] || 'text';
    const code = codeEl?.textContent || '';
    const lines = code.split('\n').length;
    const idxKey = String(idx);
    const maxH = 260;

    if (!_shouldBeFile(code, lang, pre)) {
      if (codeEl) _hlHighlight(codeEl);
      pre.style.position = 'relative';
      pre.querySelector('.code-simple-actions')?.remove();
      pre.appendChild(_buildSimpleOverlay(lang, code));
      return;
    }

    const existing = savedWraps[idxKey];
    if (existing) {
      existing.dataset.blockidx = idxKey; existing.dataset.msgid = msgId;
      const savedScrollTop = existing._savedScrollTop || 0;
      const wasAtBottom = existing._wasAtBottom !== undefined ? existing._wasAtBottom : true;
      const existCode = existing.querySelector('pre code');
      if (existCode && code && existCode.textContent !== code) {
        const sc = existCode.className; existCode.textContent = code; existCode.className = sc; _hlHighlight(existCode);
        const lc = existing.querySelector('.sw-lines');
        if (lc) lc.textContent = lines + ' line' + (lines !== 1 ? 's' : '');
        const fnSpan = existing.querySelector('.sw-fname');
        if (fnSpan) { const sn = _extractFilenameFromCode(code) || fnSpan.textContent; if (sn !== fnSpan.textContent) { fnSpan.textContent = sn; existing.dataset.fname = sn; } }
        _updateShowMore(existing, lines, maxH, _streamExpanded[msgId]?.[idxKey] || false);
      }
      const isExp = _streamExpanded[msgId]?.[idxKey] || false;
      const preWrap = existing.querySelector('.code-pre-wrap');
      const fade = existing.querySelector('.stream-code-fade');
      const ft = existing.querySelector('.code-footer');
      const sm2 = existing.querySelector('.code-showmore');
      const eb = existing.querySelector('.code-btn[data-action="expand"]');
      if (isExp && preWrap) {
        preWrap.style.maxHeight = _isMsgStreaming(msgId) ? '70vh' : 'none';
        preWrap.style.overflow = 'auto';
        if (fade) fade.style.display = 'none';
        if (sm2) sm2.classList.add('hidden');
        if (ft) ft.classList.add('visible');
        if (eb) eb.textContent = '▴ Collapse';
      }
      pre.replaceWith(existing);
      if (preWrap && isExp) { if (wasAtBottom) preWrap.scrollTop = preWrap.scrollHeight; else if (savedScrollTop > 0) preWrap.scrollTop = savedScrollTop; }
      delete existing._savedScrollTop; delete existing._wasAtBottom;
      return;
    }

    const fname = resolveFilename(code, lang, pre);
    if (codeEl) _hlHighlight(codeEl);
    const wrap = document.createElement('div');
    wrap.className = 'stream-wrap'; wrap.dataset.msgid = msgId; wrap.dataset.blockidx = idxKey;
    wrap.dataset.lang = lang; wrap.dataset.fname = fname; wrap.dataset.maxh = String(maxH);
    const hdr = _buildCodeHeader(lang, fname, lines);
    const showMore = _buildShowMore(lines, maxH);
    const footer2 = _buildCodeFooter();
    const preWrap = document.createElement('div'); preWrap.className = 'code-pre-wrap'; preWrap.style.maxHeight = maxH + 'px';
    const fade = document.createElement('div'); fade.className = 'stream-code-fade';
    pre.style.margin = pre.style.borderRadius = pre.style.border = '0';
    pre.replaceWith(wrap);
    preWrap.appendChild(pre); preWrap.appendChild(fade);
    wrap.appendChild(hdr); wrap.appendChild(preWrap); wrap.appendChild(showMore); wrap.appendChild(footer2);
    if (_streamExpanded[msgId]?.[idxKey]) _setExpanded(wrap, true);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// processCodeBlocks — finalized
// ═══════════════════════════════════════════════════════════════════════════
function processCodeBlocks(container) {
  Array.from(container.querySelectorAll('pre')).forEach((pre, idx) => {
    if (pre.closest('.stream-wrap')) return;
    const codeEl = pre.querySelector('code');
    const lang = (codeEl?.className || '').replace('language-','').split(' ')[0] || 'text';
    const code = codeEl?.textContent || '';
    const la = code.split('\n'), lines = (la[la.length-1]==='') ? la.length-1 : la.length;
    if (codeEl) _hlHighlight(codeEl);
    if (!_shouldBeFile(code, lang, pre)) {
      pre.style.position = 'relative'; pre.querySelector('.code-simple-actions')?.remove();
      pre.appendChild(_buildSimpleOverlay(lang, code)); return;
    }
    const fname = resolveFilename(code, lang, pre), maxH = 320, isLong = lines > _visibleLines(maxH);
    const wrap = document.createElement('div');
    wrap.className = 'stream-wrap'; wrap.dataset.blockidx = String(idx);
    wrap.dataset.lang = lang; wrap.dataset.fname = fname; wrap.dataset.maxh = String(maxH);
    const hdr = _buildCodeHeader(lang, fname, lines);
    const showMore = _buildShowMore(lines, maxH);
    const footer2 = _buildCodeFooter();
    const eb = hdr.querySelector('.code-btn[data-action="expand"]');
    const preWrap = document.createElement('div'); preWrap.className = 'code-pre-wrap';
    pre.style.margin = pre.style.borderRadius = pre.style.border = '0';
    pre.replaceWith(wrap); wrap.appendChild(hdr);
    if (isLong) {
      preWrap.style.maxHeight = maxH + 'px';
      const fade = document.createElement('div'); fade.className = 'stream-code-fade';
      preWrap.appendChild(pre); preWrap.appendChild(fade);
      wrap.appendChild(preWrap); wrap.appendChild(showMore);
      if (eb) eb.textContent = '▾ Expand';
    } else {
      preWrap.appendChild(pre); wrap.appendChild(preWrap);
      showMore.classList.add('hidden'); footer2.classList.add('visible');
      if (eb) eb.textContent = '▴ Collapse';
    }
    wrap.appendChild(footer2);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// buildFileList / extractArtifacts / buildArtifactCards
// ═══════════════════════════════════════════════════════════════════════════
function buildFileList(container) {
  const wraps = Array.from(container.querySelectorAll('.stream-wrap'));
  if (!wraps.length) return null;
  const files = wraps.map(w => {
    const code = w.querySelector('pre code')?.textContent || '', lang = w.dataset.lang || 'text';
    const fname = w.dataset.fname || resolveFilename(code, lang, null);
    const la = code.split('\n'), lines = (la[la.length-1]==='') ? la.length-1 : la.length;
    const bytes = new Blob([code]).size;
    return { code, lang, fname, lines, size: bytes < 1024 ? bytes+' B' : bytes < 1048576 ? (bytes/1024).toFixed(1)+' KB' : (bytes/1048576).toFixed(1)+' MB' };
  });
  const panel = document.createElement('div'); panel.className = 'file-list';
  const header = document.createElement('div'); header.className = 'file-list-header';
  const ts = document.createElement('span'); ts.className = 'fl-title';
  ts.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg> Files <span class="fl-badge">${files.length}</span>`;
  const da = document.createElement('button'); da.className = 'fl-download-all';
  da.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download all`;
  da.addEventListener('click', e => { e.stopPropagation(); files.forEach((f,i) => setTimeout(() => downloadCode(f.code, f.lang, f.fname), i*180)); });
  header.append(ts, da); panel.appendChild(header);
  const list = document.createElement('div'); list.className = 'file-list-items';
  files.forEach(f => {
    const item = document.createElement('div'); item.className = 'fl-item';
    const ic = document.createElement('div'); ic.className = 'fl-icon'; ic.textContent = langLabel(f.lang); ic.dataset.lang = f.lang.toLowerCase();
    const inf = document.createElement('div'); inf.className = 'fl-info';
    const nm = document.createElement('div'); nm.className = 'fl-name'; nm.textContent = f.fname;
    const mt = document.createElement('div'); mt.className = 'fl-meta';
    const lb = document.createElement('span'); lb.textContent = f.lang.toUpperCase();
    const lineb = document.createElement('span'); lineb.textContent = `${f.lines} line${f.lines!==1?'s':''}`;
    const sb = document.createElement('span'); sb.textContent = f.size;
    mt.append(lb, lineb, sb); inf.append(nm, mt);
    const dl = document.createElement('button'); dl.className = 'fl-download'; dl.textContent = 'Download';
    item.addEventListener('click', () => openSidePanel(f.code, f.lang, f.fname, null));
    dl.addEventListener('click', e => { e.stopPropagation(); downloadCode(f.code, f.lang, f.fname); });
    item.append(ic, inf, dl); list.appendChild(item);
  });
  panel.appendChild(list); return panel;
}

function extractArtifacts(text) {
  const arts = [], re = /```(\w*)\n([\s\S]*?)```/g; let m;
  while ((m = re.exec(text)) !== null) { arts.push({ lang: m[1]||'text', code: m[2], filename: resolveFilename(m[2], m[1]||'text', null) }); }
  return arts;
}

function buildArtifactCards(arts) {
  const wrap = document.createElement('div'); wrap.className = 'artifact-cards';
  arts.forEach(a => {
    const card = document.createElement('div'); card.className = 'artifact-card';
    card.innerHTML = `<div class="artifact-card-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg></div><div class="artifact-card-info"><div class="artifact-card-name">${esc(a.filename)}</div><div class="artifact-card-meta">${esc(a.lang.toUpperCase())} · ${a.code.split('\n').length} lines</div></div>`;
    card.addEventListener('click', () => openSidePanel(a.code, a.lang, a.filename, null));
    const dl = document.createElement('button'); dl.className = 'artifact-card-download'; dl.textContent = 'Download';
    dl.addEventListener('click', e => { e.stopPropagation(); downloadCode(a.code, a.lang, a.filename); });
    card.appendChild(dl); wrap.appendChild(card);
  });
  return wrap;
}
