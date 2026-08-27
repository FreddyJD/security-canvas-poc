/**
 * Fluent glyphs, drawn onto a `<canvas>`.
 *
 * ### Why this file has to exist
 *
 * The rest of the canvas draws an icon by writing an `<svg>` into a string. A
 * `<canvas>` cannot hold DOM, so a map that wanted the same iconography had two
 * bad options and one good one. The bad ones: rasterise each icon to an image
 * and carry a sprite sheet that goes stale the moment Fluent updates, or draw
 * approximations by hand and have the map's "person" quietly stop matching the
 * "person" in the table beside it.
 *
 * The good one is this: keep the **path data** — the exact `d` string from the
 * matching `@fluentui/react-icons` glyph — and stamp it with `Path2D`. Same
 * artwork, no sprite, no drift, and it stays a vector all the way down so it
 * never blurs at any zoom.
 *
 * ### Every path is authored in the same 20x20 box
 *
 * That is what makes {@link drawGlyph} a single transform rather than a
 * per-icon fudge factor. Fluent's regular-weight icons share a 20-unit
 * `viewBox`, so one scale maps any of them into a disc of any size, centred,
 * with nothing to re-tune when one is swapped.
 *
 * ### The names are shapes, not domain concepts
 *
 * `people`, `cloud`, `bot` — not `owner`, `platform`, `agent`. The map is handed
 * an opaque `kind` it never interprets, so the feature owns the taxonomy and
 * this owns only the artwork. Ported verbatim from the Security-UX
 * `shared/utils/mapGlyphs.ts`.
 */

/** The `viewBox` every path below is authored in. */
const GLYPH_VIEWBOX = 20;

