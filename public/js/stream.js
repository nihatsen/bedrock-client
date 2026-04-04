// public/js/stream.js — FULL REPLACEMENT

const _renderTimers = {};
let _interactionPause = false;
let _interactionResumeTimer = null;
let _pendingRender = null;

const _pauseSelector = '.code-btn, .code-footer, .code-showmore, .code-showmore-btn';

function _pauseRendering() { _interactionPause = true; clearTimeout(_interactionResumeTimer); }
function _resumeRendering() {
  clearTimeout(_interactionResumeTimer);
  _interactionResumeTimer = setTimeout(() => {
    _interactionPause = false;
    if (_pendingRender) {
      const { msgId, convoId, msg } = _pendingRender;
      _pendingRender = null;
      if (currentConvoId === convoId) _doRender(msgId, msg);
    }
  }, 400);
}

document.addEventListener('pointerenter', e => { if (e.target.closest?.(_pauseSelector)) _pauseRendering(); }, true);
document.addEventListener('pointerleave', e => { if (e.target.closest?.(_pauseSelector)) _resumeRendering(); }, true);
document.addEventListener('touchstart',   e => { if (e.target.closest?.(_pauseSelector)) _pauseRendering(); }, { passive:true, capture:true });
document.addEventListener('touchend',     e => { if (e.target.closest?.(_pauseSelector)) _resumeRendering(); }, { passive:true, capture:true });

function _collectSavedWraps(t) {
  const out = {};
  t.querySelectorAll('.stream-wrap').forEach(w => {
    const k = w.dataset.blockidx;
    if (k !== undefined) {
      const pw = w.querySelector('.code-pre-wrap');
      if (pw) {
        w._savedScrollTop = pw.scrollTop;
        w._wasAtBottom = (pw.scrollHeight - pw.scrollTop - pw.clientHeight) < 15;
      }
      out[k] = w;
    }
    w.remove();
  });
  return out;
}

function _isAtBottom(el) {
  return !el || (el.scrollHeight - el.scrollTop - el.clientHeight) < 10;
}

function _smartScrollRestore(w, saved, atBottom) {
  if (!w) return;
  if (atBottom) w.scrollTop = w.scrollHeight;
  else if (Math.abs(w.scrollTop - saved) > 5) w.scrollTop = saved;
}

function _scheduleRender(msgId, convoId, msg) {
  if (_renderTimers[msgId]) return;
  _renderTimers[msgId] = setTimeout(() => {
    delete _renderTimers[msgId];
    if (currentConvoId !== convoId) return;
    if (_interactionPause) { _pendingRender = { msgId, convoId, msg }; return; }
    requestAnimationFrame(() => _doRender(msgId, msg));
  }, 250);
}

function _doRender(msgId, msg) {
  const row = document.querySelector(`[data-msg-id="${msgId}"]`); if (!row) return;
  if (!row.classList.contains('streaming')) return;

  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    const mw = document.getElementById('messagesWrap');
    if (mw && sel.anchorNode && mw.contains(sel.anchorNode)) return;
  }

  const t   = row.querySelector('.msg-text'); if (!t) return;
  const mw  = document.getElementById('messagesWrap');
  const st  = mw ? mw.scrollTop : 0;
  const bot = _isAtBottom(mw);

  const saved = _collectSavedWraps(t);
  t.querySelector('.stream-indicator')?.remove();
  t.innerHTML = renderMd(msg.text);
  hlStreaming(t, msgId, saved);
  updateLiveSidePanel(t, msgId);

  const ind = document.createElement('div'); ind.className = 'stream-indicator';
  ind.innerHTML = '<span class="stream-spinner-sm"></span><span class="stream-cursor"></span>';
  t.appendChild(ind);

  _smartScrollRestore(mw, st, bot);
}

function _flushRender(msgId, msg) {
  if (_renderTimers[msgId]) { clearTimeout(_renderTimers[msgId]); delete _renderTimers[msgId]; }
  _interactionPause = false; _pendingRender = null;
  const row = document.querySelector(`[data-msg-id="${msgId}"]`); if (!row) return;
  const t   = row.querySelector('.msg-text'); if (!t) return;
  const mw  = document.getElementById('messagesWrap');
  const st  = mw ? mw.scrollTop : 0;
  const bot = _isAtBottom(mw);
  const saved = _collectSavedWraps(t);
  t.querySelector('.stream-indicator')?.remove();
  t.innerHTML = renderMd(msg.text);
  hlStreaming(t, msgId, saved);
  updateLiveSidePanel(t, msgId);
  _smartScrollRestore(mw, st, bot);
}

