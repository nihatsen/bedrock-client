// public/js/settings.js — FULL REPLACEMENT

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS — Load, save, open, close modal
// ═══════════════════════════════════════════════════════════════════════════

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
  closeSettings();
  toast('Settings saved', 'success');

  // Reload model list if credentials changed
  const credChanged = prev.apiKey !== settings.apiKey || prev.region !== settings.region;
  if (credChanged) loadModels();
}
