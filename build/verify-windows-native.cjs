/* Run with the packaged Electron executable and ELECTRON_RUN_AS_NODE=1.
 * This does not launch the workbench, access a user profile, or touch an installed Wibe.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const product = path.resolve(process.argv[2] || '.');
const app = path.join(product, 'resources', 'app');
assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
assert.ok(process.versions.electron, 'Use packaged Electron, not the build Node');
const npmrc = fs.readFileSync(path.join(__dirname, '..', '.npmrc'), 'utf8');
const target = npmrc.match(/^target="([^"]+)"/m)?.[1];
assert.equal(process.versions.electron, target, 'Electron must match native build target');
const load = name => require(path.join(app, 'node_modules.asar', name));
async function main() {
  const keymap = load('native-keymap');
  const mapping = keymap.getKeyMap();
  assert.ok(mapping && !Array.isArray(mapping) && Object.keys(mapping).length > 0, 'Keyboard scan-code map is empty');
  console.log('Keyboard mapping entries: ' + Object.keys(mapping).length);
  assert.ok(keymap.getCurrentKeyboardLayout(), 'Keyboard layout is missing');
  assert.equal(typeof load('native-is-elevated')(), 'boolean');
  console.log('PASS: packaged keyboard mapping and elevation detection');
  const sqlite = require(path.join(app, 'extensions', 'incontrol', 'node_modules', 'sqlite3'));
  await new Promise((resolve, reject) => {
    const db = new sqlite.Database(':memory:', error => {
      if (error) return reject(error);
      db.get('SELECT 42 AS answer', (error, row) => {
        db.close(closeError => {
          if (error || closeError) return reject(error || closeError);
          try { assert.equal(row.answer, 42); resolve(); } catch (error) { reject(error); }
        });
      });
    });
  });
  console.log('PASS: packaged extension SQLite query on Electron ABI ' + process.versions.modules);
  await new Promise((resolve, reject) => {
    const pty = load('node-pty').spawn(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/c', 'echo WIBE_NATIVE_PTY_OK'],
      { name: 'xterm-color', cols: 80, rows: 24, cwd: product, env: { ...process.env }, useConptyDll: true });
    let output = '';
    const timeout = setTimeout(() => { pty.kill(); reject(new Error('Packaged ConPTY timed out')); }, 15000);
    pty.onData(data => { output += data; });
    pty.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      try { assert.equal(exitCode, 0); assert.match(output, /WIBE_NATIVE_PTY_OK/); resolve(); }
      catch (error) { reject(error); }
    });
  });
  console.log('PASS: packaged ConPTY spawned and completed a command');
}
// Native monitoring threads can keep the test process alive after assertions complete.
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