function scrollBottomNow() {
  const w = document.getElementById('messagesWrap');
  if (w) w.scrollTop = w.scrollHeight;
}

let _notifRequested = false;
function _requestNotifPermission() {
  if (_notifRequested) return; _notifRequested = true;
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

function _isRateLimitError(m) {
  if (!m) return false; const lo = m.toLowerCase();
  return lo.includes('too many tokens') || lo.includes('throttl') || lo.includes('rate limit') ||
    lo.includes('rate exceeded') || lo.includes('too many requests') || lo.includes('please wait') ||
    lo.includes('serviceunav') || (lo.includes('modelerror') && lo.includes('capacity'));
}

function _suggestModelSwitch() {
  const sel = document.getElementById('modelSelect'); const id = sel?.value || '';
  let s = '';
  if (id.startsWith('global.')) {
    const o = sel?.querySelector(`option[value="${id.replace('global.','us.')}"]`);
    if (o) s = `Try "${o.textContent}" — separate quota`;
  } else if (id.startsWith('us.')) {
    const o = sel?.querySelector(`option[value="${id.replace('us.','global.')}"]`);
    if (o) s = `Try "${o.textContent}" — separate quota`;
  }
  toast(s ? `💡 ${s}` : '💡 Try Global ↔ US variant — each has its own token quota', 'info');
}

function _showBudgetWarning(msg, isBlock) {
  _dismissBudgetWarning();
  const banner = document.createElement('div');
  banner.id = 'budgetWarningBanner';
  banner.className = 'budget-warning ' + (isBlock ? 'block' : 'warn');
  banner.innerHTML = esc(msg) + '<button class="dismiss-btn" onclick="_dismissBudgetWarning()">✕</button>';
  document.body.appendChild(banner);
  if (!isBlock) setTimeout(_dismissBudgetWarning, 8000);
}

function _dismissBudgetWarning() {
  document.getElementById('budgetWarningBanner')?.remove();
}

// ═══════════════════════════════════════════════════════════════════════════
// PUTER MESSAGE BUILDER — converts our message format to Puter's format
// ═══════════════════════════════════════════════════════════════════════════
function _buildPuterMessages(apiMsgs) {
  const puterMessages = [];

  // System prompt
  if (settings.system) {
    puterMessages.push({ role: 'system', content: settings.system });
  }

  for (const m of apiMsgs) {
    let content = m.text || '';

    // Inline file content as text (Kimi via Puter is text-only)
    if (m.files?.length) {
      for (const f of m.files) {
        if (!f.data) continue;
        if (f.type === 'image') {
          content += `\n[Image: ${f.name} — image input not supported with this model]`;
        } else {
          try {
            const decoded = typeof decodeBase64UTF8 === 'function'
              ? decodeBase64UTF8(f.data)
              : atob(f.data);
            content += `\n\n[File: ${f.name}]\n\`\`\`\n${decoded}\n\`\`\``;
          } catch (_e) {
            content += `\n[File: ${f.name} — could not decode]`;
          }
        }
      }
    }

    if (content.trim()) {
      puterMessages.push({ role: m.role, content: content.trim() });
    }
  }

  // Merge consecutive same-role messages
  const merged = [];
  for (const m of puterMessages) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === m.role) {
      prev.content += '\n\n' + m.content;
    } else {
      merged.push({ ...m });
    }
  }

  return merged;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUTER STREAM — runs Kimi models client-side via puter.ai.chat()
