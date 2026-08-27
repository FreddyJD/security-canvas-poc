/**
 * The camera the access graph is looked through.
 *
 * Ported from the Security-UX `shared/utils/mapCamera.ts`. Pure arithmetic:
 * nothing here touches a canvas, an element, or `window`. That is not
 * fastidiousness — it is what makes the tricky parts (keeping the point under
 * the cursor pinned while the scale changes, interpolating a zoom so it reads
 * as a glide, choosing which grid to draw) testable in Node, where there is no
 * canvas at all.
 *
 * ### World coordinates
 *
 * The layout assigns positions in **world** units and never thinks about
 * pixels. The camera is the only thing that knows how a world unit maps to a
 * screen pixel, which is what lets the layout be a pure function of its data
 * and be drawn at any zoom without recomputing it.
 *
 * Every function returns a **new** camera. A camera is passed through render
 * closures and animation frames, and one mutation in the wrong place produces a
 * view that is subtly wrong only after a specific gesture — the worst kind of
 * bug to find in a paint loop.
 *
 * @typedef {import("./types.js").Bounds} Bounds
 * @typedef {import("./types.js").Camera} Camera
 * @typedef {import("./types.js").Viewport} Viewport
 */

/**
 * How far in and out the map may be zoomed.
 *
 * The floor stops the map being dragged into a state where its content is a
 * handful of pixels in an empty grid with no cue about which way back is. The
 * ceiling is generous because zooming *in* is how this map reveals detail — a
 * cluster opens into its members well past 1:1 — and a ceiling that clamps
 * mid-gesture reads as the map jamming rather than as a limit.
 */
export const MIN_SCALE = 0.15;
export const MAX_SCALE = 40;

/**
 * What one press of the zoom button multiplies the scale by.
 *
 * 1.6 rather than 2: a doubling per click overshoots what someone is aiming at
 * often enough that they spend the next click going back, and that wasted
 * travel is what makes a zoom control feel imprecise.
 */
export const ZOOM_STEP = 1.6;

/** The on-screen spacing, in px, the dotted grid aims to keep between dots. */
export const GRID_TARGET_PX = 46;

/** How sharply one wheel tick maps to a multiplicative zoom factor. */
const WHEEL_SENSITIVITY = 0.0015;

/**
 * Hold a proposed scale inside the allowed range.
 * @param {number} scale
 * @returns {number}
 */
