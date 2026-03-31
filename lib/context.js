'use strict';

/**
 * Server-side context optimization — safety net.
 * The client does the heavy lifting; this enforces hard limits
 * in case the client sends unoptimized payloads (e.g. direct API use).
 */

const HARD_MAX_MESSAGES    = 60;
const HARD_MAX_MSG_CHARS   = 5000;
const DEFAULT_RECENT_FULL  = 6;

function estimateTokens(text) {
  return text ? Math.ceil(text.length / 3.5) : 0;
}

function truncateMiddle(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  const half = Math.floor((maxChars - 50) / 2);
  return text.slice(0, half) + '\n[…truncated for efficiency…]\n' + text.slice(-half);
}

function buildDroppedSummary(msgs) {
  if (!msgs.length) return null;
  const lines = [];
  const files = new Set();
  for (const m of msgs) {
    if (m.files?.length) {
      for (const f of m.files) files.add(f.name || f.type || 'file');
    }
    const p = (m.text || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (p) {
      lines.push(`${m.role === 'user' ? 'User' : 'Asst'}: ${p}${(m.text || '').length > 100 ? '…' : ''}`);
    }
  }
  if (!lines.length && !files.size) return null;
  let s = '[Earlier conversation condensed]\n';
  if (files.size) s += `Files mentioned: ${[...files].join(', ')}\n`;
  s += lines.slice(-8).join('\n');
  return s;
}

/**
 * Apply server-side context limits.
 * @param {Array}  messages - { role, text, files }
 * @param {Object} opts     - { recentFullCount, maxTotalMessages }
 */
function optimizeContext(messages, opts = {}) {
  if (!messages?.length) return { messages: [], stats: { saved: 0 } };

  const maxTotal   = Math.min(opts.maxTotalMessages || HARD_MAX_MESSAGES, HARD_MAX_MESSAGES);
  const recentFull = Math.min(opts.recentFullCount  || DEFAULT_RECENT_FULL, maxTotal);

  // Estimate original tokens (text only — files already counted elsewhere)
  let origTok = 0;
  for (const m of messages) origTok += estimateTokens(m.text);

  // Small conversation — pass through
  if (messages.length <= recentFull) {
    return { messages: [...messages], stats: { origTok, optTok: origTok, saved: 0 } };
  }

  // Split
  const dropCount = Math.max(0, messages.length - maxTotal);
  const dropped   = messages.slice(0, dropCount);
  const kept      = messages.slice(dropCount);
  const recentIdx = Math.max(0, kept.length - recentFull);
  const old       = kept.slice(0, recentIdx);
  const recent    = kept.slice(recentIdx);

  const result = [];

  // Summary of dropped
  if (dropped.length > 0) {
    const summary = buildDroppedSummary(dropped);
    if (summary) {
      result.push({ role: 'user', text: summary, files: [] });
      result.push({ role: 'assistant', text: 'Understood, I recall our earlier discussion.', files: [] });
    }
  }

  // Old: enforce char limit on text
  for (const m of old) {
    result.push({
      role:  m.role,
      text:  truncateMiddle(m.text, HARD_MAX_MSG_CHARS),
      files: m.files || [],
    });
  }

  // Recent: pass through
  for (const m of recent) {
    result.push({ role: m.role, text: m.text, files: m.files || [] });
  }

  let optTok = 0;
  for (const m of result) optTok += estimateTokens(m.text);

  return {
    messages: result,
    stats: {
      origTok,
      optTok,
      saved:   origTok - optTok,
      dropped: dropped.length,
    },
  };
}

module.exports = { optimizeContext };
