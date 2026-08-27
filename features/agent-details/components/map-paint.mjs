/**
 * The paint for the access graph: the dotted background, the edges, and the
 * node discs with their glyphs, badges and labels.
 *
 * Mutates only the context it is handed; every colour arrives pre-resolved.
 * Ported from the Security-UX `relationshipMapPaint.ts`.
 *
 * ### Draw order is the design
 *
 * Edges first, then nodes, then labels — and the order is not incidental. Edges
 * under nodes is what lets an edge be trimmed to a disc's rim and still look
 * connected; labels last is what stops a node drawn afterwards from covering
 * the name of the one before it. A renderer that painted each node together
 * with its own label would have labels disappearing under unrelated discs
 * depending only on iteration order — the kind of bug that looks like a data
 * problem.
 *
 * ### The loading placeholder is this same paint
 *
 * A map that is still fetching draws its nodes as neutral discs with a light
 * travelling across them, from the *same layout* the finished map uses. That is
 * what makes the arrival a cross-fade in place rather than one picture
 * replacing another.
 */
import { worldToScreen } from "../domain/map-camera.mjs";
import { nodeVisibility } from "../domain/map-layout.mjs";
import { paintDotGrid, withAlpha } from "./map-canvas.mjs";
import { drawGlyph, glyphForKind } from "./map-glyphs.mjs";

/** The font stack canvas text is set in, matching the panel's own. */
const FONT_STACK = "'Segoe UI', system-ui, -apple-system, sans-serif";

/** Below this on-screen radius a node is a dot, and its label is noise. */
const LABEL_MIN_RADIUS_PX = 9;

/** Below this on-screen length an edge label cannot be read, so it is skipped. */
const EDGE_LABEL_MIN_PX = 90;

/** How far a faded node is dimmed while something else is focused. */
const DIMMED_ALPHA = 0.22;

/**
 * The width of the shimmer's bright band, as a fraction of the viewport.
 *
 * Wide enough that a node is lit for several frames as the band crosses it — a
 * narrow band reads as a flicker passing over the map rather than as light
 * moving across a surface.
 */
const SHIMMER_BAND = 0.22;

/** How much brighter a node is at the centre of the band than at rest. */
const SHIMMER_LIFT = 0.5;

/**
 * The hue for a node kind.
 *
 * Deliberately a small closed table rather than a generated series: this map
 * has one taxonomy and the reader learns it once. Values are Fluent token
 * references, resolved through the ink at paint time — never used raw, because
 * a `var(--x)` string assigned to `fillStyle` is silently ignored.
 *
 * @type {Record<string, string>}
 */
export const KIND_COLOR = {
	agent: "var(--colorBrandBackground)",
	shield: "var(--colorStatusDangerBackground3)",
	people: "var(--colorBrandForeground2)",
	person: "var(--colorBrandForeground2)",
	cloud: "#a4262c",
	app: "#8764b8",
	key: "#986f0b",
	document: "#0e7a6d",
	globe: "#0f6cbd",
	warning: "var(--colorStatusWarningBorder2)",
};

/**
 * Severity's hue.
 *
 * Severity outranks kind because a reader scans a map for what is *wrong*
 * before they scan it for what things *are* — a critical resource must not be
 * the same violet as a healthy one just because both are storage.
 *
 * @type {Record<1 | 2 | 3, string>}
 */
export const SEVERITY_COLOR = {
	1: "var(--colorStatusWarningBorder2)",
	2: "var(--colorStatusWarningBorder2)",
	3: "var(--colorStatusDangerBackground3)",
};

/**
 * How visible something is, given what is currently focused.
 *
 * Returns 1 when nothing is focused, so the common case pays nothing and the
 * dimming logic exists in exactly one place rather than at each draw site.
 *
 * @param {readonly string[]} ids
 * @param {string | undefined} focusedNodeId
 * @param {ReadonlySet<string> | undefined} neighbours
 * @returns {number}
 */
function alphaFor(ids, focusedNodeId, neighbours) {
	if (!focusedNodeId) return 1;
	const involved = ids.some((id) => id === focusedNodeId || neighbours?.has(id) === true);
	return involved ? 1 : DIMMED_ALPHA;
}

