# Bedrock Claude Chat

Full-featured Claude chat app via Amazon Bedrock — with extended thinking, file uploads, image support, streaming, and a polished dark UI.

## Features

- 💬 **Full chat interface** with conversation history
- 🧠 **Extended Thinking** — toggle on/off with adjustable token budget (1k–50k)
- 🖼️ **Image uploads** — PNG, JPEG, GIF, WebP inline previews
- 📄 **File uploads** — PDFs, code files, text, CSV, JSON
- ⚡ **Streaming responses** — real-time token streaming
- 📋 **Markdown rendering** — code highlighting, tables, lists
- 🗂️ **Multi-conversation** sidebar with persistence
- ⚙️ **Settings panel** — API key, region, system prompt, temperature, max tokens
- 🔢 **Token usage** display per message

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure your API key

Edit `.env`:
```
AWS_BEARER_TOKEN_BEDROCK=your_key_here
AWS_REGION=us-east-1
```

Or configure it in the app's Settings panel after launch.

### 3. Run
```bash
npm start
# or for development with auto-restart:
npm run dev
```

Open http://localhost:3000

## Models

The app includes these Bedrock model IDs (configurable in the top bar):

| Model | Extended Thinking |
|-------|------------------|
| Claude Sonnet 4.5 (Cross-Region) | ✅ |
| Claude Sonnet 4.5 | ✅ |
| Claude Opus 4.5 (Cross-Region) | ✅ |
| Claude Sonnet 3.7 | ✅ |
| Claude Sonnet 3.5 v2 | ❌ |
| Claude Haiku 3.5 | ❌ |

To add newer models (like claude-sonnet-4-6 when available on Bedrock), add entries to the `/api/models` array in `server.js`.

## Supported File Types

- **Images**: PNG, JPEG, GIF, WebP (shown inline)
- **Documents**: PDF (sent as document blocks)
- **Text**: .txt, .md, .csv, .json, .js, .py, .ts, .html, .css, .xml, .yaml

## Extended Thinking

When enabled, Claude shows its full reasoning process in a collapsible purple block before the answer. Use the budget slider to control how many tokens Claude can spend thinking (more = deeper reasoning, higher cost).

## Authentication

This app uses Amazon Bedrock's **long-term API key** (Bearer token) authentication. The key is stored in localStorage in the browser and sent as a header via the backend proxy.

> ⚠️ **Note**: Your API key expires on March 27, 2026. Generate a new one from the Bedrock console when it expires.
