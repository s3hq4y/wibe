import fs from "node:fs/promises";
import path from "node:path";
import { ContextItem } from "../..";
import { ToolImpl } from ".";
import { getStringArg } from "../parseArgs";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

const EXT_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".svg": "image/svg+xml",
};

function mimeFromPath(p: string): string | undefined {
	return EXT_MIME[path.extname(p).toLowerCase()];
}

function mimeFromContentType(ct: string | null): string | undefined {
	if (!ct) return undefined;
	const value = ct.split(";")[0].trim().toLowerCase();
	return value.startsWith("image/") ? value : undefined;
}

function isHttpUrl(value: string): boolean {
	return /^https?:\/\//i.test(value);
}

function errorItem(url: string, message: string): ContextItem {
	return {
		name: "Fetch Image",
		description: "Image fetch failed",
		content: `Failed to fetch image "${url}": ${message}`,
		icon: "problems",
	};
}

/**
 * Fetch an image from an http(s) URL or an absolute local path, returning it
 * as a data URL on ContextItem.imageUrl. The text content is a short summary so
 * the tool call renders meaningfully; the actual pixels are forwarded to the
 * model out-of-band via streamResponseAfterToolCall.
 */
export const fetchImageImpl: ToolImpl = async (args, extras) => {
	const url = getStringArg(args, "url");

	try {
		let bytes: Buffer;
		let mime: string | undefined;

		if (isHttpUrl(url)) {
			const response = await extras.fetch(url, { method: "GET" });
			if (!response.ok) {
				return [errorItem(url, `HTTP ${response.status}`)];
			}
			mime = mimeFromContentType(response.headers.get("content-type"));
			const arrayBuffer = await response.arrayBuffer();
			bytes = Buffer.from(arrayBuffer);
		} else {
			const localPath = path.resolve(url);
			const stat = await fs.stat(localPath);
			if (!stat.isFile()) {
				return [errorItem(url, "not a file")];
			}
			if (stat.size > MAX_IMAGE_BYTES) {
				return [
					errorItem(url, `file too large (${stat.size} bytes)`),
				];
			}
			bytes = await fs.readFile(localPath);
			mime = mimeFromPath(localPath);
		}

		if (bytes.length > MAX_IMAGE_BYTES) {
			return [
				errorItem(
					url,
					`image too large (${bytes.length} bytes, max ${MAX_IMAGE_BYTES})`,
				),
			];
		}

		const resolvedMime = mime ?? "image/png";
		const dataUrl = `data:${resolvedMime};base64,${bytes.toString("base64")}`;

		return [
			{
				name: "Fetched Image",
				description: `${resolvedMime}, ${bytes.length} bytes`,
				content: `Fetched image from ${url} (${resolvedMime}, ${bytes.length} bytes). The image is attached visually.`,
				imageUrl: dataUrl,
				uri: isHttpUrl(url) ? { type: "url", value: url } : undefined,
			},
		];
	} catch (e: any) {
		return [errorItem(url, e?.message ?? String(e))];
	}
};

