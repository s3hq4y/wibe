/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs';
import path from 'node:path';

/** Preserve signature inspection/removal, but support SDKs installed outside C:. */
export function patchWindowsSdkDiscovery(root: string): void {
	if (process.platform !== 'win32') { return; }
	const file = path.join(root, 'node_modules/@vscode/gulp-electron/src/win32.js');
	const content = fs.readFileSync(file, 'utf8');
	const marker = '// Wibe: honor the Visual Studio developer environment SDK path.';
	if (content.includes(marker)) { return; }
	const declaration = content.match(/^\s*let windowsSDKDir = .*;$/m)?.[0];
	if (!declaration || !declaration.includes('Windows Kits')) {
		throw new Error('gulp-electron SDK discovery changed; review the compatibility patch');
	}
	const fallback = declaration.trim().replace(/^let windowsSDKDir = /, '').replace(/;$/, '');
	const replacement = `\n  ${marker}\n  let windowsSDKDir = process.env.WindowsSdkDir\n    ? path.join(process.env.WindowsSdkDir, "bin") + path.sep\n    : ${fallback};`;
	fs.writeFileSync(file, content.replace(declaration, replacement));
	console.log('Patched gulp-electron Windows SDK discovery (signature checks preserved)');
}
