// public/js/context.js — Client-side context optimization
//
// Before each request, this module:
//  1. Strips base64 file data from old messages (massive bandwidth + token saving)
//  2. Replaces stripped files with short text references
//  3. Truncates long old text messages
//  4. Drops very old messages, replacing with a topic summary
//  5. Keeps the most recent N messages in full for highest quality output

/**
 * Prepare conversation messages for sending to the API.
 * Returns { messages: [...], stats: {...}|null }
 */
function prepareMessagesForSend(rawMessages) {
  const mode = settings.contextMode || 'smart';

  // Filter out error/empty messages first
  const messages = rawMessages.filter(
    m => !m._error && (m.text?.trim() || m.files?.length)
  );

  // Full mode — no optimization, send everything as-is
  if (mode === 'full') {
    return {
      messages: messages.map(m => ({
        role: m.role, text: m.text, files: m.files || [],
      })),
      stats: null,
    };
  }

  const aggressive   = mode === 'aggressive';
  const recentCount  = aggressive ? 4  : (settings.contextRecentCount  || 6);
  const maxContext    = aggressive ? 16 : (settings.contextMaxMessages  || 40);
  const maxOldChars  = aggressive ? 250 : 600;
  const maxOldAssist = aggressive ? 400 : 800;

  // Small conversation — no optimization needed
  if (messages.length <= recentCount) {
    return {
      messages: messages.map(m => ({
        role: m.role, text: m.text, files: m.files || [],
      })),
      stats: null,
    };
  }

  // ── Measure original size ──────────────────────────────────────────────
  let origChars = 0, origFileChars = 0;
  for (const m of messages) {
    origChars += (m.text || '').length;
    if (m.files) for (const f of m.files) origFileChars += (f.data || '').length;
  }
  const origTotal = origChars + origFileChars;

  // ── Split: dropped | old-kept | recent-full ────────────────────────────
  const totalToKeep = Math.min(messages.length, maxContext);
  const dropCount   = messages.length - totalToKeep;
  const dropped     = messages.slice(0, dropCount);
  const kept        = messages.slice(dropCount);
  const recentStart = Math.max(0, kept.length - recentCount);
  const oldKept     = kept.slice(0, recentStart);
  const recent      = kept.slice(recentStart);

  const result = [];

  // ── 1. Summary of completely dropped messages ──────────────────────────
  if (dropped.length > 0) {
    const summary = _buildSummary(dropped);
    if (summary) {
      result.push({ role: 'user',      text: summary, files: [] });
      result.push({ role: 'assistant', text: 'Understood, I have the context from our earlier discussion.', files: [] });
    }
  }

  // ── 2. Old-but-kept messages: strip files, truncate text ───────────────
  for (const m of oldKept) {
    let text = m.text || '';

    // Replace file data with concise text references
    if (m.files?.length) {
      const refs = m.files.map(_fileRef).join(' ');
      text = refs + (text ? '\n' + text : '');
    }

    // Truncate long text
    const limit = m.role === 'assistant' ? maxOldAssist : maxOldChars;
    if (text.length > limit) {
      const half = Math.floor((limit - 40) / 2);
      text = text.slice(0, half) + '\n[…truncated…]\n' + text.slice(-half);
    }

    result.push({ role: m.role, text, files: [] });
  }

  // ── 3. Recent messages: full content including files ───────────────────
  for (const m of recent) {
    result.push({ role: m.role, text: m.text, files: m.files || [] });
  }

  // ── Measure optimized size ─────────────────────────────────────────────
  let optChars = 0, optFileChars = 0;
  for (const m of result) {
    optChars += (m.text || '').length;
    if (m.files) for (const f of m.files) optFileChars += (f.data || '').length;
  }
  const optTotal = optChars + optFileChars;

  const savedPct = origTotal > 0
    ? Math.round(((origTotal - optTotal) / origTotal) * 100)
    : 0;

  // Estimate token savings (rough: 1 token ≈ 3.5 chars for text, file data is base64)
  const origTokenEst = Math.ceil(origChars / 3.5) + Math.ceil(origFileChars * 0.75 / 3.5);
  const optTokenEst  = Math.ceil(optChars / 3.5)  + Math.ceil(optFileChars * 0.75 / 3.5);

  return {
    messages: result,
    stats: {
      origTotal,
      optTotal,
      savedPct,
      origTokenEst,
      optTokenEst,
      savedTokenEst: origTokenEst - optTokenEst,
      dropped:   dropped.length,
      truncated: oldKept.length,
      full:      recent.length,
      totalSent: result.length,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function _fileRef(f) {
  const name = f.name || f.type || 'file';
  const size = f.size ? ` ${fmtSize(f.size)}` : '';
  if (f.type === 'image')                    return `[Image: ${name}${size}]`;
  if (f.type === 'paste')                    return `[Pasted text: ${name}${size}]`;
  if (f.mediaType === 'application/pdf')     return `[PDF: ${name}${size}]`;
  return `[File: ${name}${size}]`;
}

function _buildSummary(msgs) {
  const lines = [];
  const fileNames = new Set();

  for (const m of msgs) {
    if (m.files?.length) {
      for (const f of m.files) fileNames.add(f.name || f.type || 'file');
    }
    const p = (m.text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (p) {
      const label = m.role === 'user' ? 'User' : 'Assistant';
      lines.push(`• ${label}: ${p}${(m.text || '').length > 120 ? '…' : ''}`);
    }
  }

  if (!lines.length && !fileNames.size) return null;

  let summary = '[Earlier conversation condensed to minimize tokens]\n';
  if (fileNames.size) {
    summary += `Files shared earlier: ${[...fileNames].join(', ')}\n`;
  }
  // Keep only last 8 topic lines to stay compact
  summary += lines.slice(-8).join('\n');
  return summary;
}
