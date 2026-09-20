#!/usr/bin/env node
'use strict';

// `npm run dev` — runs the Express API (nodemon) and the Next.js web dev
// server together and stops both when either exits. Requires a `web/`
// dependency install before first run (cd web && npm install).

const { spawn } = require('child_process');
const path = require('path');

const WEB_DIR = path.resolve(__dirname, '..', 'web');

const isWin = process.platform === 'win32';
const children = [];

function run(npmArgs) {
  const child = spawn('npm', npmArgs, {
    cwd: path.resolve(__dirname, '..'),
    shell: isWin,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  child.on('exit', (code) => stopAll(code));
  return child;
}

function stopAll(code) {
  for (const child of children) {
    try {
      child.kill();
    } catch (_e) {
      /* ignore */
    }
  }
  process.exitCode = code ?? 0;
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

run(['run', 'dev:server']);
run(['--prefix', WEB_DIR, 'run', 'dev']);