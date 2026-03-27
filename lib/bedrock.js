'use strict';

const { BedrockRuntimeClient } = require('@aws-sdk/client-bedrock-runtime');

/**
 * Shared middleware — overrides SigV4 Authorization with a Bearer token.
 */
function _applyBearerAuth(client, apiKey) {
  client.middlewareStack.add(
    (next) => async (args) => {
      if (args.request?.headers) {
        for (const key of Object.keys(args.request.headers)) {
          if (key.toLowerCase() === 'authorization') {
            delete args.request.headers[key];
          }
        }
        args.request.headers['authorization'] = `Bearer ${apiKey}`;
      }
      return next(args);
    },
    {
      step:     'finalizeRequest',
      priority: 'low',
      name:     'bearerTokenAuth',
      override: true,
    }
  );
}

function buildClient(config) {
  const region = config.region || process.env.AWS_REGION || 'us-east-1';
  const apiKey = config.apiKey || process.env.AWS_BEARER_TOKEN_BEDROCK;

  if (!apiKey) {
    return new BedrockRuntimeClient({ region });
  }

  const client = new BedrockRuntimeClient({
    region,
    credentials: () =>
      Promise.resolve({
        accessKeyId:     'bearer-token-auth',
        secretAccessKey: 'bearer-token-auth',
      }),
  });

  _applyBearerAuth(client, apiKey);
  return client;
}

/**
 * Build a Bedrock control-plane client (for ListFoundationModels,
 * ListInferenceProfiles, etc.).  Uses the same bearer-token injection.
 */
function buildControlClient(config) {
  // Lazy-require so the app still starts if @aws-sdk/client-bedrock
  // isn't installed (the models route falls back to the curated list).
  let BedrockClient;
  try {
    BedrockClient = require('@aws-sdk/client-bedrock').BedrockClient;
  } catch (_e) {
    throw new Error(
      '@aws-sdk/client-bedrock is not installed. Run: npm install @aws-sdk/client-bedrock'
    );
  }

  const region = config.region || process.env.AWS_REGION || 'us-east-1';
  const apiKey = config.apiKey || process.env.AWS_BEARER_TOKEN_BEDROCK;

  if (!apiKey) {
    return new BedrockClient({ region });
  }

  const client = new BedrockClient({
    region,
    credentials: () =>
      Promise.resolve({
        accessKeyId:     'bearer-token-auth',
        secretAccessKey: 'bearer-token-auth',
      }),
  });

  _applyBearerAuth(client, apiKey);
  return client;
}

function buildConverseMessages(messages) {
  const result = [];

  for (const msg of messages) {
    const content = [];

    if (msg.files && msg.files.length > 0) {
      for (const file of msg.files) {
        const buf = Buffer.from(file.data, 'base64');

        if (file.type === 'image') {
          const fmt = file.mediaType.split('/')[1];
          content.push({
            image: {
              format: fmt === 'jpg' ? 'jpeg' : fmt,
              source: { bytes: buf },
            },
          });
        } else if (file.mediaType === 'application/pdf') {
          content.push({
            document: {
              format: 'pdf',
              name: file.name.replace(/[^a-zA-Z0-9\-_.]/g, '_').slice(0, 50),
              source: { bytes: buf },
            },
          });
        } else {
          const textContent = buf.toString('utf-8');
          if (textContent.trim()) {
            content.push({
              text: `[File: ${file.name}]\n\`\`\`\n${textContent}\n\`\`\``,
            });
          }
        }
      }
    }

    if (msg.text && msg.text.trim()) content.push({ text: msg.text });
    if (content.length === 0) continue;
    result.push({ role: msg.role, content });
  }

  const merged = [];
  for (const msg of result) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content.push(...msg.content);
    } else {
      merged.push({ role: msg.role, content: [...msg.content] });
    }
  }

  if (merged.length > 0 && merged[0].role !== 'user') merged.shift();
  if (merged.length > 0 && merged[merged.length - 1].role !== 'user') merged.pop();

  return merged;
}

module.exports = { buildClient, buildControlClient, buildConverseMessages };