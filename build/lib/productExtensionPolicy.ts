/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface ProductExtensionPolicy {
	readonly excludedBuiltInExtensions?: readonly string[];
}

export function isBuiltInExtensionExcluded(product: ProductExtensionPolicy, name: string): boolean {
	return product.excludedBuiltInExtensions?.some(id => id.toLowerCase() === name.toLowerCase()) ?? false;
}

/** Both cases are needed on case-sensitive build hosts; runtime dependency folders are untouched. */
export function excludedBuiltInExtensionGlobs(product: ProductExtensionPolicy): string[] {
	return [...new Set((product.excludedBuiltInExtensions ?? []).flatMap(id => [id, id.toLowerCase()]))]
		.map(id => `!.build/extensions/${id}/**`);
}