export function clampScale(scale) {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Project a world point onto the screen, in canvas CSS pixels.
 * @param {Camera} camera
 * @param {Viewport} view
 * @param {number} worldX
 * @param {number} worldY
 * @returns {{ x: number, y: number }}
 */
export function worldToScreen(camera, view, worldX, worldY) {
	return {
		x: (worldX - camera.x) * camera.scale + view.width / 2,
		y: (worldY - camera.y) * camera.scale + view.height / 2,
	};
}

/**
 * Project a screen point back into world coordinates.
 * @param {Camera} camera
 * @param {Viewport} view
 * @param {number} screenX
 * @param {number} screenY
 * @returns {{ x: number, y: number }}
 */
export function screenToWorld(camera, view, screenX, screenY) {
	return {
		x: (screenX - view.width / 2) / camera.scale + camera.x,
		y: (screenY - view.height / 2) / camera.scale + camera.y,
	};
}

/**
 * Zoom by `factor` while keeping the world point under `(screenX, screenY)`
 * pinned to that same screen position.
 *
 * This is the whole difference between a map and a picture that gets bigger.
 * Zooming about the *center* means the thing someone is pointing at slides away
 * as they zoom toward it, so they chase it — zoom, pan back, zoom, pan back.
 * Pinning the cursor makes the wheel a direct manipulation of the thing under
 * it, which is why this map needs no "recenter on what I was looking at".
 *
 * @param {Camera} camera
 * @param {Viewport} view
 * @param {number} factor
 * @param {number} screenX
 * @param {number} screenY
 * @returns {Camera}
 */
export function zoomAt(camera, view, factor, screenX, screenY) {
	const world = screenToWorld(camera, view, screenX, screenY);
	const scale = clampScale(camera.scale * factor);
	return {
		scale,
		x: world.x - (screenX - view.width / 2) / scale,
		y: world.y - (screenY - view.height / 2) / scale,
	};
}

/**
 * Pan by a screen-pixel delta — the drag gesture, converted to world units.
 * @param {Camera} camera
 * @param {number} dxPx
 * @param {number} dyPx
 * @returns {Camera}
 */
export function panBy(camera, dxPx, dyPx) {
	return { ...camera, x: camera.x - dxPx / camera.scale, y: camera.y - dyPx / camera.scale };
}

/**
 * Turn a wheel `deltaY` into a multiplicative zoom factor.
 *
 * Exponential rather than linear, because zoom is multiplicative: adding a
 * constant to the scale is a huge jump when zoomed out and imperceptible when
 * zoomed in, so a linear mapping makes the same physical wheel movement mean
 * wildly different things depending on where you already are.
 *
 * @param {number} deltaY
 * @returns {number}
 */
export function wheelZoomFactor(deltaY) {
	return Math.exp(-deltaY * WHEEL_SENSITIVITY);
}

/**
 * The camera that frames `bounds` inside `view`, with room to breathe.
 *
 * `maxScale` caps how far *in* the fit may go, and it is the parameter worth
 * understanding: without it a graph holding three nodes zooms them until they
 * fill the viewport, and a sparse agent renders as three enormous discs.
 * Capping the fit means a small map looks small — the honest picture of it —
 * rather than being inflated to fill the space it was given.
 *
 * @param {Viewport} view
 * @param {Bounds} bounds
 * @param {number} [padding]
 * @param {number} [maxScale]
 * @returns {Camera}
 */
export function fitCamera(view, bounds, padding = 0.86, maxScale = 1.1) {
	const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
	const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
	return {
		x: (bounds.minX + bounds.maxX) / 2,
		y: (bounds.minY + bounds.maxY) / 2,
		scale: clampScale(
			Math.min(Math.min(view.width / worldWidth, view.height / worldHeight) * padding, maxScale),
		),
	};
}

/**
 * Interpolate between two cameras, with the scale interpolated in **log** space.
 *
 * Halfway between 1x and 100x is 10x, not 50x. Interpolating the scale linearly
 * spends most of the animation already deep in the zoom and covers three
 * quarters of the perceived distance in the first few frames, which reads as a
 * lurch followed by a crawl. Log space makes each frame the same *ratio* step,
 * which is what the eye actually measures zoom in.
 *
 * @param {Camera} from
 * @param {Camera} target
 * @param {number} progress
 * @returns {Camera}
 */
export function lerpCamera(from, target, progress) {
	const ratio = Math.max(0, Math.min(1, progress));
	const logFrom = Math.log(from.scale);
	const logTarget = Math.log(target.scale);
	return {
		x: from.x + (target.x - from.x) * ratio,
		y: from.y + (target.y - from.y) * ratio,
		scale: Math.exp(logFrom + (logTarget - logFrom) * ratio),
	};
}

/**
 * True once a camera has arrived close enough that another frame would not
 * change a pixel.
 *
 * The position test is in world units against a fixed epsilon, but the scale
 * test is **relative** — 1e-4 of the target rather than an absolute amount. An
 * absolute epsilon on scale is either never satisfied when zoomed far in or
 * satisfied immediately when zoomed out, so the animation loop would either
 * spin forever or stop visibly short depending only on the current zoom.
 *
 * @param {Camera} camera
 * @param {Camera} target
 * @returns {boolean}
 */
export function cameraSettled(camera, target) {
	return (
		Math.abs(target.x - camera.x) < 0.01 &&
		Math.abs(target.y - camera.y) < 0.01 &&
		Math.abs(target.scale - camera.scale) < target.scale * 1e-4
	);
}

/**
 * Quintic smootherstep — gentle at both ends, for a camera flight.
 * @param {number} progress
 * @returns {number}
 */
export function easeInOut(progress) {
	const eased = Math.max(0, Math.min(1, progress));
	return eased * eased * eased * (eased * (eased * 6 - 15) + 10);
}

const DOT_BASE_RADIUS = 1.3;

/**
 * The two grid layers to draw at the current zoom.
 *
 * A single fixed grid cannot work on an infinite-zoom surface: it either
 * dissolves into a grey wash when you zoom out or spreads into four lonely dots
 * when you zoom in. So the spacing is chosen as a power of two in *world* units
 * such that its on-screen spacing stays near {@link GRID_TARGET_PX}, and a
 * finer layer fades in underneath as the coarse one stretches, then takes over.
 *
 * Powers of two are what make the handover seamless: the finer layer is exactly
 * half the coarse one, so its dots land on the coarse grid's own positions and
 * nothing shifts as the two swap roles.
 *
 * @param {number} scale
 * @returns {{ spacingWorld: number, alpha: number, radius: number }[]}
 */
export function resolveDotGrid(scale) {
	const safeScale = scale > 0 ? scale : MIN_SCALE;
	const cell = Math.pow(2, Math.floor(Math.log2(GRID_TARGET_PX / safeScale)));
	const screen = cell * safeScale;
	const fade = Math.min(1, Math.max(0, (screen - GRID_TARGET_PX / 2) / (GRID_TARGET_PX / 2)));
	return [
		{ spacingWorld: cell * 2, alpha: 1, radius: DOT_BASE_RADIUS },
		{ spacingWorld: cell, alpha: fade, radius: DOT_BASE_RADIUS * fade },
	];
}

/**
 * The bounding box of a set of positioned, round things.
 *
 * An empty set returns a unit box rather than the `±Infinity` an unseeded
 * reduce would produce: `fitCamera` would turn those into `NaN` and paint
 * nothing, with no error to explain why.
 *
 * @param {readonly { x: number, y: number, radius: number }[]} items
 * @param {number} [padBottom] Extra room for the labels drawn under each node.
 * @returns {Bounds}
 */
export function boundsOf(items, padBottom = 0) {
	if (items.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };

	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const item of items) {
		minX = Math.min(minX, item.x - item.radius);
		minY = Math.min(minY, item.y - item.radius);
		maxX = Math.max(maxX, item.x + item.radius);
		maxY = Math.max(maxY, item.y + item.radius + padBottom);
	}
	return { minX, minY, maxX, maxY };
}
