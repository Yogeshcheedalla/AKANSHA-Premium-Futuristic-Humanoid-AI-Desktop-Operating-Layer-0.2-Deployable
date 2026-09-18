'use strict';
/**
 * Akansha backend diagnostics logger (dependency-free, CommonJS).
 *
 * Writes structured, SECRET-REDACTED lifecycle lines to <userData>/backend.log with
 * size-based rotation (backend.log -> backend.log.1). Never throws into the app.
 * Takes an explicit directory so it can run outside Electron (and be tested).
 */
const fs = require('fs');
const path = require('path');

const SECRET_KEY_RE = /(token|secret|password|passwd|cookie|authorization|apikey|api[_-]?key|access[_-]?key|private[_-]?key|credential|session)/i;
const SECRET_VALUE_RES = [
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /GOCSPX-[A-Za-z0-9_\-]+/g,
  /sk-[A-Za-z0-9]{16,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

function redactString(input) {
  let out = String(input == null ? '' : input);
  for (const re of SECRET_VALUE_RES) out = out.replace(re, (m) => m.slice(0, 6) + '…[redacted]');
  return out;
}

function redactObj(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (SECRET_KEY_RE.test(k)) out[k] = '[redacted]';
    else if (typeof v === 'string') out[k] = redactString(v);
    else out[k] = v;
  }
  return out;
}

function createBackendLogger(dir, opts = {}) {
  const MAX = opts.maxBytes || 2 * 1024 * 1024; // 2 MB per file
  const logPath = path.join(dir, 'backend.log');
  const rotPath = path.join(dir, 'backend.log.1');

  function write(level, event, data) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX) {
        try { fs.rmSync(rotPath, { force: true }); } catch (_) {}
        fs.renameSync(logPath, rotPath);
      }
      const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(data ? redactObj(data) : {}) });
      fs.appendFileSync(logPath, line + '\n');
    } catch (_) { /* logging must never crash the app */ }
  }

  function diagnosticReport() {
    let tail = '';
    try {
      tail = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(-60).join('\n') : '(no log entries yet)';
    } catch (_) { tail = '(log unreadable)'; }
    return redactString(`AKANSHA backend diagnostic\nlog file: ${logPath}\n---\n${tail}\n`);
  }

  return {
    info: (e, d) => write('info', e, d),
    warn: (e, d) => write('warn', e, d),
    error: (e, d) => write('error', e, d),
    getLogPath: () => logPath,
    diagnosticReport,
    redactString,
  };
}

module.exports = { createBackendLogger, redactString, redactObj };