// ═══════════════════════════════════════════════════════════════════════════
async function runPuterStream(convoId) {
  const convo = getConvo(convoId);
  if (!convo) return;

  const opt      = document.getElementById('modelSelect').selectedOptions[0];
  const modelId  = opt?.value;
  const modelMax = parseInt(opt?.dataset.maxOutputTokens || '8192');

  currentModelId = modelId;

  const aMsg = {
    id: (Date.now() + 1).toString(),
    role: 'assistant',
    text: '',
    thinking: null,
    _thinkingBudget: 0,
    createdAt: Date.now(),
    modelName: currentModelName || 'Kimi',
    _modelId: modelId,
  };
  convo.messages.push(aMsg);
  saveConvos();

  if (currentConvoId === convoId) {
    appendMsgEl(aMsg, true);
    scrollBottomNow();
  }

  setStreamingUI(true);
  renderChatList();

  const ac = new AbortController();
  streamRegistry.set(convoId, { abortController: ac, assistantMsgId: aMsg.id });

  // Context optimization (same as Bedrock path)
  const { messages: apiMsgs, stats: ctxStats } = prepareMessagesForSend(
    convo.messages.slice(0, -1)  // exclude the empty assistant placeholder
  );

  if (ctxStats && ctxStats.savedTokenEst > 0) {
    console.log(
      `[puter-context] Optimized: ~${tokStr(ctxStats.savedTokenEst)} tokens saved (${ctxStats.savedPct}%)`
    );
  }

  const puterMessages = _buildPuterMessages(apiMsgs);

  console.log(`[puter-stream] model=${modelId} msgs=${puterMessages.length}`);

  const saveInterval = setInterval(() => saveConvos(), 2000);

  try {
    // Check Puter.js availability
    if (typeof puter === 'undefined' || !puter?.ai?.chat) {
      throw new Error('Puter.js is still loading. Please wait a moment and try again.');
    }

    const response = await puter.ai.chat(puterMessages, {
      model: modelId,
      stream: true,
    });

    let totalOutputChars = 0;

    // Handle streaming response (async iterator)
    if (response && typeof response[Symbol.asyncIterator] === 'function') {
      for await (const part of response) {
        if (ac.signal.aborted) break;

        if (part?.text) {
          aMsg.text += part.text;
          totalOutputChars += part.text.length;

          if (currentConvoId === convoId) {
            _scheduleRender(aMsg.id, convoId, aMsg);
          }
          if (currentConvoId === convoId && !userScrolledUp) {
            scrollBottomNow();
          }
        }
      }
    } else {
      // Non-streaming fallback
      const text = typeof response === 'string'
        ? response
        : response?.message?.content || response?.text || String(response || '');
      aMsg.text = text;
      totalOutputChars = text.length;
    }

    if (!ac.signal.aborted) {
      aMsg.stopReason = 'end_turn';

      // Estimate token usage (Puter doesn't provide exact counts)
      const inputText = puterMessages.map(m => m.content).join(' ');
      const estInputTokens  = Math.ceil(inputText.length / 3.8);
      const estOutputTokens = Math.ceil(totalOutputChars / 3.8);
      aMsg.usage = {
        inputTokens:  estInputTokens,
        outputTokens: estOutputTokens,
      };

      // Record usage for budget tracking (cost will be $0 for Kimi)
      recordTokenUsage(estInputTokens, estOutputTokens);
    }

  } catch (e) {
    if (e.name !== 'AbortError' && !ac.signal.aborted) {
      aMsg._error = e.message || 'Puter API error';
      toast('Kimi error: ' + aMsg._error, 'error');
    }
  }

  clearInterval(saveInterval);
  streamRegistry.delete(convoId);

  if (currentConvoId === convoId) {
    try {
      _flushRender(aMsg.id, aMsg);
      finalizeMsgEl(aMsg);
      if (!userScrolledUp) scrollBottomNow();
      if (!aMsg._error) {
        let costStr = '';
        if (aMsg.usage) {
          const cost = calculateCost(aMsg.usage.inputTokens || 0, aMsg.usage.outputTokens || 0, aMsg._modelId || modelId);
          costStr = cost.totalCost > 0 ? ` · ${formatUSD(cost.totalCost)}` : ' · Free';
        }
        const u = aMsg.usage ? ` · ${aMsg.usage.outputTokens || 0} tokens` : '';
        toast(`✓ Complete${u}${costStr}`, 'success');
        playSound();
        if (document.hidden) sendNotif('◈ Reply ready', aMsg.text.slice(0, 100));
      }
    } catch (err) {
      console.error('[puter-stream] Finalize:', err);
    } finally {
      setStreamingUI(false);
    }
  } else {
    try { const r = document.querySelector(`[data-msg-id="${aMsg.id}"]`); if (r) finalizeMsgEl(aMsg); }
    catch (err) {}
    unreadCounts[convoId] = (unreadCounts[convoId] || 0) + 1;
    saveUnread(); playSound();
    sendNotif(`◈ Reply in "${getConvo(convoId)?.title?.slice(0, 28)}…"`, aMsg.text.slice(0, 120), convoId);
    toast(`◈ New reply in "${getConvo(convoId)?.title?.slice(0, 24)}…"`, 'info');
  }

  cleanupStreamExpanded(aMsg.id);
  clearLiveSidePanelFor(aMsg.id);
  saveConvos();
  renderChatList();
  if (typeof updateBudgetDisplay === 'function') updateBudgetDisplay();
}

