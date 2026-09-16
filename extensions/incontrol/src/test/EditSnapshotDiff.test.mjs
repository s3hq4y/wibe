import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../diff/EditSnapshotDiff.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function harness({ late = false, fail = false } = {}) {
  const calls = [], reveals = [], editors = [], tabs = [], listeners = new Set();
  let provider;
  const docs = [], docListeners = new Set();
  class EventEmitter {
    listeners = new Set();
    event = fn => { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; };
    fire = value => { for (const fn of this.listeners) fn(value); };
    dispose() { this.listeners.clear(); }
  }
  let shouldFail = fail;
  class Uri {
    constructor(scheme, authority, path) { Object.assign(this, { scheme, authority, path }); }
    static parse(s) { const u = new URL(s); return new Uri(u.protocol.slice(0,-1), u.host, decodeURIComponent(u.pathname)); }
    static from({ scheme, authority, path }) { return new Uri(scheme, authority, path); }
    toString() { return `${this.scheme}://${this.authority}${encodeURI(this.path)}`; }
  }
  class Range { constructor(a, b, c, d) { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } }
  class Selection { constructor(start, end) { Object.assign(this, { start, end }); } }
  class TabInputTextDiff { constructor(original, modified) { Object.assign(this, { original, modified }); } }
  const document = uri => {
    assert.equal(uri.scheme, 'incontrol-edit-diff', 'must not read the live file');
    const existing = docs.find(d => d.uri.toString() === uri.toString());
    if (existing) return existing;
    const doc = { uri, text: provider.provideTextDocumentContent(uri), getText() { return this.text; },
      validateRange(range) { return new Range(Math.min(range.start.line,this.text.split('\n').length-1),0,Math.min(range.end.line,this.text.split('\n').length-1),0); } };
    docs.push(doc); return doc;
  };
  const api = {
    EventEmitter, Uri, Range, Selection, TabInputTextDiff, ViewColumn: { One: 1 }, TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
    FileSystemError: { FileNotFound: message => new Error(message) },
    workspace: {
      textDocuments: docs,
      onDidChangeTextDocument: fn => { docListeners.add(fn); return { dispose:()=>docListeners.delete(fn) }; },
      registerTextDocumentContentProvider: (scheme, p) => {
        assert.equal(scheme,'incontrol-edit-diff');provider=p;
        return p.onDidChange(uri=>setTimeout(()=>{
          const doc=docs.find(d=>d.uri.toString()===uri.toString());
          if(doc) { doc.text=p.provideTextDocumentContent(uri); for(const fn of docListeners)fn({document:doc}); }
        },5));
      },
      openTextDocument: async uri => document(uri),
    },
    window: {
      visibleTextEditors: editors,
      tabGroups: { all: [{ tabs, viewColumn: 1, isActive: true }], onDidChangeTabs: () => ({ dispose() {} }) },
      onDidChangeVisibleTextEditors: fn => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
    },
    commands: { executeCommand: async (...args) => {
      calls.push(args); assert.equal(args[0], 'vscode.diff');
      if (shouldFail) { shouldFail = false; throw new Error('open failed'); }
      const [, left, right] = args;
      const group = api.window.tabGroups.all.find(g => g.viewColumn === args[4].viewColumn);
      if (!group.tabs.some(t => t.input.original.toString() === left.toString() && t.input.modified.toString() === right.toString())) group.tabs.push({ input: new TabInputTextDiff(left, right) });
      const update = () => {
        editors.splice(0, editors.length, ...[left, right].map(uri => ({ document: document(uri), revealRange: r => reveals.push({ uri, range: r }) })));
        for (const fn of listeners) fn(editors);
      };
      if (late) setTimeout(update, 5); else update();
    } },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { exports: module.exports, require: name => name === 'vscode' ? api : require(name), setTimeout, clearTimeout });
  const adapter = new module.exports.EditSnapshotDiff();
  return { adapter, calls, reveals, editors, tabs, listeners, api, docs };
}
const payload = { filepath: 'file:///D:/project/a%20%E4%B8%AD.ts', before: 'a\r\nx\r\ny\r\n', after: 'a\r\n', scope: 'file' };
test('opens two immutable virtual documents with a pinned side-by-side review title', async () => {
  const h = harness(); await h.adapter.show(payload);
  const [, left, right, title, options] = h.calls[0];
  assert.equal(h.adapter.provideTextDocumentContent(left), payload.before);
  assert.equal(h.adapter.provideTextDocumentContent(right), payload.after);
  assert.match(title, /a 中.ts.*Before ↔ After/);
  assert.equal(options.preview, false); assert.equal(options.viewColumn, 1);
  assert.equal(options.preserveFocus, false); assert.equal(options.selection, undefined);
  assert.ok(!left.toString().includes('x\r\n'));
});
test('deleted EOF lines select their original row without reopening a plain editor', async () => {
  const h = harness(); await h.adapter.show({ ...payload, selection: { side: 'before', line: 2 } });
  assert.equal(h.calls[0][4].selection, undefined);
  assert.equal(h.reveals[0].uri.path, '/before/a 中.ts');
  assert.equal(h.reveals[0].range.start.line, 2);
  assert.equal(h.editors[0].selection.start.line, 2);
  assert.equal(h.calls.length, 1);
});
test('added lines select the modified snapshot and clamp invalid coordinates', async () => {
  for (const [line, expected] of [[Infinity,0], [-3,0], [99,1]]) {
    const h = harness(); await h.adapter.show({ ...payload, selection: { side: 'after', line } });
    assert.equal(h.calls[0][4].selection.start.line, expected);
    assert.equal(h.reveals[0].uri.path, '/after/a 中.ts');
  }
});
test('supports empty snapshots and explicitly labels fragment history', async () => {
  const h = harness(); await h.adapter.show({ ...payload, before: '', after: '', scope: 'fragments' });
  assert.equal(h.adapter.provideTextDocumentContent(h.calls[0][1]), '');
  assert.match(h.calls[0][3], /fragments, not full file/);
});
test('different revisions reuse one file tab and refresh both snapshots', async () => {
  const h = harness(); await h.adapter.show(payload);
  await h.adapter.show({ ...payload, after: 'later' });
  await h.adapter.show(payload);
  assert.equal(h.calls[0][1].authority, h.calls[1][1].authority);
  assert.equal(h.tabs.length, 1);
  assert.equal(h.calls[0][1].authority, h.calls[2][1].authority);
  assert.equal(h.adapter.provideTextDocumentContent(h.calls[0][2]), payload.after);
});
test('propagates open errors and allows the next queued click to succeed', async () => {
  const h = harness({ fail: true });
  await assert.rejects(h.adapter.show(payload), /open failed/);
  await h.adapter.show(payload); assert.equal(h.calls.length, 2);
});
test('serializes rapid clicks and handles delayed editor visibility', async () => {
  const h = harness({ late: true });
  await Promise.all([
    h.adapter.show({ ...payload, selection: { side: 'before', line: 2 } }),
    h.adapter.show({ ...payload, selection: { side: 'after', line: 0 } }),
  ]);
  assert.equal(h.reveals[0].uri.path, '/before/a 中.ts');
  assert.equal(h.reveals[1].uri.path, '/after/a 中.ts');
  assert.equal(h.listeners.size, 0);
});
test('rejects missing snapshots instead of guessing content from disk', async () => {
  const h = harness(); await assert.rejects(h.adapter.show({ ...payload, before: undefined }), /Missing edit snapshots/);
  assert.equal(h.calls.length, 0);
});
test('bounds closed snapshots while preserving open tabs, and clears memory on dispose', async () => {
  const h = harness(); await h.adapter.show(payload);
  const old = h.calls[0][1];
  for (let i=0;i<40;i++) {
    h.tabs.splice(1); await h.adapter.show({ ...payload, filepath: `file:///workspace/file${i}.ts`, after: `revision ${i}` });
  }
  assert.equal(h.adapter.provideTextDocumentContent(old), payload.before);
  assert.ok(h.adapter.snapshots.size <= 32);
  h.adapter.dispose(); assert.equal(h.adapter.snapshots.size, 0);
});

