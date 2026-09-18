import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export interface FetchImageArgs {
	url: string;
	detail?: "low" | "high" | "auto";
}

/**
 * Fetches an image from a URL or local path and returns it as a data URL.
 *
 * The tool result channel is text-only, so the image bytes are carried on
 * ContextItem.imageUrl and forwarded to the model as a user image message
 * (see streamResponseAfterToolCall). The text content summarizes what was
 * fetched so the tool call still renders meaningfully in the UI.
 */
export const fetchImageTool: Tool = {
	type: "function",
	displayTitle: "Fetch Image",
	wouldLikeTo: "fetch the following image:",
	isCurrently: "fetching the following image:",
	hasAlready: "fetched the following image:",
	readonly: true,
	isInstant: true,
	group: BUILT_IN_GROUP_NAME,
	function: {
		name: BuiltInToolNames.FetchImage,
		description: `Fetch an image so you can see it directly.

Accepts an http(s) URL or an absolute local file path. The image is returned
to you as an actual image, not text, so use this whenever you need to inspect
visual content (screenshots, diagrams, photos, UI mockups, chart images).

Supported formats: png, jpeg, gif, webp, bmp, svg.

Do not guess at image contents from the URL or filename - fetch it first.`,
		parameters: {
			type: "object",
			required: ["url"],
			properties: {
				url: {
					type: "string",
					description:
						"The image to fetch: an http(s) URL or an absolute local file path.",
				},
				detail: {
					type: "string",
					enum: ["low", "high", "auto"],
					description:
						"Optional detail hint forwarded to the model (low/high/auto). Defaults to auto.",
				},
			},
		},
	},
	defaultToolPolicy: "allowedWithoutPermission",
	systemMessageDescription: {
		prefix: `To look at an image, use the ${BuiltInToolNames.FetchImage} tool with an http(s) URL or an absolute local file path. The image is returned to you visually.

For example, you could respond with:`,
		exampleArgs: [["url", "https://example.com/chart.png"]],
	},
};