/**
 * @typedef {object} PaintOptions
 * @property {import("../domain/types.js").GraphLayout} layout
 * @property {import("../domain/types.js").Camera} camera
 * @property {import("../domain/types.js").Viewport} view
 * @property {import("./map-canvas.mjs").MapInk} ink
 * @property {string} [selectedNodeId]
 * @property {string} [focusedNodeId] The hovered node; everything it does not touch is dimmed.
 * @property {ReadonlySet<string>} [focusedNeighbours]
 * @property {number} [reveal] How far the real map has arrived: 0 none, 1 all.
 * @property {{ alpha: number, sweep: number, animate: boolean }} [placeholder]
 */

/**
 * Draw one edge, plus its label if there is room for it.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../domain/types.js").PositionedEdge} edge
 * @param {PaintOptions} options
 */
function paintEdge(ctx, edge, options) {
	const { layout, camera, view, ink, focusedNodeId, focusedNeighbours } = options;
	const from = worldToScreen(camera, view, edge.x1, edge.y1);
	const to = worldToScreen(camera, view, edge.x2, edge.y2);

	// An edge is only as visible as its fainter end, so a connector never
	// outlives the child it leads to and never arrives before it.
	const endVisibility = Math.min(
		...[edge.fromId, edge.toId].map((id) => {
			const end = layout.nodes.find((entry) => entry.id === id);
			return end ? nodeVisibility(layout, end, camera.scale) : 1;
		}),
	);
	if (endVisibility <= 0) return;

	ctx.save();
	ctx.globalAlpha =
		alphaFor([edge.fromId, edge.toId], focusedNodeId, focusedNeighbours) *
		endVisibility *
		(options.reveal ?? 1);
	ctx.strokeStyle = edge.emphasis ? ink.roles.selection : ink.roles.link;
	ctx.lineWidth = Math.max(1, (edge.emphasis ? 2 : 1.25) * Math.min(camera.scale, 2));
	ctx.beginPath();
	ctx.moveTo(from.x, from.y);
	ctx.lineTo(to.x, to.y);
	ctx.stroke();

	const length = Math.hypot(to.x - from.x, to.y - from.y);
	if (edge.label && length >= EDGE_LABEL_MIN_PX) {
		const midX = (from.x + to.x) / 2;
		const midY = (from.y + to.y) / 2;
		ctx.font = `500 11px ${FONT_STACK}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		// A plate rather than a halo here: an edge label sits *on* its own line,
		// so a halo would leave the line running visibly through the text.
		// Clearing a rectangle first is what makes the label read as a break.
		const width = ctx.measureText(edge.label).width + 8;
		ctx.fillStyle = ink.roles.labelHalo;
		ctx.fillRect(midX - width / 2, midY - 8, width, 16);
		ctx.fillStyle = ink.roles.label;
		ctx.fillText(edge.label, midX, midY);
	}
	ctx.restore();
}

/**
 * Draw one node's disc, with its severity ring, badge and glyph.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../domain/types.js").PositionedNode} node
 * @param {PaintOptions} options
 */
function paintNode(ctx, node, options) {
	const { layout, camera, view, ink, selectedNodeId, focusedNodeId, focusedNeighbours } = options;
	const center = worldToScreen(camera, view, node.x, node.y);
	const radius = node.radius * camera.scale;
	if (radius < 0.5) return;

	const severity = node.severity ?? 0;
	const tint =
		severity > 0
			? SEVERITY_COLOR[/** @type {1 | 2 | 3} */ (severity)]
			: node.kind
				? KIND_COLOR[node.kind]
				: undefined;
	// Resolved through the ink rather than used raw: a token is a `var(--x)`
	// string a 2D context silently ignores, leaving the previous fill — which
	// on a fresh context is black.
	const fill = ink.forced ? ink.roles.surface : tint ? ink.resolve(tint) : ink.roles.link;

	ctx.save();
	// Three independent fades multiply: how revealed this node is at the current
	// zoom, how much the hover is dimming everything it does not touch, and how
	// far the map has arrived from its loading placeholder.
	ctx.globalAlpha =
		alphaFor([node.id], focusedNodeId, focusedNeighbours) *
		nodeVisibility(layout, node, camera.scale) *
		(options.reveal ?? 1);

	ctx.beginPath();
	ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
	ctx.fillStyle = fill;
	ctx.fill();

	// Severity is drawn as a *thicker ring*, not only as a redder one. In
	// forced-colors the hue is gone entirely, and a map whose only signal for
	// "this is the serious one" was colour would say nothing there at all.
	if (severity > 0 || node.id === selectedNodeId) {
		ctx.lineWidth = Math.max(1.5, radius * (node.id === selectedNodeId ? 0.16 : 0.06 + severity * 0.03));
		ctx.strokeStyle = node.id === selectedNodeId ? ink.roles.selection : ink.roles.label;
		ctx.stroke();
	}

	// The badge that says how much is inside this node. A node with thirty
	// children and a leaf node look identical otherwise, so nobody would ever
	// discover the drill-down. Drawn as a counter pinned to the lower-right, in
	// the same relationship a notification count has to an app icon — the one
	// convention every reader already knows for "this contains things".
	//
	// It stays up once the children are open: the count is a property of the
	// node, not a hint about a hidden state, and counting discs by eye is
	// exactly the work the badge exists to save.
	if (node.childTotal > 0 && radius >= 7) {
		ctx.save();
		const badgeRadius = Math.max(5, radius * 0.44);
		const badgeX = center.x + radius * 0.78;
		const badgeY = center.y + radius * 0.78;

		ctx.beginPath();
		ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
		// The node's own colour, ringed in the surface, so the badge reads as
		// part of the node rather than as a separate object floating beside it.
		ctx.fillStyle = ink.forced ? ink.roles.label : fill;
		ctx.fill();
		ctx.lineWidth = Math.max(1, badgeRadius * 0.28);
		ctx.strokeStyle = ink.roles.labelHalo;
		ctx.stroke();

		const badgeFont = badgeRadius * 1.15;
		// Below this the digits are unreadable, and a blank disc says less than a
		// plain node would — so the badge collapses to a dot that still carries
		// "there is more here" without pretending to state a number.
		if (badgeFont >= 7) {
			ctx.font = `700 ${badgeFont}px ${FONT_STACK}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillStyle = ink.forced ? ink.roles.surface : ink.roles.glyph;
			ctx.fillText(String(node.childTotal), badgeX, badgeY);
		}
		ctx.restore();
	}

	const glyph = glyphForKind(node.kind);
	// Below this the glyph is a smudge, and a smudge on a coloured dot reads as
	// a rendering fault rather than as an icon.
	if (glyph && radius * 1.05 >= 9) {
		// On the node's own fill, so the glyph is the knockout — the same
		// relationship a Fluent app tile has between its plate and its mark.
		drawGlyph(ctx, glyph, center.x, center.y, radius * 1.05, ink.roles.glyph);
	}

	ctx.restore();
}

