import { describe, expect, it } from "vitest";
import { layoutGraph } from "../features/agent-details/domain/map-layout.mjs";
import { paintGraph } from "../features/agent-details/components/map-paint.mjs";
import { withAlpha } from "../features/agent-details/components/map-canvas.mjs";
import type { RelationshipGraph } from "../features/agent-details/domain/types.js";

/**
 * The paint, exercised against a recording stub.
 *
 * A screenshot cannot answer the questions that actually matter here — whether
 * a token reached `fillStyle` unresolved, whether the placeholder leaked a
 * label, whether draw order puts a disc over a name. Each of those produces a
 * picture that looks *plausible* and is wrong, so they are asserted rather than
 * eyeballed.
 */

interface Call {
	op: string;
	args: unknown[];
}

/**
 * A 2D context that records instead of drawing.
 *
 * Deliberately records `fillStyle` as an *assignment* rather than reading it
 * back at the end: the canvas keeps the last value set, so a colour that was
 * never applied and one that was applied then overwritten look identical from
 * the outside.
 */
function stubContext() {
	const calls: Call[] = [];
	const fills: unknown[] = [];
	const strokes: unknown[] = [];
	const alphas: number[] = [];

	const ctx = {
		save: () => calls.push({ op: "save", args: [] }),
		restore: () => calls.push({ op: "restore", args: [] }),
		beginPath: () => calls.push({ op: "beginPath", args: [] }),
		moveTo: (...args: unknown[]) => calls.push({ op: "moveTo", args }),
		lineTo: (...args: unknown[]) => calls.push({ op: "lineTo", args }),
		arc: (...args: unknown[]) => calls.push({ op: "arc", args }),
		fill: () => calls.push({ op: "fill", args: [] }),
		stroke: () => calls.push({ op: "stroke", args: [] }),
		fillRect: (...args: unknown[]) => calls.push({ op: "fillRect", args }),
		fillText: (...args: unknown[]) => calls.push({ op: "fillText", args }),
		strokeText: (...args: unknown[]) => calls.push({ op: "strokeText", args }),
		measureText: (text: string) => ({ width: text.length * 6 }),
		translate: () => undefined,
		scale: () => undefined,
		set fillStyle(value: unknown) {
			fills.push(value);
		},
		set strokeStyle(value: unknown) {
			strokes.push(value);
		},
		set globalAlpha(value: number) {
			alphas.push(value);
		},
		lineWidth: 0,
		font: "",
		textAlign: "",
		textBaseline: "",
		lineJoin: "",
	};

	return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, fills, strokes, alphas };
}

/**
 * Ink resolved the way the browser would, so a token never reaches the canvas.
 *
 * The values are Lithium's, resolved for light: `--colorNeutralStroke2`,
 * `--colorNeutralStroke1`, `--colorNeutralForeground1`,
 * `--colorNeutralBackground1`, `--colorNeutralForegroundOnBrand` and
 * `--colorBrandStroke1` in that order. They are only ever compared against each
 * other, so what matters is that they are seven *distinguishable* strings in
 * `rgb()` form — the shape `getComputedStyle` returns.
 */
const ink = {
	roles: {
		grid: "rgb(217, 223, 232)",
		link: "rgb(199, 209, 222)",
		label: "rgb(27, 33, 45)",
		labelHalo: "rgb(255, 255, 255)",
		surface: "rgb(255, 255, 255)",
		glyph: "rgb(255, 255, 255)",
		selection: "rgb(0, 96, 202)",
	},
	forced: false,
	// A stand-in for the live probe: every caller colour comes back resolved.
	resolve: (expression: string) => (expression.startsWith("var(") ? "rgb(1, 2, 3)" : expression),
};

const camera = { x: 450, y: 310, scale: 1 };
const view = { width: 800, height: 460 };

const graph: RelationshipGraph = {
	rootId: "root",
	nodes: [
		{ id: "root", label: "ira-test-agent", ring: "root", kind: "agent" },
		{ id: "id-1", label: "Identity", ring: "inner", kind: "shield", side: "left", severity: 3 },
		{
			id: "pin",
			label: "Grouped resources",
			ring: "outer",
			kind: "cloud",
			side: "right",
			children: [{ id: "kid", label: "Payments API", ring: "child", kind: "key" }],
		},
	],
	edges: [
		{ fromId: "id-1", toId: "root", emphasis: true },
		{ fromId: "root", toId: "pin", label: "reaches" },
	],
};

