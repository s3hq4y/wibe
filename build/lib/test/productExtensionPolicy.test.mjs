import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { isBuiltInExtensionExcluded, excludedBuiltInExtensionGlobs } from '../productExtensionPolicy.ts';

const require = createRequire(import.meta.url);
const minimatchModule = require('minimatch');
const matches = minimatchModule.minimatch ?? minimatchModule;
const root = new URL('../../../', import.meta.url);
const text = path => readFileSync(new URL(path, root), 'utf8');
const product = JSON.parse(text('product.json'));
const extension = JSON.parse(text('extensions/incontrol/package.json'));

test('excludes Copilot built-ins case-insensitively, not generic extensions/SDKs', () => {
  for (const id of ['copilot', 'GitHub.copilot', 'github.copilot-chat', 'GITHUB.COPILOT']) assert.equal(isBuiltInExtensionExcluded(product, id), true);
  for (const id of ['incontrol', 'node_modules', 'github-authentication', 'ms-vscode.js-debug']) assert.equal(isBuiltInExtensionExcluded(product, id), false);
});
test('other products are not silently changed', () => {
  assert.equal(isBuiltInExtensionExcluded({}, 'copilot'), false);
  assert.deepEqual(excludedBuiltInExtensionGlobs({}), []);
});
test('final packaging globs reject stale nested files and dotfiles', () => {
  const globs = excludedBuiltInExtensionGlobs(product);
  for (const dir of ['copilot', 'GitHub.copilot', 'GitHub.copilot-chat', 'github.copilot-chat']) {
    for (const file of ['package.json', 'dist/extension.js', '.metadata', 'node_modules/x/index.js']) {
      assert.ok(globs.some(glob => matches(`.build/extensions/${dir}/${file}`, glob.slice(1), { dot: true })));
    }
  }
  for (const path of ['.build/extensions/incontrol/package.json', '.build/extensions/node_modules/@github/copilot-sdk/index.js']) {
    assert.ok(globs.every(glob => !matches(path, glob.slice(1), { dot: true })));
  }
});
test('desktop, remote and dedicated compilation all apply the policy', () => {
  assert.match(text('build/gulpfile.vscode.ts'), /\.\.\.excludedBuiltInExtensionGlobs\(product\)/);
  assert.match(text('build/gulpfile.reh.ts'), /filter\(name => !isBuiltInExtensionExcluded\(product, name\)\)/);
  const builds = text('build/lib/extensions.ts');
  assert.match(builds, /isBuiltInExtensionExcluded\(productJson, 'copilot'\) \|\| !fs.existsSync/);
  assert.match(builds, /filter\(extension => !isBuiltInExtensionExcluded\(productJson, extension.name\)\)/);
});
test('INCONTROL retains its IDs and replaces the right-side default', () => {
  const container = extension.contributes.viewsContainers.secondarySidebar.find(item => item.id === 'incontrol');
  assert.ok(container);
  assert.ok(!extension.contributes.viewsContainers.activitybar?.some(item => item.id === 'incontrol'));
  assert.equal(product.chatReplacement.viewContainer, `workbench.view.extension.${container.id}`);
  assert.equal(extension.contributes.views.incontrol[0].id, 'incontrol.incontrolGUIView');
  assert.equal(extension.contributes.configurationDefaults['workbench.secondarySideBar.defaultVisibility'], 'visible');
  assert.match(text('src/vs/workbench/browser/workbench.contribution.ts'), /product.chatReplacement \? 'visible' : 'visibleInWorkspace'/);
  assert.match(text('src/vs/workbench/api/browser/viewsExtensionPoint.ts'), /isDefault: location === ViewContainerLocation.AuxiliaryBar && this.productService.chatReplacement\?\.viewContainer === id/);
  assert.match(text('src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts'), /isDefault: !product.chatReplacement/);
});
test('product UI hiding cannot be undone by user-level force-hidden calls', () => {
  const source = text('src/vs/workbench/services/chat/common/chatEntitlementService.ts');
  assert.match(source, /if \(productService.chatReplacement\) \{[\s\S]*?Setup.hidden.bindTo\(this.contextKeyService\).set\(true\);[\s\S]*?return;/);
  assert.match(source, /hidden = Boolean\(this.productService.chatReplacement\) \|\| hidden;/);
  assert.match(text('src/vs/workbench/contrib/chat/common/constants.ts'), /OPEN_AGENTS_WINDOW_PRECONDITION[\s\S]*?Setup.hidden.negate\(\)/);
  assert.equal(extension.contributes.configurationDefaults['chat.titleBar.openInAgentsWindow.enabled'], false);
});
test('no Copilot auto-update or pretrusted extension grants remain', () => {
  const grants = Object.values(product.trustedExtensionAuthAccess).flat();
  for (const id of [...grants, ...product.builtInExtensionsEnabledWithAutoUpdates]) assert.doesNotMatch(id, /copilot/i);
  assert.ok(product.defaultChatAgent, 'shared account/startup metadata intentionally retained');
});

test('post-packaging Copilot shims skip the deliberately absent extension', () => {
  for (const file of ['build/gulpfile.vscode.ts', 'build/gulpfile.reh.ts']) {
    const source = text(file).slice(text(file).indexOf('function prepareCopilotRipgrepShimTask'));
    assert.match(source, /return async \(\) => \{\s*if \(isBuiltInExtensionExcluded\(product, 'copilot'\)\) \{\s*return;/);
  }
});
