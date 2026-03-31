// public/js/utils.js — FULL REPLACEMENT

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderMd(text) {
  return text ? marked.parse(text, { breaks:true, gfm:true }) : '';
}

function tokStr(n) {
  return n >= 1000 ? (n/1000).toFixed(n%1000===0?0:1)+'k' : String(n);
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes+'B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1)+'KB';
  return (bytes/1048576).toFixed(1)+'MB';
}

function fmtTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
}

function langToFilename(lang) {
  const m = {
    javascript:'code.js',js:'code.js',typescript:'code.ts',ts:'code.ts',
    python:'code.py',py:'code.py',bash:'script.sh',shell:'script.sh',
    sh:'script.sh',html:'index.html',css:'style.css',json:'data.json',
    yaml:'config.yaml',yml:'config.yml',rust:'code.rs',go:'code.go',
    java:'Code.java',cpp:'code.cpp',c:'code.c',ruby:'code.rb',
    sql:'query.sql',markdown:'doc.md',md:'doc.md',xml:'data.xml',
  };
  return m[lang?.toLowerCase()] || 'code.txt';
}

function downloadCode(code, lang, filename) {
  downloadBlob(new Blob([code],{type:'text/plain'}), filename||langToFilename(lang));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// ─── Token & cost recording — delegates to budget.js ───────────────────────
function recordTokenUsage(inputTokens, outputTokens) {
  if (typeof recordCost === 'function') {
    recordCost(inputTokens || 0, outputTokens || 0, currentModelId);
  }
  if (typeof updateBudgetDisplay === 'function') {
    updateBudgetDisplay();
  }
}

function updateTokenDisplay() {
  if (typeof updateBudgetDisplay === 'function') {
    updateBudgetDisplay();
  }
}

let _toastTimer = null;
function toast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast'+(type?' '+type:'');
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(()=>t.classList.remove('show'),3200);
}

function playSound() {
  try {
    const ctx = new(window.AudioContext||window.webkitAudioContext)();
    const t = ctx.currentTime;
    [[880,0,0.15],[1100,0.12,0.25]].forEach(([f,s,e])=>{
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.type='sine';o.frequency.setValueAtTime(f,t+s);
      g.gain.setValueAtTime(0,t+s);
      g.gain.linearRampToValueAtTime(0.15,t+s+0.02);
      g.gain.exponentialRampToValueAtTime(0.001,t+e);
      o.connect(g);g.connect(ctx.destination);o.start(t+s);o.stop(t+e);
    });
    setTimeout(()=>ctx.close(),600);
  } catch(e){}
}

function sendNotif(title,body,convoId) {
  if (!('Notification' in window)||Notification.permission!=='granted') return;
  const n=new Notification(title,{body});
  n.onclick=()=>{window.focus();if(convoId)loadConvo(convoId);n.close();};
  setTimeout(()=>n.close(),8000);
}

function encodeUTF8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodeBase64UTF8(b64) {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch(e) {
    try { return atob(b64); } catch(e2) { return '(unable to decode)'; }
  }
}

let _pasteViewerContent = '';

function openPasteViewer(title, text, meta) {
  _pasteViewerContent = text;
  document.getElementById('pasteModalTitle').textContent = title;
  document.getElementById('pasteModalMeta').textContent = meta || '';
  document.getElementById('pasteModalContent').textContent = text;
  const btn = document.getElementById('pasteModalCopyBtn');
  if (btn) { btn.textContent = 'Copy'; btn.classList.remove('success'); }
  document.getElementById('pasteModal').classList.add('open');
}

function closePasteViewer() {
  document.getElementById('pasteModal').classList.remove('open');
}

function handlePasteModalClick(e) {
  if (e.target === document.getElementById('pasteModal')) closePasteViewer();
}

function copyPasteContent() {
  navigator.clipboard.writeText(_pasteViewerContent).then(() => {
    const btn = document.getElementById('pasteModalCopyBtn');
    if (btn) { btn.textContent = '✓ Copied!'; btn.classList.add('success'); setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('success'); }, 2000); }
  });
}
