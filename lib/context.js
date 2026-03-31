'use strict';

/**
 * Server-side context optimization — safety net.
 * The client does the heavy lifting; this enforces hard limits
 * in case the client sends unoptimized payloads (e.g. direct API use).
 *
 * KEY: Now also strips file data from old messages — previously it only
 * truncated text, allowing megabytes of base64 through on every request.
 */

const HARD_MAX_MESSAGES    = 60;
const HARD_MAX_MSG_CHARS   = 5000;
const DEFAULT_RECENT_FULL  = 6;

function estimateTokens(text) {
  return text ? Math.ceil(text.length / 3.5) : 0;
}

function estimateFileTokens(files) {
  if (!files?.length) return 0;
  let tokens = 0;
  for (const f of files) {
    if (!f.data) continue;
    // base64 is ~33% overhead, so real bytes ≈ data.length * 0.75
    // Then ~3.5 chars per token for the decoded content
    tokens += Math.ceil(f.data.length * 0.75 / 3.5);
  }
  return tokens;
}

function truncateMiddle(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  const half = Math.floor((maxChars - 50) / 2);
  return text.slice(0, half) + '\n[…truncated for efficiency…]\n' + text.slice(-half);
}

/**
 * Compress code blocks in assistant messages to one-line summaries.
 */
function compressCodeBlocks(text) {
  if (!text) return text;
  return text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const lines = code.trim().split('\n').length;
    const label = lang ? lang.toUpperCase() : 'CODE';
    const first = code.trim().split('\n')[0] || '';
    const fnMatch = first.match(
      /^(?:\/\/|#|\/\*+|\*|--|;)\s*(?:[Ff]ile(?:name)?:?\s*)?(?:\S+[/\\])?([a-zA-Z0-9_.][a-zA-Z0-9_.-]*\.[a-zA-Z0-9]{1,8})/
    );
    return `[Code: ${fnMatch ? fnMatch[1] : label}, ${lines} lines]`;
  });
}

/**
 * Build a short text reference for a file (replacing its base64 data).
 */
function fileRef(f) {
  const name = f.name || f.type || 'file';
  if (f.type === 'image')                    return `[Image: ${name}]`;
  if (f.mediaType === 'application/pdf')     return `[PDF: ${name}]`;
  return `[File: ${name}]`;
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

  // Estimate original tokens (text + files)
  let origTok = 0;
  for (const m of messages) {
    origTok += estimateTokens(m.text);
    origTok += estimateFileTokens(m.files);
  }

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

  // Old: strip file data, compress code blocks, enforce char limit
  for (const m of old) {
    let text = m.text || '';

    // Replace file data with concise text references
    if (m.files?.length) {
      const refs = m.files.map(fileRef).join(' ');
      text = refs + (text ? '\n' + text : '');
    }

    // Compress code blocks in assistant messages
    if (m.role === 'assistant') {
      text = compressCodeBlocks(text);
    }

    result.push({
      role:  m.role,
      text:  truncateMiddle(text, HARD_MAX_MSG_CHARS),
      files: [],  // Strip all file data from old messages
    });
  }

  // Recent: pass through with full files
  for (const m of recent) {
    result.push({ role: m.role, text: m.text, files: m.files || [] });
  }

  let optTok = 0;
  for (const m of result) {
    optTok += estimateTokens(m.text);
    optTok += estimateFileTokens(m.files);
  }

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
