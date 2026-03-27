#!/usr/bin/env node

// push-env-to-heroku.js
// Usage: node push-env-to-heroku.js <app-name>
//
// Uses the Heroku REST API directly — no shell involved, so special characters
// like & { } @ ; ^ % [ ] in values are never misinterpreted.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const appName = process.argv[2];
if (!appName) {
    console.error('❌  Usage: node push-env-to-heroku.js <app-name>');
    process.exit(1);
}

// ── 1. Get Heroku API token from CLI ──────────────────────────────────────────
let apiToken;
try {
    apiToken = execSync('heroku auth:token', {
        encoding: 'utf8',
        shell: false,   // safe — no special chars in this command
    }).trim();
} catch {
    console.error('❌  Could not get Heroku token. Run: heroku login');
    process.exit(1);
}

if (!apiToken) {
    console.error('❌  Heroku token is empty. Run: heroku login');
    process.exit(1);
}

// ── 2. Read .env file ─────────────────────────────────────────────────────────
const envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
    console.error('❌  .env file not found in current directory.');
    process.exit(1);
}

const vars = {};
for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (key) vars[key] = value;
}

if (Object.keys(vars).length === 0) {
    console.error('❌  No variables found in .env');
    process.exit(1);
}

console.log(`\n📦  Found ${Object.keys(vars).length} variable(s):`);
Object.keys(vars).forEach(k => console.log(`    ${k}`));
console.log(`\n🚀  Pushing to Heroku app: ${appName} ...\n`);

// ── 3. PATCH all vars in one API call ─────────────────────────────────────────
// The value is JSON-encoded by JSON.stringify — special chars are fully safe.
const response = await fetch(
    `https://api.heroku.com/apps/${appName}/config-vars`,
    {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type':  'application/json',
            'Accept':        'application/vnd.heroku+json; version=3',
        },
        body: JSON.stringify(vars),
    }
);

if (!response.ok) {
    const body = await response.text();
    console.error(`❌  Heroku API error ${response.status}: ${body}`);
    process.exit(1);
}

const result = await response.json();
console.log('✅  All variables set successfully!\n');
console.log('Current config on Heroku:');
Object.entries(result).forEach(([k, v]) => {
    // Mask sensitive values in console output
    const sensitive = ['PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'URI', 'HASH'];
    const masked = sensitive.some(s => k.toUpperCase().includes(s));
    console.log(`    ${k} = ${masked ? '***' : v}`);
});
console.log('\n🔄  Heroku will restart your dyno automatically.');