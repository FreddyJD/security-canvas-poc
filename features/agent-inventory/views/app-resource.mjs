/**
 * The Agents panel, served to hosts that render MCP Apps.
 *
 * MCP Apps (SEP-1865) let a server hand the host an HTML document and have it
 * rendered in a sandboxed iframe beside the model's answer. Claude's desktop
 * app advertises support for it on local stdio servers — which is what this
 * plugin is — so the same Agents screen the Copilot app shows on its canvas can
 * appear in a Claude conversation, from one implementation.
 *
 * Three things keep that honest:
 *
 *   - The markup is `renderInventory`, the function the canvas already uses. A
 *     second implementation would drift, and two security consoles disagreeing
 *     about which agents are risky is worse than one console.
 *
 *   - The document is inlined, not read from disk. Hosts copy dist/mcp.mjs and
 *     run it from wherever they put it; a sibling file is not guaranteed to
 *     travel with it.
 *
 *   - No CSP domains are declared, so the host applies `connect-src 'none'`.
 *     The panel therefore cannot reach Graph, or anything else, on its own. It
 *     refetches by asking the host to call `list_agents` again, which runs here
 *     on the analyst's delegated token — so Entra RBAC remains the authority
 *     over what the panel can show, exactly as for the text tools.
 *
 * Hosts that do not implement MCP Apps ignore the metadata and the resource,
 * and `list_agents` keeps returning the text it always did.
 */

/** The resource the `list_agents` tool points at. */
export const AGENTS_APP_URI = "ui://security-canvas/agents";

/** The MIME type the specification reserves for MCP App HTML. */
export const APP_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * `_meta` marking a tool as rendering the Agents panel.
 *
 * Nested under `ui`, not the flat `ui/resourceUri` key: the flat form is
 * deprecated and slated for removal before GA.
 */
export const AGENTS_APP_META = { ui: { resourceUri: AGENTS_APP_URI } };

/**
 * Register the panel as a readable `ui://` resource.
 *
 * Must run before `server.connect()` — declaring a capability after the
 * transport is attached throws.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {() => Promise<string>} readHtml Supplies the document. Async and
 *   called per read so the generated module is imported lazily — a checkout
 *   that has not been built yet should lose the panel, not fail to start.
 */
export function registerAgentsApp(server, readHtml) {
	server.registerResource(
		"agents-panel",
		AGENTS_APP_URI,
		{
			title: "Agents",
			description:
				"Interactive table of the tenant's AI agents — filter by platform and risk, sort, and open one for detail.",
			mimeType: APP_MIME_TYPE,
		},
		async (uri) => ({
			contents: [
				{
					uri: uri.href,
					mimeType: APP_MIME_TYPE,
					text: await readHtml(),
					// No `csp` block: the default is the restrictive one, and this
					// panel needs no network of its own. Declaring domains here
					// would widen what the sandbox permits for no gain.
					_meta: { ui: { prefersBorder: true } },
				},
			],
		}),
	);
}
