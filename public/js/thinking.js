// public/js/thinking.js — FULL REPLACEMENT

function toggleThinking() {
  thinkingOn = !thinkingOn;
  localStorage.setItem('brc_thinking_on', String(thinkingOn));
  document.getElementById('thinkingToggle').classList.toggle('active', thinkingOn);
  document.getElementById('budgetWrap').classList.toggle('hidden', !thinkingOn);
}

function updateBudgetLabel() {
  thinkingBudget = parseInt(document.getElementById('budgetSlider').value);
  localStorage.setItem('brc_thinking_budget', String(thinkingBudget));
  document.getElementById('budgetLabel').textContent = tokStr(thinkingBudget);
}

function applyThinkingState() {
  const toggle = document.getElementById('thinkingToggle');
  const budgetWrap = document.getElementById('budgetWrap');
  const slider = document.getElementById('budgetSlider');
  const label = document.getElementById('budgetLabel');
  if (!toggle || !slider || !label) return;

  toggle.classList.toggle('active', thinkingOn);
  budgetWrap.classList.toggle('hidden', !thinkingOn);

  const sel = document.getElementById('modelSelect');
  const opt = sel?.selectedOptions[0];
  const maxOut = parseInt(opt?.dataset.maxOutputTokens || slider.max || '32000');

  slider.max = maxOut;
  thinkingBudget = Math.max(1024, Math.min(thinkingBudget, maxOut));
  slider.value = thinkingBudget;
  label.textContent = tokStr(thinkingBudget);
}

function onModelChange() {
  const sel = document.getElementById('modelSelect');
  const opt = sel?.selectedOptions[0];
  const supports = opt?.dataset.supportsThinking === 'true';
  const newMax = parseInt(opt?.dataset.maxOutputTokens || '32000');

  const rawName = opt?.textContent || 'Assistant';
  currentModelName = rawName.replace(/\s*\(.*?\)\s*$/, '').trim();
  document.title = `Bedrock · ${currentModelName}`;
  const emptyTitle = document.querySelector('.empty-title');
  if (emptyTitle) emptyTitle.textContent = `Bedrock · ${currentModelName}`;

  const toggle = document.getElementById('thinkingToggle');
  if (toggle) {
    toggle.style.opacity = supports ? '1' : '0.4';
    toggle.style.pointerEvents = supports ? '' : 'none';
    if (!supports && thinkingOn) {
      thinkingOn = false;
      localStorage.setItem('brc_thinking_on', 'false');
      toggle.classList.remove('active');
      document.getElementById('budgetWrap')?.classList.add('hidden');
    }
  }

  const slider = document.getElementById('budgetSlider');
  if (slider) {
    const oldMax = parseInt(slider.max || '32000');
    const wasAtMax = thinkingBudget >= oldMax - 1024;
    slider.max = newMax;
    if (wasAtMax && newMax !== oldMax) {
      thinkingBudget = newMax;
    } else {
      thinkingBudget = Math.max(1024, Math.min(thinkingBudget, newMax));
    }
    slider.value = thinkingBudget;
    localStorage.setItem('brc_thinking_budget', String(thinkingBudget));
    const label = document.getElementById('budgetLabel');
    if (label) label.textContent = tokStr(thinkingBudget);
  }

  if (sel?.value) {
    settings.modelId = sel.value;
    localStorage.setItem('brc_settings', JSON.stringify(settings));
  }
}

// ─── Extract a short topic preview from thinking text ─────────────────────
function _getThinkingTopic(text) {
  if (!text) return '';
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip very short lines, lines that are just punctuation/symbols
    if (trimmed.length > 8 && /[a-zA-Z]/.test(trimmed)) {
      // Truncate to ~60 chars
      return trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed;
    }
  }
  return '';
}

function buildThinkingBlock(text, streaming = false, budget = 0) {
  const tb = document.createElement('div');
  tb.className = 'thinking-block collapsed';

  // ── Header ───────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'thinking-header';

  const iconEl = document.createElement('div');
  iconEl.className = streaming ? 'thinking-spinner' : 'thinking-dot';

  // Header text wrapper (two lines: status + topic)
  const textWrap = document.createElement('div');
  textWrap.style.cssText = 'flex:1;min-width:0;overflow:hidden;';

  const statusLine = document.createElement('div');
  statusLine.className = 'thinking-header-text';

  const topicLine = document.createElement('div');
  topicLine.className = 'thinking-topic';

  if (streaming) {
    const est = text ? Math.round(text.length / 4) : 0;
    const budgetStr = budget > 0 ? ` / ${tokStr(budget)}` : '';
    statusLine.textContent = `THINKING… — ~${tokStr(est)}${budgetStr} tokens`;
    const topic = _getThinkingTopic(text);
    topicLine.textContent = topic;
    topicLine.style.display = topic ? '' : 'none';
  } else {
    const est = text ? Math.round(text.length / 4) : 0;
    statusLine.textContent = `REASONING — ${tokStr(est)} est. tokens`;
    const topic = _getThinkingTopic(text);
    topicLine.textContent = topic;
    topicLine.style.display = topic ? '' : 'none';
  }

  textWrap.appendChild(statusLine);
  textWrap.appendChild(topicLine);

  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('class', 'thinking-chevron');
  chevron.setAttribute('width', '12');
  chevron.setAttribute('height', '12');
  chevron.setAttribute('viewBox', '0 0 24 24');
  chevron.setAttribute('fill', 'none');
  chevron.setAttribute('stroke', 'currentColor');
  chevron.setAttribute('stroke-width', '2.5');
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', '6 9 12 15 18 9');
  chevron.appendChild(polyline);

  header.appendChild(iconEl);
  header.appendChild(textWrap);
  header.appendChild(chevron);
  header.onclick = () => tb.classList.toggle('collapsed');

  // ── Content wrap — contains progress, content, AND footer ─────────────
  // All three collapse together via the max-height transition
  const contentWrap = document.createElement('div');
  contentWrap.className = 'thinking-content-wrap';

  if (streaming && budget > 0) {
    const prog = document.createElement('div');
    prog.className = 'thinking-progress';
    prog.innerHTML = `
      <div class="thinking-progress-bar">
        <div class="thinking-progress-fill" style="width:0%"></div>
      </div>
      <span class="thinking-progress-label">0 / ${tokStr(budget)} tokens</span>`;
    contentWrap.appendChild(prog);
  }

  const content = document.createElement('div');
  content.className = 'thinking-content';
  if (streaming) {
    content.appendChild(document.createTextNode(text || ''));
    const cur = document.createElement('span');
    cur.className = 'thinking-cursor';
    content.appendChild(cur);
  } else {
    content.textContent = text || '';
  }
  contentWrap.appendChild(content);

  // Footer is INSIDE contentWrap so it collapses with the content
  const footer = document.createElement('div');
  footer.className = 'thinking-footer';
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'thinking-collapse-btn';
  collapseBtn.textContent = '▴ Collapse reasoning';
  collapseBtn.onclick = (e) => { e.stopPropagation(); tb.classList.add('collapsed'); };
  footer.appendChild(collapseBtn);
  contentWrap.appendChild(footer);

  tb.appendChild(header);
  tb.appendChild(contentWrap);
  return tb;
}
