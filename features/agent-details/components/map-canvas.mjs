/**
 * The DOM half of the map: sizing a canvas, and turning theme tokens into the
 * concrete colour strings a 2D context will accept.
 *
 * Separated from `domain/map-camera.mjs` by exactly one line: this file touches
 * `window`, `getComputedStyle` and a real `<canvas>`, and that one does not.
 * The split is what keeps the arithmetic testable without a browser.
 *
 * ### The cached-colour trap
 *
 * Canvas takes colour *strings*. It cannot take `var(--colorNeutralStroke2)`,
 * which is what every token in `platform/design-tokens.mjs` actually is —
 * assigning one to `fillStyle` is **silently ignored**, leaving whatever the
 * previous fill was, which on a fresh context is opaque black. So the map has
 * to resolve tokens to `rgb(...)` at some point, and the moment it does it has
 * created the worst regression this component can have: a colour frozen at
 * light-theme grey that keeps painting after the reader flips to dark.
 *
 * The defence is structural rather than conventional. There is no exported
 * constant holding a resolved colour anywhere in this file. The only way to get
 * one is {@link resolveMapInk}, which *must* be handed a live element and
 * therefore cannot be evaluated at module load, closed over, or frozen into a
 * default. Ink is a function of the DOM at the instant of painting, so a
 * repaint is the only thing that can produce it — and a theme flip that
 * triggers a repaint is correct by construction.
 *
 * ### Forced colours
 *
 * A `<canvas>` is a bitmap, and Windows High Contrast repaints *CSS*. Nothing
 * the OS does will touch what we drew. Rather than ship a second renderer that
 * would drift, forced-colors is treated as just another palette: each ink role
 * has a system-keyword twin, and `CanvasText`/`Canvas`/`Highlight` resolve
 * through `getComputedStyle` to real RGB exactly as a token does.
 *
 * Hue collapses to one ink there, which is the point of the mode — it discards
 * colour deliberately. That is also why every node on this map carries a label.
 */
import { resolveDotGrid, worldToScreen } from "../domain/map-camera.mjs";

/**
 * Get a 2D context, tolerating an environment with no canvas implementation.
 *
 * `getContext` *throws* rather than returning null in some environments, so a
 * plain null check is not enough. Returning null lets the caller skip a paint
 * instead of taking down the panel the map is embedded in.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {CanvasRenderingContext2D | null}
 */
export function safeGetContext(canvas) {
	try {
		return canvas.getContext("2d");
	} catch {
		return null;
	}
}

/**
 * Size a canvas's backing store to its box at the current pixel density.
 *
 * A canvas is a bitmap of fixed pixel size, and backing it at CSS size on a
 * Retina display renders everything at half resolution — the blurry-canvas
 * default. The backing store is set in device pixels and the context is then
 * scaled, so every drawing routine keeps working in CSS pixels and never thinks
 * about density again.
 *
 * The dimensions are written **only when they change**. Assigning `width` or
 * `height` clears the canvas even when the value is identical, so an
 * unconditional write throws away a frame on every repaint — which on a map
 * being dragged is every frame of the gesture.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {import("../domain/types.js").Viewport} view
 * @returns {CanvasRenderingContext2D | null}
 */
export function sizeCanvas(canvas, view) {
	const dpr = Math.max(1, window.devicePixelRatio || 1);
	const width = Math.round(view.width * dpr);
	const height = Math.round(view.height * dpr);
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const ctx = safeGetContext(canvas);
	// `setTransform` is absolute where `scale` is cumulative, so re-scaling a
	// reused context would compound the density on every repaint.
	if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	return ctx;
}

/**
 * The CSS-pixel viewport of an element.
 * @param {HTMLElement} element
 * @returns {import("../domain/types.js").Viewport}
 */
export function viewOf(element) {
	const rect = element.getBoundingClientRect();
	return { width: rect.width, height: rect.height };
}

/**
 * The roles the map paints with, named by job rather than by colour.
 *
 * @typedef {"grid" | "link" | "label" | "labelHalo" | "surface" | "glyph" | "selection"} MapInkRole
 */