// ─── Send message ──────────────────────────────────────────────────────────
async function sendMessage() {
  if (currentConvoId && streamRegistry.has(currentConvoId)) return;
  const input = document.getElementById('msgInput');
  const text  = input.value.trim();
  if (!text && !pendingFiles.length) return;

  const modelId = document.getElementById('modelSelect')?.value || currentModelId;
  const usingPuter = isPuterModel(modelId);

  // API key only required for Bedrock models
  if (!usingPuter && !settings.apiKey) {
    toast('Configure API key in Settings (or select a free Kimi model)', 'error');
    openSettings();
    return;
  }

  _requestNotifPermission();

  // ── Budget check ───────────────────────────────────────────────────────
  let historyMsgs = [];
  if (currentConvoId) {
    const c = getConvo(currentConvoId);
    if (c) historyMsgs = c.messages.filter(m => !m._error);
  }
  const est = estimateConversationTokens(historyMsgs, text, pendingFiles, settings.system || '');
  const budgetResult = checkBudget(est.inputTokens, modelId);

  if (!budgetResult.allowed) {
    _showBudgetWarning(budgetResult.reason, true);
    toast('⛔ ' + budgetResult.reason, 'error');
    return;
  }
  if (budgetResult.warning) {
    _showBudgetWarning(budgetResult.warning, false);
  }

  let convo;

  if (currentConvoId === null) {
    const id = Date.now().toString();
    const title = text ? text.slice(0, 42) + (text.length > 42 ? '…' : '') : 'New Conversation';
    convo = { id, title, messages: [], createdAt: Date.now() };
    conversations.unshift(convo);
    currentConvoId = id;
    saveConvos();
    document.getElementById('emptyState').style.display = 'none';
  } else {
    convo = getConvo(currentConvoId);
    if (!convo) return;
    if (!convo.messages.length && text) {
      convo.title = text.slice(0, 42) + (text.length > 42 ? '…' : '');
    }
  }

  const uMsg = { id: Date.now().toString(), role: 'user', text, files: [...pendingFiles], createdAt: Date.now() };
  convo.messages.push(uMsg);
  bumpConvoToTop(currentConvoId);
  saveConvos();
  appendMsgEl(uMsg);

  _replaceChatURL(currentConvoId);

  input.value = ''; autoResize(input);
  pendingFiles = []; renderFilePreview();
  userScrolledUp = false; _setScrollBtnVisible(false);

  if (typeof updateCostPreview === 'function') updateCostPreview();

  renderChatList();

  // ── Dispatch to correct provider ───────────────────────────────────────
  if (usingPuter) {
    await runPuterStream(currentConvoId);
  } else {
    await runStream(currentConvoId);
  }
}