/**
 * Draw one node's label, below its disc and haloed so it stays legible.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../domain/types.js").PositionedNode} node
 * @param {PaintOptions} options
 */
function paintNodeLabel(ctx, node, options) {
	const { layout, camera, view, ink, focusedNodeId, focusedNeighbours } = options;
	const radius = node.radius * camera.scale;
	// Below this the label would be a smear beside a dot — worse than nothing,
	// because a dozen of them overlap into an unreadable band.
	if (radius < LABEL_MIN_RADIUS_PX || !node.label) return;

	const center = worldToScreen(camera, view, node.x, node.y);
	const fontSize = Math.min(15, Math.max(10, radius * 0.42));

	ctx.save();
	ctx.globalAlpha =
		alphaFor([node.id], focusedNodeId, focusedNeighbours) *
		nodeVisibility(layout, node, camera.scale) *
		(options.reveal ?? 1);
	ctx.font = `600 ${fontSize}px ${FONT_STACK}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	ctx.lineWidth = 3;
	ctx.lineJoin = "round";
	ctx.strokeStyle = ink.roles.labelHalo;
	ctx.strokeText(node.label, center.x, center.y + radius + 5);
	ctx.fillStyle = ink.roles.label;
	ctx.fillText(node.label, center.x, center.y + radius + 5);
	ctx.restore();
}

/**
 * How lit a point is by the shimmer band currently at `sweep`.
 *
 * A triangular falloff rather than a hard edge: the band has to arrive and
 * leave gradually or it reads as a wipe with a visible boundary, which looks
 * like a rendering fault rather than like light.
 *
 * @param {number} screenX
 * @param {import("../domain/types.js").Viewport} view
 * @param {number} sweep
 * @returns {number}
 */
function shimmerAt(screenX, view, sweep) {
	const position = view.width > 0 ? screenX / view.width : 0;
	const distance = Math.abs(position - sweep);
	return distance >= SHIMMER_BAND ? 0 : 1 - distance / SHIMMER_BAND;
}

/**
 * Draw one node as a neutral placeholder disc, lit by the passing shimmer.
 *
 * The placeholder is the **real layout in neutrals** — same positions, same
 * radii — rather than a stand-in shape, which is the whole reason it does not
 * jump when data lands.
 *
 * Deliberately *without* glyphs, badges, labels, or edges. Each of those is a
 * claim about the data — what kind of thing this is, how many things are inside
 * it, what it connects to — and a placeholder that makes claims is lying rather
 * than waiting. Only the silhouette survives, which is the part the layout can
 * promise before the fetch returns.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../domain/types.js").PositionedNode} node
 * @param {PaintOptions} options
 * @param {{ alpha: number, sweep: number, animate: boolean }} placeholder
 */
function paintPlaceholderNode(ctx, node, options, placeholder) {
	const { layout, camera, view, ink } = options;
	const center = worldToScreen(camera, view, node.x, node.y);
	const radius = node.radius * camera.scale;
	if (radius < 0.5) return;

	// A resting tint a step off the surface, so the placeholder reads as a shape
	// on the map rather than as a hole in it. Derived from the resolved link ink
	// rather than from a second, paler token: a hand-picked pale twin is a
	// colour that stops tracking the theme.
	//
	// Under forced colours it is taken at **full strength**. There are only two
	// inks in that mode and the placeholder is the only content on screen, so
	// halving its alpha would put the one visible shape at half the contrast the
	// mode exists to guarantee — and a canvas is a bitmap, so nothing downstream
	// repairs it.
	const rest = ink.forced ? ink.roles.link : withAlpha(ink.roles.link, 0.5);
	const lit = withAlpha(ink.roles.label, 0.85);
	const glow = placeholder.animate ? shimmerAt(center.x, view, placeholder.sweep) * SHIMMER_LIFT : 0;

	ctx.save();
	ctx.globalAlpha = placeholder.alpha * nodeVisibility(layout, node, camera.scale);
	ctx.beginPath();
	ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
	ctx.fillStyle = rest;
	ctx.fill();

	// The lift is a second fill over the resting one rather than a blend between
	// two colours, so the shimmer cannot alter the placeholder's hue — only how
	// bright it is. In forced-colors it is skipped entirely: there are only two
	// inks, so a "brighter" one would be a different colour with a meaning.
	if (glow > 0 && !ink.forced) {
		ctx.globalAlpha = placeholder.alpha * nodeVisibility(layout, node, camera.scale) * glow;
		ctx.fillStyle = lit;
		ctx.fill();
	}
	ctx.restore();
}

/**
 * Draw the whole access graph for one frame.
 * @param {CanvasRenderingContext2D} ctx
 * @param {PaintOptions} options
 */
export function paintGraph(ctx, options) {
	const { layout, camera, view, ink, placeholder } = options;
	paintDotGrid(ctx, camera, view, withAlpha(ink.roles.grid, 0.9));

	// The placeholder goes *under* the real map rather than instead of it, so
	// the hand-over is a cross-fade in one place: for the frames where both are
	// on screen, the grey shape and the coloured one are the same shape.
	if (placeholder && placeholder.alpha > 0) {
		for (const node of layout.nodes) paintPlaceholderNode(ctx, node, options, placeholder);
	}

	if ((options.reveal ?? 1) <= 0) return;

	for (const edge of layout.edges) paintEdge(ctx, edge, options);
	for (const node of layout.nodes) paintNode(ctx, node, options);
	// Labels last, so no disc can be drawn over a name.
	for (const node of layout.nodes) paintNodeLabel(ctx, node, options);
}
