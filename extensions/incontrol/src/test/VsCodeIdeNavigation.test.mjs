import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
// Execute the real method, isolated from unrelated native/extension services.
const source = readFileSync(new URL('../VsCodeIde.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('VsCodeIde.ts', source, ts.ScriptTarget.Latest, true);
let method;
const visit = node => {
  if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'showLines') method = node.getText(file);
  ts.forEachChild(node, visit);
};
visit(file);
assert.ok(method);
const code = ts.transpileModule(`class Adapter { ${method} }; globalThis.adapter = new Adapter();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness({ count = 5, fail = false, delayed = false } = {}) {
  class Range {
    constructor(start, column, end, endColumn) {
      this.start = { line: start, character: column };
      this.end = { line: end, character: endColumn };
    }
  }
  class Selection {
    constructor(start, end) { this.start = start; this.end = end; }
  }
  const calls = [];
  const editor = {};
  let release;
  let notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const context = {
    vscode: {
      Uri: { parse: value => value }, Range, Selection, ViewColumn: { One: 1 },
      workspace: {
        openTextDocument: async uri => {
          assert.equal(uri, 'file:///workspace/file.ts');
          if (fail) throw new Error('file missing');
          return { validateRange: range => new Range(Math.min(count - 1, range.start.line), 0, Math.min(count - 1, range.end.line), 0) };
        },
      },
    },
    openEditorAndRevealRange: (...args) => {
      calls.push(args);
      notifyStarted();
      return delayed ? new Promise(resolve => { release = () => resolve(editor); }) : Promise.resolve(editor);
    },
  };
  vm.runInNewContext(code, context);
  return { ...context, calls, editor, started, release: () => release() };
}

test('opens and pins the source editor with the selected line', async () => {
  const h = harness();
  await h.adapter.showLines('file:///workspace/file.ts', 2, 2);
  assert.equal(h.calls[0][2], 1);
  assert.equal(h.calls[0][3], false);
  assert.equal(h.editor.selection.start.line, 2);
});
test('clamps old diff lines after the document becomes shorter', async () => {
  const h = harness({ count: 3 });
  await h.adapter.showLines('file:///workspace/file.ts', 100, 100);
  assert.equal(h.editor.selection.start.line, 2);
});
test('normalizes invalid and negative line coordinates', async () => {
  for (const line of [-1, NaN, Infinity]) {
    const h = harness();
    await h.adapter.showLines('file:///workspace/file.ts', line, line);
    assert.equal(h.editor.selection.start.line, 0);
  }
});
test('propagates a missing file without opening an editor', async () => {
  const h = harness({ fail: true });
  await assert.rejects(h.adapter.showLines('file:///workspace/file.ts', 0, 0), /file missing/);
  assert.equal(h.calls.length, 0);
});
test('waits for the editor before resolving and applying selection', async () => {
  const h = harness({ delayed: true });
  let finished = false;
  const promise = h.adapter.showLines('file:///workspace/file.ts', 1, 1).then(() => { finished = true; });
  await h.started;
  assert.equal(finished, false);
  h.release(); await promise;
  assert.equal(h.editor.selection.start.line, 1);
});