/**
 * The parts of the map that are not its data, named by the job they do rather
 * than by the colour they happen to be — so a retheme is a change here and
 * nowhere else.
 *
 * Deliberately **not** annotated as `Record<string, string>`. Under
 * `noUncheckedIndexedAccess` that would make every role lookup `string |
 * undefined`, and a `fillStyle` typed as possibly-undefined would force a cast
 * at each of the fifteen draw sites — which is exactly where a real mistake
 * would then be invisible. Left as a literal, the keys are known and the
 * lookups are plain strings.
 *
 * @satisfies {Record<MapInkRole, string>}
 */
const INK_TOKENS = {
	/** The infinite dotted background. Must recede completely. */
	grid: "var(--colorNeutralStroke2)",
	/** A line drawn between two things. */
	link: "var(--colorNeutralStroke1)",
	/** Text drawn on the map — a node's name, a group's count. */
	label: "var(--colorNeutralForeground1)",
	/** The halo behind that text, so it stays legible over whatever it crosses. */
	labelHalo: "var(--colorNeutralBackground1)",
	/** The face of a drawn object, which a glyph is painted onto. */
	surface: "var(--colorNeutralBackground1)",
	/** A glyph painted on that face. */
	glyph: "#ffffff",
	/** The ring marking the one selected object. */
	selection: "var(--colorBrandStroke1)",
};

/**
 * The forced-colours twin of every role.
 *
 * These are keywords the OS defines, so they follow the reader's own contrast
 * theme rather than ours. `Highlight` is what the platform uses for a selected
 * region, so a selected node matches their own selection colour for free.
 *
 * @satisfies {Record<MapInkRole, string>}
 */
const FORCED_TOKENS = {
	grid: "GrayText",
	link: "CanvasText",
	label: "CanvasText",
	labelHalo: "Canvas",
	surface: "Canvas",
	glyph: "CanvasText",
	selection: "Highlight",
};

/**
 * Turn one CSS colour expression into a concrete `rgb(...)`, by asking the
 * browser what it computes to on a real element in the live themed tree.
 *
 * `color` is the property to borrow because it accepts every form that needs
 * resolving — a `var(--x)` reference, a system keyword, a plain hex — and it is
 * cleared first so an expression that resolves to nothing leaves the inherited
 * colour behind rather than silently reusing the *previous* lookup. The
 * previous value is restored so the probe cannot accumulate state across calls.
 *
 * @param {HTMLElement} probe
 * @param {string} expression
 * @returns {string}
 */
export function resolveInk(probe, expression) {
	const previous = probe.style.color;
	probe.style.color = "";
	probe.style.color = expression;
	const resolved = getComputedStyle(probe).color;
	probe.style.color = previous;
	return resolved || expression;
}

/** True when the OS is currently overriding the page's colours. */
export function forcedColorsActive() {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(forced-colors: active)").matches
	);
}

/**
 * True when the reader has asked for less motion.
 *
 * A canvas has to honour this **by hand**: the stylesheet's reduced-motion
 * block cannot see a `requestAnimationFrame` loop painting a bitmap. Read at
 * call time rather than cached, so a setting changed mid-session takes effect
 * on the next frame that consults it.
 */