/** The glyph vocabulary, by shape. */
export const GLYPH_PATHS = {
	/** A person: an owner, an assignee, an author. */
	person:
		"M10 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM7 6a3 3 0 1 1 6 0 3 3 0 0 1-6 0Zm-2 5a2 2 0 0 0-2 2c0 1.7.83 2.97 2.13 3.8A9.14 9.14 0 0 0 10 18c1.85 0 3.58-.39 4.87-1.2A4.35 4.35 0 0 0 17 13a2 2 0 0 0-2-2H5Zm-1 2a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1c0 1.3-.62 2.28-1.67 2.95A8.16 8.16 0 0 1 10 17a8.16 8.16 0 0 1-4.33-1.05A3.36 3.36 0 0 1 4 13Z",
	/** A group of people: a team, a set of sponsors. */
	people:
		"M10 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM7.5 4.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0Zm8-.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm-2 1a2 2 0 1 1 4 0 2 2 0 0 1-4 0Zm-10 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm1-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm.6 12H5a2 2 0 0 1-2-2V9.25c0-.14.11-.25.25-.25h1.76c.04-.37.17-.7.37-1H3.25C2.56 8 2 8.56 2 9.25V13a3 3 0 0 0 3.4 2.97 4.96 4.96 0 0 1-.3-.97Zm9.5.97A3 3 0 0 0 18 13V9.25C18 8.56 17.44 8 16.75 8h-2.13c.2.3.33.63.37 1h1.76c.14 0 .25.11.25.25V13a2 2 0 0 1-2.1 2c-.07.34-.17.66-.3.97ZM7.25 8C6.56 8 6 8.56 6 9.25V14a4 4 0 0 0 8 0V9.25C14 8.56 13.44 8 12.75 8h-5.5ZM7 9.25c0-.14.11-.25.25-.25h5.5c.14 0 .25.11.25.25V14a3 3 0 1 1-6 0V9.25Z",
	/** A robot head: an autonomous or non-human actor. */
	bot: "M9.5 2.5a.5.5 0 0 1 1 0V4h2A2.5 2.5 0 0 1 15 6.5v6a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 5 12.5v-6A2.5 2.5 0 0 1 7.5 4h2V2.5ZM7.5 5A1.5 1.5 0 0 0 6 6.5v6A1.5 1.5 0 0 0 7.5 14h5a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 12.5 5h-5ZM3 8.5a.5.5 0 0 1 1 0v3a.5.5 0 0 1-1 0v-3Zm13 0a.5.5 0 0 1 1 0v3a.5.5 0 0 1-1 0v-3ZM8.75 8.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm2.5 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5ZM8 11.5h4a.5.5 0 0 1 0 1H8a.5.5 0 0 1 0-1Z",
	/** A cloud: a hosted service, a tenant-scoped resource. */
	cloud:
		"M10 4c2.82 0 4.41 1.92 4.65 4.25h.07A3.33 3.33 0 0 1 18 11.62 3.33 3.33 0 0 1 14.72 15H5.28A3.33 3.33 0 0 1 2 11.62c0-1.8 1.37-3.27 3.1-3.37h.25C5.6 5.9 7.18 4 10 4Zm0 1C7.89 5 6.55 6.32 6.35 8.35a1 1 0 0 1-1 .9h-.07A2.33 2.33 0 0 0 3 11.62 2.33 2.33 0 0 0 5.28 14h9.44A2.33 2.33 0 0 0 17 11.62a2.33 2.33 0 0 0-2.28-2.37h-.07a1 1 0 0 1-1-.9C13.45 6.32 12.11 5 10 5Z",
	/** A key: a permission, a credential, a secret. */
	key: "M15 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-2.5-4a5.45 5.45 0 0 0-5.38 6.67c.06.27 0 .5-.14.64l-4.54 4.54A1.5 1.5 0 0 0 2 14.91v1.59c0 .83.67 1.5 1.5 1.5h2c.83 0 1.5-.67 1.5-1.5V16h1a1 1 0 0 0 1-1v-1h1a1 1 0 0 0 1-1v-.18c.5.13 1 .18 1.5.18 3.08 0 5.5-2.42 5.5-5.5S15.58 2 12.5 2ZM8 7.5C8 4.98 9.98 3 12.5 3S17 4.98 17 7.5 15.02 12 12.5 12c-.66 0-1.27-.1-1.78-.35a.5.5 0 0 0-.72.45v.9H9a1 1 0 0 0-1 1v1H7a1 1 0 0 0-1 1v.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-1.59a.5.5 0 0 1 .15-.35l4.54-4.54c.43-.43.52-1.04.4-1.56-.06-.3-.09-.63-.09-.96Z",
	/** A document: a file, a record, a report. */
	document:
		"M6 2a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7.41c0-.4-.16-.78-.44-1.06l-3.91-3.91A1.5 1.5 0 0 0 10.59 2H6ZM5 4a1 1 0 0 1 1-1h4v3.5c0 .83.67 1.5 1.5 1.5H15v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4Zm9.8 3h-3.3a.5.5 0 0 1-.5-.5V3.2L14.8 7Z",
	/** A shield: an identity, a control, a policy. */
	shield:
		"M9.72 2.08a.5.5 0 0 1 .56 0c1.94 1.3 4.03 2.1 6.3 2.43A.5.5 0 0 1 17 5v4.5c0 3.9-2.3 6.73-6.82 8.47a.5.5 0 0 1-.36 0C5.31 16.23 3 13.39 3 9.5V5a.5.5 0 0 1 .43-.5 15.05 15.05 0 0 0 6.3-2.42ZM9.6 3.35A15.97 15.97 0 0 1 4 5.43V9.5c0 3.4 1.97 5.86 6 7.46 4.03-1.6 6-4.07 6-7.46V5.43a15.97 15.97 0 0 1-5.6-2.08L10 3.1l-.4.25Z",
	/** A warning triangle: something needing attention. */
	warning:
		"M7.37 3.56a3 3 0 0 1 5.26 0l5.5 10A3 3 0 0 1 15.5 18h-11a3 3 0 0 1-2.63-4.44l5.5-10Zm4.38.48a2 2 0 0 0-3.5 0l-5.5 10A2 2 0 0 0 4.5 17h11a2 2 0 0 0 1.75-2.96l-5.5-10ZM10 12.75a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm0-6.25c.28 0 .5.22.5.5v4a.5.5 0 0 1-1 0V7c0-.28.22-.5.5-.5Z",
	/** A globe: something reachable from outside the tenant. */
	globe:
		"M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm3.16 11H6.84c.6 2.16 1.7 4 3.16 4s2.56-1.84 3.16-4Zm-8.9 0H3.6a7.02 7.02 0 0 0 3.62 3.44A11.1 11.1 0 0 1 5.8 13H4.26Zm11.94 0h-1.94c-.35 1.4-.86 2.6-1.48 3.44A7.02 7.02 0 0 0 16.4 13ZM3.23 8a7.04 7.04 0 0 0 0 4h2.35a17.6 17.6 0 0 1 0-4H3.23Zm3.36 0a16.3 16.3 0 0 0 0 4h6.82a16.3 16.3 0 0 0 0-4H6.59Zm7.83 0a17.6 17.6 0 0 1 0 4h2.35a7.04 7.04 0 0 0 0-4h-2.35ZM7.22 3.56A7.02 7.02 0 0 0 3.6 7h1.98c.35-1.4.86-2.6 1.48-3.44H7.22ZM10 3c-1.46 0-2.56 1.84-3.16 4h6.32C12.56 4.84 11.46 3 10 3Zm2.78.56c.62.84 1.13 2.04 1.48 3.44h1.98a7.02 7.02 0 0 0-3.46-3.44Z",
	/** A generic app tile: something with no more specific shape. */
	app: "M4.5 3A1.5 1.5 0 0 0 3 4.5v11A1.5 1.5 0 0 0 4.5 17h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 15.5 3h-11ZM4 4.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11Zm2.5 1A1.5 1.5 0 0 0 5 7v1.5A1.5 1.5 0 0 0 6.5 10h7A1.5 1.5 0 0 0 15 8.5V7a1.5 1.5 0 0 0-1.5-1.5h-7ZM6 7a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v1.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5V7Z",
};

