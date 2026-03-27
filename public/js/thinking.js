// public/js/thinking.js — FULL REPLACEMENT

function toggleThinking() {
  thinkingOn = !thinkingOn;
  localStorage.setItem('brc_thinking_on', thinkingOn);
  document.getElementById('thinkingToggle').classList.toggle('active', thinkingOn);
  document.getElementById('budgetWrap').classList.toggle('hidden', !thinkingOn);
}

function updateBudgetLabel() {
  thinkingBudget = parseInt(document.getElementById('budgetSlider').value);
  localStorage.setItem('brc_thinking_budget', thinkingBudget);
  document.getElementById('budgetLabel').textContent = tokStr(thinkingBudget);
}

function applyThinkingState() {
  document.getElementById('thinkingToggle').classList.toggle('active', thinkingOn);
  document.getElementById('budgetWrap').classList.toggle('hidden', !thinkingOn);
  const slider = document.getElementById('budgetSlider');
  slider.value = thinkingBudget;
  document.getElementById('budgetLabel').textContent = tokStr(thinkingBudget);
}

function onModelChange() {
  const sel = document.getElementById('modelSelect');
  const opt = sel.selectedOptions[0];
  const supports = opt?.dataset.supportsThinking === 'true';
  const newMax = parseInt(opt?.dataset.maxOutputTokens || '32000');

  const rawName = opt?.textContent || 'Assistant';
  currentModelName = rawName.replace(/\s*\(.*?\)\s*$/, '').trim();
  document.title = `Bedrock · ${currentModelName}`;
  const emptyTitle = document.querySelector('.empty-title');
  if (emptyTitle) emptyTitle.textContent = `Bedrock · ${currentModelName}`;

  const toggle = document.getElementById('thinkingToggle');
  toggle.style.opacity = supports ? '1' : '0.4';
  toggle.style.pointerEvents = supports ? '' : 'none';
  if (!supports && thinkingOn) {
    thinkingOn = false;
    localStorage.setItem('brc_thinking_on', false);
    toggle.classList.remove('active');
    document.getElementById('budgetWrap').classList.add('hidden');
  }

  // ── Budget auto-scale ──────────────────────────────────────────────
  // If budget was at the max of the old model, scale to new max.
  // Otherwise keep current value clamped to new range.
  const slider = document.getElementById('budgetSlider');
  const oldMax = parseInt(slider.max || '32000');
  const oldBudget = thinkingBudget;
  const wasAtMax = oldBudget >= oldMax - 1024; // within 1 step of max

  slider.max = newMax;

  if (wasAtMax && newMax !== oldMax) {
    // Was at max → set to new max
    thinkingBudget = newMax;
  } else {
    // Keep current value, clamped
    thinkingBudget = Math.max(1024, Math.min(thinkingBudget, newMax));
  }

  slider.value = thinkingBudget;
  localStorage.setItem('brc_thinking_budget', thinkingBudget);
  document.getElementById('budgetLabel').textContent = tokStr(thinkingBudget);

  settings.modelId = sel.value;
  localStorage.setItem('brc_settings', JSON.stringify(settings));
}

function buildThinkingBlock(text, streaming = false, budget = 0) {
  const tb = document.createElement('div');
  tb.className = 'thinking-block collapsed';

  const header = document.createElement('div');
  header.className = 'thinking-header';

  if (streaming) {
    const est = text ? Math.round(text.length / 4) : 0;
    const budgetStr = budget > 0 ? ` / ${tokStr(budget)}` : '';
    header.innerHTML = `
      <div class="thinking-spinner"></div>
      <span class="thinking-header-text" style="flex:1">THINKING… — ~${tokStr(est)}${budgetStr} tokens</span>
      <svg class="thinking-chevron" width="12" height="12" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
  } else {
    const est = text ? Math.round(text.length / 4) : 0;
    header.innerHTML = `
      <div class="thinking-dot"></div>
      <span class="thinking-header-text" style="flex:1">REASONING — ${tokStr(est)} est. tokens</span>
      <svg class="thinking-chevron" width="12" height="12" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
  }
  header.onclick = () => tb.classList.toggle('collapsed');

  const contentWrap = document.createElement('div');
  contentWrap.className = 'thinking-content-wrap';

  if (streaming && budget > 0) {
    const prog = document.createElement('div');
    prog.className = 'thinking-progress';
    prog.innerHTML = `
      <div class="thinking-progress-bar"><div class="thinking-progress-fill" style="width:0%"></div></div>
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

  const footer = document.createElement('div');
  footer.className = 'thinking-footer';
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'thinking-collapse-btn';
  collapseBtn.textContent = '▴ Collapse reasoning';
  collapseBtn.onclick = (e) => { e.stopPropagation(); tb.classList.add('collapsed'); };
  footer.appendChild(collapseBtn);

  tb.appendChild(header);
  tb.appendChild(contentWrap);
  tb.appendChild(footer);
  return tb;
}
