'use strict';

require('dotenv').config();

const express = require('express');
const path    = require('path');

const chatRouter   = require('./routes/chat');
const uploadRouter = require('./routes/upload');
const modelsRouter = require('./routes/models');

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/chat',   chatRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/models', modelsRouter);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// FIX: Global error handler — prevents unhandled errors from crashing the server.
// Without this, things like malformed JSON in a request body, unexpected multer
// errors, or any throw inside a synchronous route handler would bubble up as an
// uncaught exception and terminate the Node process.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err);
  if (res.headersSent) return;
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Bedrock Claude Chat v2 running at http://localhost:${PORT}\n`);
});
