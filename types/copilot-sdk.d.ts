/**
 * Ambient declarations for the GitHub Copilot canvas SDK.
 *
 * The SDK is injected by the Copilot app at runtime and is not an npm
 * dependency — there is nothing to install and therefore nothing to import
 * types from. This declares the narrow surface the extension actually uses so
 * the host still typechecks.
 *
 * The canvas API is marked `@experimental` upstream. Keeping our dependency on
 * it this small, and confined to the two host files, is deliberate: when it
 * changes, the blast radius is one declaration file and one entrypoint, not
 * the feature.
 */
declare module "@github/copilot-sdk/extension" {
	export interface CanvasActionContext<TInput = Record<string, unknown>> {
		input: TInput;
		extensionId: string;
		canvasId: string;
		instanceId: string;
	}

	export interface CanvasAction {
		name: string;
		description: string;
		inputSchema: Record<string, unknown>;
		handler: (ctx: CanvasActionContext<any>) => unknown | Promise<unknown>;
	}

	export interface CanvasOpenResult {
		url: string;
		title: string;
		status?: string;
	}

	export interface CanvasDefinition {
		id: string;
		displayName: string;
		description: string;
		inputSchema?: Record<string, unknown>;
		actions?: CanvasAction[];
		open: (ctx: CanvasActionContext<any>) => Promise<CanvasOpenResult> | CanvasOpenResult;
		onClose?: (ctx: CanvasActionContext<any>) => Promise<void> | void;
	}

	export interface Canvas {
		id: string;
	}

	export interface Session {
		/** Push a turn into the conversation — the canvas-to-model direction. */
		send: (message: { prompt: string }) => void;
		rpc: {
			canvas: {
				open: (args: Record<string, unknown>) => Promise<unknown>;
			};
		};
	}

	export function createCanvas(definition: CanvasDefinition): Canvas;
	export function joinSession(options: { canvases: Canvas[] }): Promise<Session>;
}