// ─── Run stream (Bedrock) ──────────────────────────────────────────────────
async function runStream(convoId) {
  const convo = getConvo(convoId); if (!convo) return;
  const opt      = document.getElementById('modelSelect').selectedOptions[0];
  const modelMax = parseInt(opt?.dataset.maxOutputTokens || '32000');
  const effectMax= Math.min(settings.maxTokens||16000, modelMax);
  const modelId  = opt?.value;
  const canThink = opt?.dataset.supportsThinking === 'true';
  const useThink = thinkingOn && canThink;
  const budget   = thinkingBudget;

  // Redirect Puter models to their handler
  if (isPuterModel(modelId)) {
    return runPuterStream(convoId);
  }

  // Track which model is used for this request
  currentModelId = modelId;

  const aMsg = {
    id:(Date.now()+1).toString(), role:'assistant', text:'', thinking:null,
    _thinkingBudget: useThink ? budget : 0,
    createdAt: Date.now(),
    modelName: currentModelName || 'Assistant',
    _modelId: modelId,
  };
  convo.messages.push(aMsg); saveConvos();

  if (currentConvoId === convoId) {
    appendMsgEl(aMsg, true);
    scrollBottomNow();
  }

  setStreamingUI(true); renderChatList();

  const ac = new AbortController();
  streamRegistry.set(convoId, { abortController:ac, assistantMsgId:aMsg.id });

  const { messages: apiMsgs, stats: ctxStats } = prepareMessagesForSend(
    convo.messages.slice(0, -1)
  );

  if (ctxStats && ctxStats.savedTokenEst > 0) {
    console.log(
      `[context] Optimized: ~${tokStr(ctxStats.savedTokenEst)} tokens saved (${ctxStats.savedPct}%) ` +
      `| dropped:${ctxStats.dropped} compressed:${ctxStats.truncated} full:${ctxStats.full} ` +
      `| sent:${ctxStats.totalSent} msgs`
    );
  }

  const saveInterval = setInterval(() => saveConvos(), 2000);

  try {
    const res = await fetch('/api/chat/stream', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        messages:apiMsgs, systemPrompt:settings.system||'',
        modelId, region:settings.region||'us-east-1',
        apiKey:settings.apiKey, extendedThinking:useThink,
        thinkingBudget:budget, maxTokens:effectMax,
        temperature:parseFloat(settings.temperature||0.7),
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream:true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try { handleSSE(JSON.parse(line.slice(6)), convoId, aMsg, budget); }
        catch(e) { console.error('[SSE]', e); }
      }
      if (currentConvoId === convoId && !userScrolledUp) scrollBottomNow();
    }
  } catch(e) {
    if (e.name !== 'AbortError') {
      aMsg._error = e.message || 'Connection failed';
      toast('Stream error: ' + aMsg._error, 'error');
      if (_isRateLimitError(aMsg._error)) setTimeout(_suggestModelSwitch, 1500);
    }
  }

  clearInterval(saveInterval);
  streamRegistry.delete(convoId);

  if (currentConvoId === convoId) {
    try {
      _flushRender(aMsg.id, aMsg);
      finalizeMsgEl(aMsg);
      if (!userScrolledUp) scrollBottomNow();
      if (!aMsg._error) {
        let costStr = '';
        if (aMsg.usage) {
          const cost = calculateCost(aMsg.usage.inputTokens||0, aMsg.usage.outputTokens||0, aMsg._modelId || modelId);
          costStr = ` · ${formatUSD(cost.totalCost)}`;
        }
        const u = aMsg.usage ? ` · ${aMsg.usage.outputTokens||0} tokens` : '';
        toast(`✓ Complete${u}${costStr}`,'success'); playSound();
        if (document.hidden) sendNotif('◈ Reply ready', aMsg.text.slice(0,100));
      }
    } catch(err) { console.error('[stream] Finalize:',err); }
    finally { setStreamingUI(false); }
  } else {
    try { const r=document.querySelector(`[data-msg-id="${aMsg.id}"]`); if(r) finalizeMsgEl(aMsg); }
    catch(err) {}
    unreadCounts[convoId] = (unreadCounts[convoId]||0)+1;
    saveUnread(); playSound();
    sendNotif(`◈ Reply in "${getConvo(convoId)?.title?.slice(0,28)}…"`, aMsg.text.slice(0,120), convoId);
    toast(`◈ New reply in "${getConvo(convoId)?.title?.slice(0,24)}…"`,'info');
  }

  cleanupStreamExpanded(aMsg.id); clearLiveSidePanelFor(aMsg.id);
  saveConvos(); renderChatList();
}

