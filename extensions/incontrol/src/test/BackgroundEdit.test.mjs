import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const transpile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const code=transpile(readFileSync(new URL('../apply/BackgroundEditManager.ts',import.meta.url),'utf8'));
function harness({dirty=false,conflict=false,save=false}={}) {
  const events=[],calls=[];const uri={scheme:'file',toString:()=> 'file:///x.ts'};
  const doc={uri,text:'old 🏆\n',isDirty:dirty,getText(){return this.text;},positionAt:n=>({offset:n}),async save(){calls.push('save'); if(save)return false;this.isDirty=false;return true;}};
  class WorkspaceEdit {replace(...args){this.edit=args;}}
  class Range {constructor(start,end){Object.assign(this,{start,end});}}
  const api={Range,WorkspaceEdit,Uri:{parse:s=>({...uri,scheme:s.split(':')[0]})},
    commands:{executeCommand:async(name,value,active)=>{assert.equal(name,'_wibe.setBackgroundEdit');calls.push(['guard',active]);}},
    workspace:{openTextDocument:async()=>doc,applyEdit:async edit=>{calls.push('write');if(conflict)return false;doc.text=edit.edit[2];doc.isDirty=true;return true;}}};
  const m={exports:{}};vm.runInNewContext(code,{exports:m.exports,require:n=>{assert.equal(n,'vscode');return api;}});
  const manager=new m.exports.BackgroundEditManager(async s=>events.push(s));
  return{manager,doc,events,calls,api};
}
const p={streamId:'s',toolCallId:'t',filepath:'file:///x.ts',text:'new 🏆\n',isSearchAndReplace:true,expectedFileContent:'old 🏆\n'};
const accept={streamId:'s',toolCallId:'t',filepath:p.filepath,background:true};
test('stage is read-only and retains approval before background writes',async()=>{
 const h=harness();await h.manager.stage(p);assert.equal(h.doc.text,p.expectedFileContent);assert.equal(h.calls.length,0);assert.equal(h.events[0].status,'done');assert.equal(h.events[0].background,true);
 await h.manager.resolve(true,accept);assert.equal(h.doc.text,p.text);assert.equal(h.events.at(-1).status,'closed');assert.equal(h.events.at(-1).saved,true);
 assert.deepEqual(h.calls,[['guard',true],'write','save',['guard',false]]);
});
test('reject never changes the document or opens an editor',async()=>{const h=harness();await h.manager.stage(p);await h.manager.resolve(false,accept);assert.equal(h.doc.text,p.expectedFileContent);assert.equal(h.calls.length,0);assert.equal(h.events.at(-1).rejected,true);});
test('protects newer content at staging and acceptance',async()=>{
 const h=harness();h.doc.text='user';await assert.rejects(h.manager.stage(p),/changed/);
 h.doc.text=p.expectedFileContent;await h.manager.stage(p);h.doc.text='user';await h.manager.resolve(true,accept);
 assert.match(h.events.at(-1).error,/Newer changes protected/);assert.equal(h.doc.text,'user');assert.equal(h.calls.length,0);
});
test('workspace edit conflicts are not reported as success',async()=>{const h=harness({conflict:true});await h.manager.stage(p);await h.manager.resolve(true,accept);assert.match(h.events.at(-1).error,/conflict/);assert.equal(h.doc.text,p.expectedFileContent);});
test('failed saves remain dirty and report an error, without opening a source tab',async()=>{const h=harness({save:true});await h.manager.stage(p);await h.manager.resolve(true,accept);assert.match(h.events.at(-1).error,/saving failed/);assert.equal(h.doc.isDirty,true);assert.deepEqual(h.calls.at(-1),['guard',false]);});
test('preserves pre-existing unsaved user buffers',async()=>{const h=harness({dirty:true});await h.manager.stage(p);await h.manager.resolve(true,accept);assert.equal(h.events.at(-1).saved,false);assert.ok(!h.calls.includes('save'));});
test('duplicate and expired accepts cannot fall through to legacy editor-opening code',async()=>{
 const h=harness();await h.manager.stage(p);await h.manager.resolve(true,accept);assert.equal(await h.manager.resolve(true,accept),true);assert.equal(h.calls.filter(c=>c==='write').length,1);
 assert.equal(await h.manager.resolve(true,{...accept,streamId:'expired'}),true);assert.match(h.events.at(-1).error,/expired/);
 assert.equal(await h.manager.resolve(true,{streamId:'manual'}),false);
});
test('parallel edits to the same file cannot stage conflicting snapshots',async()=>{
 const h=harness();const r=await Promise.allSettled([h.manager.stage(p),h.manager.stage({...p,streamId:'other'})]);assert.equal(r.filter(x=>x.status==='rejected').length,1);
});
test('rejects missing snapshots and readonly diff resources',async()=>{
 const h=harness();await assert.rejects(h.manager.stage({...p,expectedFileContent:undefined}),/Missing/);await assert.rejects(h.manager.stage({...p,filepath:'incontrol-edit-diff:///x.ts'}),/readonly/);assert.equal(h.calls.length,0);
});
function method(file,name){const s=readFileSync(file,'utf8'),f=ts.createSourceFile('x.ts',s,ts.ScriptTarget.Latest,true);let result;const visit=n=>{if(ts.isMethodDeclaration(n)&&n.name.getText(f)===name)result=n.getText(f);ts.forEachChild(n,visit);};visit(f);assert.ok(result);return result;}
test('file reads use existing dirty buffers or the filesystem without showing an editor',async()=>{
 const m=method(new URL('../util/ideUtils.ts',import.meta.url),'readFile');const ctx={Buffer,vscode:{workspace:{textDocuments:[],fs:{readFile:async()=>Buffer.from('disk')}}}};
 vm.runInNewContext(transpile(`class Adapter { ${m} }; globalThis.adapter=new Adapter();`),ctx);ctx.adapter.fsOperation=async(uri,fn)=>fn(uri);
 const uri={toString:()=> 'file:///x'};assert.equal((await ctx.adapter.readFile(uri)).toString(),'disk');ctx.vscode.workspace.textDocuments.push({uri,getText:()=> 'unsaved'});assert.equal((await ctx.adapter.readFile(uri)).toString(),'unsaved');
});
test('workbench auto-open guard excludes only explicit background edits',()=>{
 const m=method(new URL('../../../../src/vs/workbench/contrib/files/browser/editors/textFileEditorTracker.ts',import.meta.url),'ensureDirtyTextFilesAreOpened');
 const ctx={distinct:x=>x,TextFileEditorModelState:{PENDING_SAVE:1,ERROR:2},Schemas:{untitled:'untitled'},UntitledTextEditorInput:{ID:'untitled'},FILE_EDITOR_INPUT_ID:'file',DEFAULT_EDITOR_ASSOCIATION:{id:'text'}};
 vm.runInNewContext(transpile(`class Adapter { ${m} }; globalThis.adapter=new Adapter();`),ctx);
 const a=ctx.adapter,bg={scheme:'file',toString:()=> 'bg'},normal={scheme:'file',toString:()=> 'normal'};let opened;
 Object.assign(a,{backgroundEditResources:new Set([bg]),textFileService:{isDirty:()=>true,files:{get:()=>({hasState:()=>false})},untitled:{get:()=>undefined}},filesConfigurationService:{hasShortAutoSaveDelay:()=>false},editorService:{isOpened:()=>false},workingCopyEditorService:{findEditor:()=>undefined},doEnsureDirtyTextFilesAreOpened:x=>{opened=x;}});
 a.ensureDirtyTextFilesAreOpened([bg,normal]);assert.equal(opened.length,1);assert.equal(opened[0],normal);
});
test('legacy diff handling cannot reopen a closed editor or steal focus',async()=>{
 const m=method(new URL('../diff/vertical/handler.ts',import.meta.url),'ensureCurrentFileIsFocused');const uri={toString:()=> 'file:///x'},editor={document:{uri}};
 const ctx={vscode:{window:{visibleTextEditors:[editor]}},URI:{equal:(a,b)=>a===b}};vm.runInNewContext(transpile(`class Adapter { ${m} }; globalThis.adapter=new Adapter();`),ctx);ctx.adapter.editor=editor;await ctx.adapter.ensureCurrentFileIsFocused();ctx.vscode.window.visibleTextEditors=[];await assert.rejects(ctx.adapter.ensureCurrentFileIsFocused(),/closed/);
});