const layout = layoutGraph(graph);

describe("paintGraph", () => {
	it("never assigns an unresolved token to the canvas", () => {
		// A `var(--x)` string is *silently ignored* by a 2D context, leaving the
		// previous fill — which on a fresh context is opaque black. That is the
		// single worst failure mode of drawing a themed app onto a canvas, and
		// it produces no error anywhere.
		const { ctx, fills, strokes } = stubContext();
		paintGraph(ctx, { layout, camera, view, ink });

		for (const value of [...fills, ...strokes]) {
			expect(String(value)).not.toContain("var(");
		}
		expect(fills.length).toBeGreaterThan(0);
	});

	it("draws a disc for every node", () => {
		const { ctx, calls } = stubContext();
		paintGraph(ctx, { layout, camera, view, ink });
		// The grid also draws arcs, so count only the ones at a node's radius.
		const radii = calls.filter((c) => c.op === "arc").map((c) => Number(c.args[2]));
		for (const node of layout.nodes) {
			if (node.depth > 0) continue;
			expect(radii.some((r) => Math.abs(r - node.radius * camera.scale) < 0.001)).toBe(true);
		}
	});

	it("labels every node it drew at a readable size", () => {
		const { ctx, calls } = stubContext();
		paintGraph(ctx, { layout, camera, view, ink });
		const texts = calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]));
		expect(texts).toContain("ira-test-agent");
		expect(texts).toContain("Identity");
		expect(texts).toContain("Grouped resources");
	});

	it("paints labels last, so no disc can cover a name", () => {
		// Draw order is the design. A renderer that painted each node with its
		// own label would have names disappearing under unrelated discs
		// depending only on iteration order — a bug that looks like bad data.
		const { ctx, calls } = stubContext();
		paintGraph(ctx, { layout, camera, view, ink });
		const lastFill = calls.map((c) => c.op).lastIndexOf("fill");
		const firstLabel = calls.findIndex((c) => c.op === "strokeText");
		expect(firstLabel).toBeGreaterThan(lastFill);
	});

	it("hides a child at the zoom a fitted map rests at", () => {
		// A fitted graph sits near 0.7, and the map must open with every parent
		// as a single labelled disc rather than already showing its contents.
		const { ctx, calls } = stubContext();
		paintGraph(ctx, { layout, camera: { ...camera, scale: 0.7 }, view, ink });
		expect(calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]))).not.toContain("Payments API");
	});

	it("cross-fades the child in rather than snapping it on", () => {
		// Between the two thresholds the child is drawn at a fractional alpha.
		// A hard threshold here reads as a rendering artifact; the gradual bleed
		// is what makes opening feel like an answer to the gesture.
		const { ctx, alphas, calls } = stubContext();
		paintGraph(ctx, { layout, camera: { ...camera, scale: 1 }, view, ink });
		expect(calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]))).toContain("Payments API");
		expect(alphas.some((a) => a > 0 && a < 1)).toBe(true);
	});

	it("reveals it once the camera has arrived", () => {
		const { ctx, calls } = stubContext();
		paintGraph(ctx, { layout, camera: { ...camera, scale: 6 }, view, ink });
		expect(calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]))).toContain("Payments API");
	});

	it("badges a node that contains things, so the drill-down is discoverable", () => {
		// A node with children and a leaf look identical otherwise, and nobody
		// would ever find the reveal.
		const { ctx, calls } = stubContext();
		paintGraph(ctx, { layout, camera, view, ink });
		expect(calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]))).toContain("1");
	});

	it("draws an edge label only when there is room to read it", () => {
		const { ctx, calls } = stubContext();
		paintGraph(ctx, { layout, camera: { ...camera, scale: 0.2 }, view, ink });
		expect(calls.filter((c) => c.op === "fillText").map((c) => String(c.args[0]))).not.toContain("reaches");
	});

	it("uses the accent for an emphasised edge and the neutral link otherwise", () => {
		const { ctx, strokes } = stubContext();
		paintGraph(ctx, { layout, camera, view, ink });
		expect(strokes).toContain(ink.roles.selection);
		expect(strokes).toContain(ink.roles.link);
	});

	it("dims everything a hover does not touch, rather than hiding it", () => {
		// Hiding would change the map's shape under the pointer and make the
		// reader lose their place.
		const { ctx, alphas } = stubContext();
		paintGraph(ctx, {
			layout,
			camera,
			view,
			ink,
			focusedNodeId: "root",
			focusedNeighbours: new Set(["id-1"]),
		});
		expect(alphas.some((a) => a > 0 && a < 0.3)).toBe(true);
		expect(alphas.some((a) => a === 1)).toBe(true);
	});

	it("draws nothing of the real map while the reveal is at zero", () => {
		const { ctx, calls } = stubContext();
		paintGraph(ctx, { layout, camera, view, ink, reveal: 0, placeholder: { alpha: 1, sweep: 0.5, animate: true } });
		expect(calls.filter((c) => c.op === "fillText")).toHaveLength(0);
	});

	it("makes no claim about the data while it is a placeholder", () => {
		// Glyphs, badges, labels and edges are each a claim — what kind of thing
		// this is, how many are inside, what it connects to. A placeholder that
		// makes claims is lying rather than waiting.
		const { ctx, calls } = stubContext();
		paintGraph(ctx, { layout, camera, view, ink, reveal: 0, placeholder: { alpha: 1, sweep: 0.5, animate: true } });
		expect(calls.filter((c) => c.op === "fillText")).toHaveLength(0);
		expect(calls.filter((c) => c.op === "strokeText")).toHaveLength(0);
		expect(calls.filter((c) => c.op === "lineTo")).toHaveLength(0);
		// The silhouette is still drawn, so the frame is never blank.
		expect(calls.filter((c) => c.op === "arc").length).toBeGreaterThan(0);
	});

	it("cross-fades in place, drawing both pictures during the hand-over", () => {
		const { ctx, calls } = stubContext();
		paintGraph(ctx, { layout, camera, view, ink, reveal: 0.5, placeholder: { alpha: 0.5, sweep: 0.5, animate: true } });
		expect(calls.filter((c) => c.op === "fillText").length).toBeGreaterThan(0);
	});

	it("flattens hue but keeps the severity ring under forced colours", () => {
		// A canvas is a bitmap, so nothing the OS does repairs it. A map whose
		// only signal for "this is the serious one" was colour would say nothing
		// at all there.
		const forced = { ...ink, forced: true, resolve: () => ink.roles.link };
		const { ctx, fills, strokes } = stubContext();
		paintGraph(ctx, { layout, camera, view, ink: forced });
		expect(fills.every((f) => String(f).startsWith("rgb"))).toBe(true);
		expect(strokes).toContain(forced.roles.label);
	});

	it("skips a node that is sub-pixel, rather than drawing a smear", () => {
		const { ctx, calls } = stubContext();
		paintGraph(ctx, { layout, camera, view, ink, reveal: 1 });
		const tiny = stubContext();
		paintGraph(tiny.ctx, { layout, camera: { ...camera, scale: 0.02 }, view, ink });
		expect(tiny.calls.filter((c) => c.op === "arc").length).toBeLessThan(
			calls.filter((c) => c.op === "arc").length,
		);
	});
});

describe("withAlpha", () => {
	it("re-expresses a resolved colour rather than reaching for a paler token", () => {
		// A hand-picked pale twin is a colour that stops tracking the theme.
		expect(withAlpha("rgb(10, 20, 30)", 0.5)).toBe("rgba(10, 20, 30, 0.5)");
	});

	it("multiplies an existing alpha, so a fade cannot make something more opaque", () => {
		expect(withAlpha("rgba(10, 20, 30, 0.5)", 0.5)).toBe("rgba(10, 20, 30, 0.25)");
	});

	it("clamps rather than producing an invalid colour", () => {
		expect(withAlpha("rgb(10, 20, 30)", 4)).toBe("rgba(10, 20, 30, 1)");
		expect(withAlpha("rgb(10, 20, 30)", -1)).toBe("rgba(10, 20, 30, 0)");
	});

	it("passes an unparseable colour through untouched", () => {
		expect(withAlpha("CanvasText", 0.5)).toBe("CanvasText");
	});
});