// ─── SSE handler (Bedrock only) ────────────────────────────────────────────
function handleSSE(ev, convoId, msg, budget) {
  const isCur = currentConvoId === convoId;
  const getRow = () => isCur ? document.querySelector(`[data-msg-id="${msg.id}"]`) : null;

  if (ev.type === 'thinking_start') {
    msg.thinking = '';
    if (!isCur) return;
    const row=getRow(); if(!row) return;
    const body=row.querySelector('.msg-body'); if(!body) return;
    row.querySelector('.thinking-block')?.remove();
    body.appendChild(buildThinkingBlock('',true,budget));
  }

  if (ev.type === 'thinking_delta') {
    msg.thinking = (msg.thinking||'') + ev.text;
    if (!isCur) return;
    const row=getRow(); if(!row) return;
    let tb=row.querySelector('.thinking-block');
    if (!tb) { const body=row.querySelector('.msg-body'); if(body){tb=buildThinkingBlock('',true,budget);body.appendChild(tb);} }
    const sl=row.querySelector('.thinking-header-text');
    if (sl) { const e=Math.round(msg.thinking.length/4); sl.textContent=`THINKING… — ~${tokStr(e)}${budget>0?` / ${tokStr(budget)}`:''} tokens`; }
    const tl=row.querySelector('.thinking-topic');
    if (tl) { const tp=_getThinkingTopic(msg.thinking); tl.textContent=tp; tl.style.display=tp?'':'none'; }
    const c=row.querySelector('.thinking-content');
    if (c) {
      const tn=c.firstChild;
      if (tn?.nodeType===Node.TEXT_NODE) tn.textContent=msg.thinking;
      else { c.innerHTML=''; c.appendChild(document.createTextNode(msg.thinking)); const cu=document.createElement('span');cu.className='thinking-cursor';c.appendChild(cu); }
      c.scrollTop=c.scrollHeight;
    }
    const fill=row.querySelector('.thinking-progress-fill');
    const lbl=row.querySelector('.thinking-progress-label');
    if (fill&&budget>0) { const e=Math.round(msg.thinking.length/4); fill.style.width=Math.min(100,(e/budget)*100)+'%'; if(lbl)lbl.textContent=`~${tokStr(e)} / ${tokStr(budget)} tokens`; }
  }

  if (ev.type === 'thinking_end') {
    if (!isCur) return;
    const row=getRow(); if(!row) return;
    const tb=row.querySelector('.thinking-block');
    if (tb) {
      tb.querySelectorAll('.thinking-cursor,.thinking-progress').forEach(el=>el.remove());
      const ic=tb.querySelector('.thinking-spinner'); if(ic) ic.className='thinking-dot';
      const sl=tb.querySelector('.thinking-header-text');
      if (sl) { const e=Math.round((msg.thinking||'').length/4); sl.textContent=`REASONING — ${tokStr(e)} est. tokens`; }
      if (!tb.classList.contains('collapsed')) tb.classList.add('collapsed');
    }
  }

  if (ev.type === 'text_delta') {
    msg.text += ev.text;
    if (isCur) _scheduleRender(msg.id, convoId, msg);
  }

  if (ev.type === 'done') { msg.stopReason = ev.stopReason; }

  if (ev.type === 'usage') {
    msg.usage = { inputTokens:ev.usage?.inputTokens, outputTokens:ev.usage?.outputTokens };

    const usedModelId = msg._modelId || currentModelId;
    recordTokenUsage(msg.usage.inputTokens, msg.usage.outputTokens);

    const cost = calculateCost(msg.usage.inputTokens||0, msg.usage.outputTokens||0, usedModelId);
    msg._cost = cost.totalCost;

    if (!isCur) return;
    const row=getRow(); if(!row) return;
    const hdr=row.querySelector('.msg-header');
    let u=hdr?.querySelector('.msg-usage');
    if (!u&&hdr) { u=document.createElement('span');u.className='msg-usage';hdr.insertBefore(u,hdr.querySelector('.msg-actions')); }
    if (u) u.textContent=`${ev.usage?.inputTokens||0}↑ ${ev.usage?.outputTokens||0}↓ · ${formatUSD(cost.totalCost)}`;
  }

  if (ev.type === 'error') {
    msg._error = ev.message;
    toast('Bedrock error: ' + ev.message, 'error');
    if (_isRateLimitError(ev.message)) setTimeout(_suggestModelSwitch, 1500);
  }
}