export function prefersReducedMotion() {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * @typedef {object} MapInk
 * @property {Record<MapInkRole, string>} roles
 * @property {boolean} forced True when the OS is overriding colours.
 * @property {(expression: string) => string} resolve One arbitrary expression.
 */

/**
 * Resolve the whole non-data palette for one paint.
 *
 * `resolve` is the escape hatch the fixed role table cannot cover, and leaving
 * it out would be a real bug rather than a missing nicety: the map is handed
 * colours it cannot know in advance — a hue per node kind, a severity ramp —
 * and those arrive as `var(--x)` strings that a canvas silently ignores.
 *
 * Handing the resolver out rather than a pre-resolved list is what keeps the
 * no-cached-colour invariant: it is bound to the probe for exactly one paint,
 * so a caller cannot hold onto it and freeze a light-theme hex into a closure.
 *
 * @param {HTMLElement} probe
 * @param {boolean} forced
 * @returns {MapInk}
 */
export function resolveMapInk(probe, forced) {
	const table = forced ? FORCED_TOKENS : INK_TOKENS;
	const roles = /** @type {Record<MapInkRole, string>} */ ({});
	for (const role of /** @type {MapInkRole[]} */ (Object.keys(table))) {
		roles[role] = resolveInk(probe, table[role]);
	}

	// Memoized for the duration of this paint only. Each `resolve` writes a
	// style and reads `getComputedStyle`, which forces a style recalculation —
	// and the map asks for the same handful of kind colours once per drawn
	// object. The cache dies with the paint, so it can never become the stale
	// colour this module is built to prevent.
	/** @type {Map<string, string>} */
	const cache = new Map();

	return {
		roles,
		forced,
		resolve: (expression) => {
			// A caller's hue is precisely what forced-colors is meant to discard.
			if (forced) return roles.link;
			const hit = cache.get(expression);
			if (hit !== undefined) return hit;
			const resolved = resolveInk(probe, expression);
			cache.set(expression, resolved);
			return resolved;
		},
	};
}

/**
 * A resolved `rgb(...)` re-expressed at a given alpha.
 *
 * Fades come from the *resolved* colour rather than from a second, lighter
 * token chosen by hand — a hand-picked pale twin is a colour that stops
 * tracking the theme. The existing alpha is multiplied rather than replaced, so
 * asking for 50% of an already-translucent role cannot make it more opaque.
 *
 * @param {string} color
 * @param {number} alpha
 * @returns {string}
 */
export function withAlpha(color, alpha) {
	const match = /rgba?\(([^)]+)\)/i.exec(color);
	const safe = Math.min(1, Math.max(0, alpha));
	if (!match) return color;
	const parts = String(match[1])
		.split(/[\s,/]+/)
		.map(Number)
		.filter((part) => Number.isFinite(part));
	if (parts.length < 3) return color;
	const existing = parts.length > 3 ? Number(parts[3]) : 1;
	return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${safe * existing})`;
}

/**
 * Paint the infinite dotted background the map sits on.
 *
 * The dots are drawn as **one path with one fill** per layer rather than a fill
 * per dot. At a wide zoom this is a few thousand dots per frame, and a
 * `beginPath`/`fill` pair each would dominate the frame budget during a drag —
 * the difference between a pan that tracks the pointer and one that stutters.
 *
 * The grid is anchored to the **world** origin, not the viewport, which is what
 * makes it read as a surface the map sits on rather than a texture painted on
 * the window: the dots travel with the content when you drag.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../domain/types.js").Camera} camera
 * @param {import("../domain/types.js").Viewport} view
 * @param {string} color
 */
export function paintDotGrid(ctx, camera, view, color) {
	for (const layer of resolveDotGrid(camera.scale)) {
		if (layer.alpha <= 0.02 || layer.radius < 0.25) continue;
		const spacing = layer.spacingWorld * camera.scale;
		// Below a few pixels apart the dots merge into a flat wash, which is
		// strictly worse than no grid — it reads as a background colour change.
		if (spacing < 5) continue;

		const origin = worldToScreen(camera, view, 0, 0);
		const offsetX = ((origin.x % spacing) + spacing) % spacing;
		const offsetY = ((origin.y % spacing) + spacing) % spacing;

		ctx.save();
		ctx.globalAlpha = layer.alpha;
		ctx.fillStyle = color;
		ctx.beginPath();
		for (let x = offsetX; x < view.width + spacing; x += spacing) {
			for (let y = offsetY; y < view.height + spacing; y += spacing) {
				ctx.moveTo(x + layer.radius, y);
				ctx.arc(x, y, layer.radius, 0, Math.PI * 2);
			}
		}
		ctx.fill();
		ctx.restore();
	}
}