function webviewHandler(name,h) {
 const s=readFileSync(new URL('../extension/VsCodeMessenger.ts',import.meta.url),'utf8');
 const f=ts.createSourceFile('x.ts',s,ts.ScriptTarget.Latest,true);let fn;
 const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(f)==='this.onWebview'&&n.arguments[0]?.text===name)fn=n.arguments[1].getText(f);ts.forEachChild(n,visit);};visit(f);assert.ok(fn);
 h.api.workspace.getWorkspaceFolder=()=>({});
 const ctx={vscode:h.api,undoSnapshotError:(before,after,current)=>current!==undefined&&current!==after?'Conflict':undefined};
 vm.runInNewContext(transpile(`globalThis.handler = ${fn}`),ctx);return ctx.handler;
}
test('completed undo uses a guarded workspace edit without opening an editor',async()=>{
 for(const dirty of [false,true]) {
  const h=harness({dirty});h.doc.text=p.text;
  const result=await webviewHandler('edit/undoCompleted',h)({data:{filepath:p.filepath,before:p.expectedFileContent,after:p.text}});
  assert.equal(result.ok,true);assert.equal(result.saved,!dirty);assert.equal(h.doc.text,p.expectedFileContent);
  assert.deepEqual(h.calls,dirty?[['guard',true],'write',['guard',false]]:[['guard',true],'write','save',['guard',false]]);
 }
});
test('completed undo protects newer content, and legacy restore stays headless',async()=>{
 const h=harness();h.doc.text='user';const result=await webviewHandler('edit/undoCompleted',h)({data:{filepath:p.filepath,before:p.expectedFileContent,after:p.text}});
 assert.equal(result.ok,false);assert.equal(h.calls.length,0);
 await webviewHandler('overwriteFile',h)({data:{filepath:p.filepath,prevFileContent:p.expectedFileContent}});
 assert.equal(h.doc.text,p.expectedFileContent);assert.deepEqual(h.calls,[['guard',true],'write',['guard',false]]);
});
