// public/js/settings.js — FULL REPLACEMENT

function syncSettingsForm() {
  const el = id => document.getElementById(id);
  if (el('settingsApiKey'))    el('settingsApiKey').value    = settings.apiKey      || '';
  if (el('settingsRegion'))    el('settingsRegion').value    = settings.region      || 'us-east-1';
  if (el('settingsMaxTokens')) el('settingsMaxTokens').value = settings.maxTokens   || 16000;
  if (el('settingsSystem'))    el('settingsSystem').value    = settings.system      || '';
  if (el('settingsTemp')) {
    el('settingsTemp').value = settings.temperature || 0.7;
    const tv = document.getElementById('tempVal');
    if (tv) tv.textContent = settings.temperature || 0.7;
  }

  // Budget settings
  const limits = getBudgetLimits();
  if (el('budgetEnabled'))       el('budgetEnabled').checked   = limits.enabled;
  if (el('budgetDailyUSD'))      el('budgetDailyUSD').value    = limits.dailyUSD || '';
  if (el('budgetOverallUSD'))    el('budgetOverallUSD').value  = limits.overallUSD || '';
  if (el('budgetDailyTokens'))   el('budgetDailyTokens').value = limits.dailyTokens ? (limits.dailyTokens / 1000) : '';
  if (el('budgetOverallTokens')) el('budgetOverallTokens').value = limits.overallTokens ? (limits.overallTokens / 1000) : '';

  _updateBudgetFieldsVis();
  _updateBudgetStatsPanel();
}

function _updateBudgetFieldsVis() {
  const enabled = document.getElementById('budgetEnabled')?.checked;
  const fields  = document.getElementById('budgetFields');
  if (fields) fields.style.display = enabled ? '' : 'none';
}

function _updateBudgetStatsPanel() {
  const el = document.getElementById('budgetStatsDisplay');
  if (!el) return;
  const stats = getCostStats();
  const td = stats.today;
  const tt = stats.total;
  el.innerHTML =
    `<div><span class="stat-label">Today:</span> <span class="stat-value">${tokStr(td.inputTokens + td.outputTokens)} tok</span> · <span class="stat-cost">${formatUSD(td.cost)}</span> (${td.requests} req)</div>` +
    `<div><span class="stat-label">All time:</span> <span class="stat-value">${tokStr(tt.inputTokens + tt.outputTokens)} tok</span> · <span class="stat-cost">${formatUSD(tt.cost)}</span> (${tt.requests} req)</div>`;
}

function openSettings() {
  syncSettingsForm();
  document.getElementById('settingsModal').classList.add('open');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

function handleSettingsOverlayClick(e) {
  if (e.target === document.getElementById('settingsModal')) closeSettings();
}

function saveSettings() {
  const prev = { apiKey: settings.apiKey, region: settings.region };

  settings.apiKey      = document.getElementById('settingsApiKey')?.value.trim()         || '';
  settings.region      = document.getElementById('settingsRegion')?.value.trim()         || 'us-east-1';
  settings.maxTokens   = parseInt(document.getElementById('settingsMaxTokens')?.value)   || 16000;
  settings.system      = document.getElementById('settingsSystem')?.value.trim()         || '';
  settings.temperature = parseFloat(document.getElementById('settingsTemp')?.value       || 0.7);

  localStorage.setItem('brc_settings', JSON.stringify(settings));

  // Save budget
  const budgetLimits = {
    enabled:       document.getElementById('budgetEnabled')?.checked || false,
    dailyUSD:      parseFloat(document.getElementById('budgetDailyUSD')?.value) || 0,
    overallUSD:    parseFloat(document.getElementById('budgetOverallUSD')?.value) || 0,
    dailyTokens:   (parseFloat(document.getElementById('budgetDailyTokens')?.value) || 0) * 1000,
    overallTokens: (parseFloat(document.getElementById('budgetOverallTokens')?.value) || 0) * 1000,
  };
  saveBudgetLimits(budgetLimits);

  closeSettings();
  toast('Settings saved', 'success');

  const credChanged = prev.apiKey !== settings.apiKey || prev.region !== settings.region;
  if (credChanged) loadModels();
}