/** @typedef {keyof typeof GLYPH_PATHS} Glyph */

/**
 * The glyph each node `kind` is drawn with.
 *
 * The feature's taxonomy, mapped onto the shared shape vocabulary. Kept beside
 * the paths rather than in the adapter so the map's two halves — what a kind
 * means and what it looks like — are one file to read.
 *
 * @type {Record<string, Glyph>}
 */
export const KIND_GLYPHS = {
	agent: "bot",
	people: "people",
	person: "person",
	shield: "shield",
	document: "document",
	blueprint: "document",
	key: "key",
	app: "app",
	device: "app",
	cloud: "cloud",
	globe: "globe",
	warning: "warning",
};

/**
 * Resolve a node kind to its glyph, or `undefined` when unmapped.
 * @param {string | undefined} kind
 * @returns {Glyph | undefined}
 */
export function glyphForKind(kind) {
	return kind ? KIND_GLYPHS[kind] : undefined;
}

/**
 * `Path2D` objects are cached because building one parses the path string, and
 * the map re-stamps the same handful of glyphs on every frame of a drag.
 * Parsing a few hundred identical paths per frame is the kind of cost that only
 * ever shows up as a gesture that feels heavy, never as an error.
 *
 * Safe to cache, unlike a colour: a path is geometry and has no relationship to
 * the theme. `Path2D` is guarded because it does not exist in Node, where these
 * modules are also imported by the tests.
 *
 * @type {Map<string, any>}
 */
const PATH_CACHE = new Map();

/** @param {Glyph} glyph */
function pathFor(glyph) {
	const cached = PATH_CACHE.get(glyph);
	if (cached !== undefined) return cached;
	let built = null;
	try {
		built = typeof Path2D === "undefined" ? null : new Path2D(GLYPH_PATHS[glyph]);
	} catch {
		// A canvas-less environment must not take the surface down; the map
		// simply draws without its glyphs.
		built = null;
	}
	PATH_CACHE.set(glyph, built);
	return built;
}

/**
 * Stamp a glyph centred on a point, fitted to a `box`-sized square.
 *
 * The transform is saved and restored around the stamp rather than inverted
 * afterwards. Inverting looks equivalent and is not: floating-point error
 * accumulates across a few hundred nodes, so by the bottom of a large map
 * everything is drawn fractionally off — a blur that appears only on big
 * estates and is invisible on the small ones anyone tests with.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Glyph} glyph
 * @param {number} centerX
 * @param {number} centerY
 * @param {number} box
 * @param {string} color
 */
export function drawGlyph(ctx, glyph, centerX, centerY, box, color) {
	const path = pathFor(glyph);
	if (!path) return;
	const scale = box / GLYPH_VIEWBOX;
	ctx.save();
	ctx.translate(centerX - box / 2, centerY - box / 2);
	ctx.scale(scale, scale);
	ctx.fillStyle = color;
	ctx.fill(path);
	ctx.restore();
}