// Execute the actual workbench configuration method, not a duplicate policy.
const workbench = readFileSync(new URL('../../../../src/vs/workbench/browser/parts/editor/textDiffEditor.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('diff.ts', workbench, ts.ScriptTarget.Latest, true);
let method;
const visit = n => { if (ts.isMethodDeclaration(n) && n.name.getText(file) === 'computeConfiguration') method = n.getText(file); ts.forEachChild(n, visit); };
visit(file); assert.ok(method);
const configCode = ts.transpileModule(`class Adapter extends Base { ${method} }; globalThis.adapter = new Adapter();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
test('forces split layout only for INCONTROL snapshot pairs and does not write settings', () => {
  class DiffEditorInput { constructor(a,b) { this.original={resource:{scheme:a}};this.modified={resource:{scheme:b}}; } }
  const ctx = { Base: class { computeConfiguration() { return {}; } }, DiffEditorInput, deepClone: v => structuredClone(v), isObject: v => !!v && typeof v === 'object' };
  vm.runInNewContext(configCode, ctx);
  const config = { diffEditor: { renderSideBySide:false, useInlineViewWhenSpaceIsLimited:true, ignoreTrimWhitespace:true } };
  ctx.adapter.input = new DiffEditorInput('incontrol-edit-diff','incontrol-edit-diff');
  const result = ctx.adapter.computeConfiguration(config);
  assert.equal(result.renderSideBySide, true); assert.equal(result.useInlineViewWhenSpaceIsLimited, false);
  assert.equal(result.ignoreTrimWhitespace, false); assert.equal(config.diffEditor.renderSideBySide, false);
  for (const [a,b] of [['file','file'],['incontrol-edit-diff','file']]) {
    ctx.adapter.input = new DiffEditorInput(a,b); assert.equal(ctx.adapter.computeConfiguration(config).renderSideBySide, false);
  }
});

const ideSource = readFileSync(new URL('../VsCodeIde.ts', import.meta.url), 'utf8');
const ideFile = ts.createSourceFile('ide.ts', ideSource, ts.ScriptTarget.Latest, true);
const methods = [];
const walk = n => { if (ts.isMethodDeclaration(n) && ['getPinnedFiles','getCurrentFile','onDidChangeActiveTextEditor'].includes(n.name.getText(ideFile))) methods.push(n.getText(ideFile)); ts.forEachChild(n, walk); };
walk(ideFile);
const ideCode = ts.transpileModule(`class Adapter { ${methods.join('\n')} }; globalThis.adapter = new Adapter();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
test('snapshot reviews do not become live-file context and pinned diff tabs do not crash', async () => {
  class TabInputText { constructor(uri) { this.uri=uri; } }
  const uri = scheme => ({ scheme, toString: () => `${scheme}:///a.ts` });
  const api = { TabInputText, window: {
    activeTextEditor: { document: { uri: uri('incontrol-edit-diff') } },
    tabGroups: { all: [{ tabs: [{ isPinned:true, input:{} }, { isPinned:true, input:new TabInputText(uri('file')) }, { isPinned:true,input:new TabInputText(uri('incontrol-edit-diff')) }] }] },
    onDidChangeActiveTextEditor: fn => { api.fire=fn; },
  } };
  const ctx = { vscode:api }; vm.runInNewContext(ideCode,ctx);
  assert.equal(await ctx.adapter.getCurrentFile(),undefined);
  assert.deepEqual(Array.from(await ctx.adapter.getPinnedFiles()),['file:///a.ts']);
  const events=[]; ctx.adapter.onDidChangeActiveTextEditor(u=>events.push(u));
  api.fire({document:{uri:uri('incontrol-edit-diff')}}); api.fire({document:{uri:uri('file')}});
  assert.deepEqual(events,['file:///a.ts']);
  api.window.activeTextEditor={document:{uri:uri('file'),isUntitled:false,getText:()=> 'live'}};
  assert.equal((await ctx.adapter.getCurrentFile()).contents,'live');
});

test('reuses a diff moved to another group and waits for new line counts before revealing', async () => {
  const h = harness(); await h.adapter.show(payload);
  h.api.window.tabGroups.all.push({ tabs:h.tabs.splice(0), viewColumn:2, isActive:false });
  await h.adapter.show({ ...payload, before:'old\n', after:'a\nb\nc\nd\n', selection:{side:'after',line:3} });
  assert.equal(h.calls[1][4].viewColumn,2);
  assert.equal(h.tabs.length,0);
  assert.equal(h.api.window.tabGroups.all[1].tabs.length,1);
  assert.equal(h.reveals.at(-1).range.start.line,3);
  assert.equal(h.editors[1].document.getText(),'a\nb\nc\nd\n');
});
test('same filename in different directories has distinct review tabs', async () => {
  const h = harness(); await h.adapter.show(payload);
  await h.adapter.show({ ...payload, filepath:'file:///another/a%20%E4%B8%AD.ts' });
  assert.notEqual(h.calls[0][1].authority,h.calls[1][1].authority);
  assert.equal(h.tabs.length,2);
});
