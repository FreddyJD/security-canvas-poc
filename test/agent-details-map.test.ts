import { describe, expect, it } from "vitest";
import {
	MAX_SCALE,
	MIN_SCALE,
	boundsOf,
	cameraSettled,
	clampScale,
	fitCamera,
	lerpCamera,
	panBy,
	resolveDotGrid,
	screenToWorld,
	wheelZoomFactor,
	worldToScreen,
	zoomAt,
} from "../features/agent-details/domain/map-camera.mjs";
import {
	childOpenAmount,
	childTotalOf,
	compareNodes,
	layoutGraph,
	neighboursOf,
	nodeVisibility,
	pickNode,
	radiusForDepth,
	scaleToRevealChildren,
} from "../features/agent-details/domain/map-layout.mjs";
import type { GraphNode, RelationshipGraph } from "../features/agent-details/domain/types.js";

/**
 * The map's arithmetic is the part with the interesting decisions in it, and it
 * is deliberately DOM-free so it can be asserted here — Node has no canvas, and
 * these are exactly the properties a screenshot would not catch.
 */

const view = { width: 800, height: 600 };

const graph = (over: Partial<RelationshipGraph> = {}): RelationshipGraph => ({
	rootId: "root",
	nodes: [
		{ id: "root", label: "Agent", ring: "root", kind: "agent" },
		{ id: "id-1", label: "Identity", ring: "inner", kind: "shield", side: "left" },
		{ id: "own-1", label: "Ira", ring: "inner", kind: "people", side: "left" },
		{ id: "res-1", label: "Storage", ring: "outer", kind: "app", side: "right" },
		{ id: "res-2", label: "Graph", ring: "outer", kind: "key", side: "right" },
	],
	edges: [
		{ fromId: "id-1", toId: "root" },
		{ fromId: "root", toId: "res-1" },
	],
	...over,
});

describe("camera projection", () => {
	it("round-trips a point through screen space", () => {
		const camera = { x: 100, y: 50, scale: 1.7 };
		const screen = worldToScreen(camera, view, 130, 80);
		const world = screenToWorld(camera, view, screen.x, screen.y);
		expect(world.x).toBeCloseTo(130, 6);
		expect(world.y).toBeCloseTo(80, 6);
	});

	it("keeps the point under the cursor pinned while zooming", () => {
		// The whole difference between a map and a picture that gets bigger. If
		// this drifts, the thing you zoom toward slides away and you chase it.
		const camera = { x: 0, y: 0, scale: 1 };
		const cursor = { x: 620, y: 180 };
		const before = screenToWorld(camera, view, cursor.x, cursor.y);
		const zoomed = zoomAt(camera, view, 2.4, cursor.x, cursor.y);
		const after = screenToWorld(zoomed, view, cursor.x, cursor.y);
		expect(after.x).toBeCloseTo(before.x, 6);
		expect(after.y).toBeCloseTo(before.y, 6);
	});

	it("still pins the cursor at the zoom ceiling, where the factor is clamped", () => {
		const camera = { x: 0, y: 0, scale: MAX_SCALE };
		const cursor = { x: 200, y: 400 };
		const before = screenToWorld(camera, view, cursor.x, cursor.y);
		const after = screenToWorld(zoomAt(camera, view, 4, cursor.x, cursor.y), view, cursor.x, cursor.y);
		expect(after.x).toBeCloseTo(before.x, 6);
		expect(after.y).toBeCloseTo(before.y, 6);
	});

	it("holds the scale inside the allowed range", () => {
		expect(clampScale(0.0001)).toBe(MIN_SCALE);
		expect(clampScale(1e6)).toBe(MAX_SCALE);
	});

	it("pans by screen pixels converted to world units, so a drag tracks at any zoom", () => {
		expect(panBy({ x: 0, y: 0, scale: 2 }, 100, 50)).toEqual({ x: -50, y: -25, scale: 2 });
		expect(panBy({ x: 0, y: 0, scale: 0.5 }, 100, 50)).toEqual({ x: -200, y: -100, scale: 0.5 });
	});

	it("maps the wheel exponentially, so the same gesture means the same thing at any zoom", () => {
		// A linear mapping makes one tick a huge jump zoomed out and
		// imperceptible zoomed in.
		const out = wheelZoomFactor(100);
		const back = wheelZoomFactor(-100);
		expect(out * back).toBeCloseTo(1, 9);
		expect(out).toBeLessThan(1);
	});
});

describe("fitCamera", () => {
	it("caps how far in a sparse graph is inflated", () => {
		// Three nodes must not be blown up to fill the frame; a small map looking
		// small is the honest picture of it.
		const camera = fitCamera(view, { minX: 440, minY: 300, maxX: 460, maxY: 320 });
		expect(camera.scale).toBeLessThanOrEqual(1.1);
	});

	it("centres on the bounds it was given", () => {
		const camera = fitCamera(view, { minX: 0, minY: 0, maxX: 900, maxY: 620 });
		expect(camera.x).toBe(450);
		expect(camera.y).toBe(310);
	});
});

describe("boundsOf", () => {
	it("counts each item's radius, so 'fit' does not clip the outermost node", () => {
		expect(boundsOf([{ x: 100, y: 100, radius: 20 }])).toEqual({ minX: 80, minY: 80, maxX: 120, maxY: 120 });
	});

	it("leaves room below for the labels drawn under each node", () => {
		expect(boundsOf([{ x: 0, y: 0, radius: 10 }], 24).maxY).toBe(34);
	});

	it("returns a unit box for an empty set rather than infinities", () => {
		// ±Infinity would become NaN in fitCamera and paint nothing, with no
		// error to explain why.
		expect(boundsOf([])).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
	});
});

describe("lerpCamera", () => {
	it("interpolates scale in log space, so halfway between 1x and 100x is 10x", () => {
		// Linear interpolation covers three quarters of the perceived distance in
		// the first few frames, which reads as a lurch followed by a crawl.
		const mid = lerpCamera({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0, scale: 100 }, 0.5);
		expect(mid.scale).toBeCloseTo(10, 6);
	});

	it("clamps progress, so an overshooting frame cannot fly past the target", () => {
		const past = lerpCamera({ x: 0, y: 0, scale: 1 }, { x: 10, y: 0, scale: 2 }, 1.8);
		expect(past.x).toBe(10);
		expect(past.scale).toBeCloseTo(2, 9);
	});
});

describe("cameraSettled", () => {
	it("tests scale relatively, so the loop neither spins nor stops short", () => {
		// An absolute epsilon on scale is never satisfied when zoomed far in and
		// satisfied immediately when zoomed out.
		expect(cameraSettled({ x: 0, y: 0, scale: 30 }, { x: 0, y: 0, scale: 30.001 })).toBe(true);
		expect(cameraSettled({ x: 0, y: 0, scale: 0.2 }, { x: 0, y: 0, scale: 0.201 })).toBe(false);
	});
});

describe("resolveDotGrid", () => {
	it("keeps the on-screen density roughly constant at any zoom", () => {
		// A single fixed grid dissolves into a wash zoomed out and spreads into
		// four lonely dots zoomed in.
		for (const scale of [0.2, 0.7, 1, 4, 20]) {
			const [coarse] = resolveDotGrid(scale);
			const screen = (coarse?.spacingWorld ?? 0) * scale;
			expect(screen).toBeGreaterThan(40);
			expect(screen).toBeLessThan(200);
		}
	});

	it("makes the finer layer exactly half the coarse one, so the handover is seamless", () => {
		const [coarse, fine] = resolveDotGrid(1);
		expect((coarse?.spacingWorld ?? 0) / 2).toBe(fine?.spacingWorld);
	});
});

describe("layoutGraph", () => {
	it("puts the root at the centre and everything else on its rings", () => {
		const layout = layoutGraph(graph());
		const root = layout.nodes.find((n) => n.id === "root");
		expect(root?.x).toBe(450);
		expect(root?.y).toBe(310);
		expect(layout.nodes).toHaveLength(5);
	});

	it("places sided nodes on their own half of the map", () => {
		const layout = layoutGraph(graph());
		const left = layout.nodes.filter((n) => n.side === "left");
		const right = layout.nodes.filter((n) => n.side === "right");
		expect(left.every((n) => n.x < 450)).toBe(true);
		expect(right.every((n) => n.x > 450)).toBe(true);
	});

	it("is deterministic, so a graph rebuilt from a reordered query does not move", () => {
		const forward = layoutGraph(graph());
		const reversed = layoutGraph(graph({ nodes: [...graph().nodes].reverse() }));
		for (const node of forward.nodes) {
			const twin = reversed.nodes.find((n) => n.id === node.id);
			expect(twin?.x).toBeCloseTo(node.x, 9);
			expect(twin?.y).toBeCloseTo(node.y, 9);
		}
	});

	it("trims each edge to the two discs' rims rather than their centres", () => {
		// Otherwise every line is drawn under the node it points at, which reads
		// as a spike through it the moment anything is translucent.
		const layout = layoutGraph(graph());
		const edge = layout.edges.find((e) => e.fromId === "root" && e.toId === "res-1");
		const root = layout.nodes.find((n) => n.id === "root");
		const target = layout.nodes.find((n) => n.id === "res-1");
		if (!edge || !root || !target) throw new Error("missing");
		expect(Math.hypot(edge.x1 - root.x, edge.y1 - root.y)).toBeCloseTo(root.radius, 6);
		expect(Math.hypot(edge.x2 - target.x, edge.y2 - target.y)).toBeCloseTo(target.radius, 6);
	});

	it("drops an edge whose endpoint is not on the map", () => {
		// A line trailing into empty space is a relationship the reader believes.
		const layout = layoutGraph(graph({ edges: [{ fromId: "root", toId: "ghost" }] }));
		expect(layout.edges).toHaveLength(0);
	});

	it("derives containment edges rather than making the caller declare them", () => {
		const withChild = graph({
			nodes: [
				...graph().nodes,
				{
					id: "pin",
					label: "Grouped",
					ring: "outer",
					side: "right",
					children: [{ id: "kid", label: "Inside", ring: "child" }],
				} as GraphNode,
			],
		});
		const layout = layoutGraph(withChild);
		expect(layout.edges.some((e) => e.fromId === "pin" && e.toId === "kid")).toBe(true);
	});

	it("rescues a stray second root onto the inner ring instead of dropping it", () => {
		const layout = layoutGraph(
			graph({ nodes: [...graph().nodes, { id: "other", label: "Other", ring: "root" }] }),
		);
		expect(layout.nodes.some((n) => n.id === "other")).toBe(true);
	});

	it("terminates on a child that points back at its own ancestor", () => {
		// Malformed but real — a permission that grants a role that contains the
		// permission. Unguarded this is an infinite recursion, not a bad picture.
		const cyclic: GraphNode = { id: "a", label: "A", ring: "outer", children: [] };
		cyclic.children = [{ id: "a", label: "A again", ring: "child" }];
		const layout = layoutGraph(graph({ nodes: [graph().nodes[0] as GraphNode, cyclic] }));
		expect(layout.nodes.some((n) => n.id === "a")).toBe(true);
	});

	it("fans a cluster away from the root, into the space that is guaranteed empty", () => {
		const withChildren = graph({
			nodes: [
				graph().nodes[0] as GraphNode,
				{
					id: "pin",
					label: "Grouped",
					ring: "outer",
					side: "right",
					children: Array.from({ length: 6 }, (_unused, i) => ({
						id: `kid-${i}`,
						label: `Kid ${i}`,
						ring: "child" as const,
					})),
				} as GraphNode,
			],
		});
		const layout = layoutGraph(withChildren);
		const pin = layout.nodes.find((n) => n.id === "pin");
		const kids = layout.nodes.filter((n) => n.parentId === "pin");
		if (!pin) throw new Error("missing pin");
		expect(kids).toHaveLength(6);
		// Every child sits further from the root than its parent does.
		const pinDistance = Math.hypot(pin.x - 450, pin.y - 310);
		expect(kids.every((kid) => Math.hypot(kid.x - 450, kid.y - 310) > pinDistance)).toBe(true);
	});

	it("carries a whole cluster when its parent is dragged", () => {
		// A branch left behind by its parent would be worse than no dragging.
		const withChildren = graph({
			nodes: [
				graph().nodes[0] as GraphNode,
				{
					id: "pin",
					label: "Grouped",
					ring: "outer",
					children: [{ id: "kid", label: "Inside", ring: "child" }],
				} as GraphNode,
			],
		});
		const still = layoutGraph(withChildren);
		const moved = layoutGraph(withChildren, new Map([["pin", { dx: 40, dy: -25 }]]));
		const kidBefore = still.nodes.find((n) => n.id === "kid");
		const kidAfter = moved.nodes.find((n) => n.id === "kid");
		expect((kidAfter?.x ?? 0) - (kidBefore?.x ?? 0)).toBeCloseTo(40, 6);
		expect((kidAfter?.y ?? 0) - (kidBefore?.y ?? 0)).toBeCloseTo(-25, 6);
	});

	it("resolves an edge to where a dragged node now is, not where it was", () => {
		const moved = layoutGraph(graph(), new Map([["res-1", { dx: 60, dy: 0 }]]));
		const edge = moved.edges.find((e) => e.toId === "res-1");
		const node = moved.nodes.find((n) => n.id === "res-1");
		if (!edge || !node) throw new Error("missing");
		expect(Math.hypot(edge.x2 - node.x, edge.y2 - node.y)).toBeCloseTo(node.radius, 6);
	});
});

describe("compareNodes", () => {
	it("is a total order, so two identical-looking nodes never swap between renders", () => {
		const a: GraphNode = { id: "a", label: "Same", ring: "outer", kind: "app" };
		const b: GraphNode = { id: "b", label: "Same", ring: "outer", kind: "app" };
		expect(compareNodes(a, b)).toBeLessThan(0);
		expect(compareNodes(b, a)).toBeGreaterThan(0);
	});

	it("groups by side first, so an assigned group stays contiguous", () => {
		const left: GraphNode = { id: "z", label: "Z", ring: "inner", side: "left" };
		const right: GraphNode = { id: "a", label: "A", ring: "inner", side: "right" };
		expect(compareNodes(left, right)).toBeLessThan(0);
	});

	it("sorts more severe first within a kind", () => {
		const bad: GraphNode = { id: "b", label: "B", ring: "outer", kind: "app", severity: 3 };
		const fine: GraphNode = { id: "a", label: "A", ring: "outer", kind: "app", severity: 0 };
		expect(compareNodes(bad, fine)).toBeLessThan(0);
	});
});

describe("zoom-driven reveal", () => {
	const parent = {
		id: "pin",
		label: "Pin",
		ring: "outer" as const,
		x: 0,
		y: 0,
		radius: 18,
		depth: 0,
		childTotal: 4,
	};

	it("is closed at the zoom a fitted map rests at", () => {
		// The map must open with every parent as a single labelled disc rather
		// than already showing its contents.
		expect(childOpenAmount(parent, 0.7)).toBe(0);
	});

	it("cross-fades rather than snapping", () => {
		const partial = childOpenAmount(parent, 1.1);
		expect(partial).toBeGreaterThan(0);
		expect(partial).toBeLessThan(1);
	});

	it("is fully open once zoomed in", () => {
		expect(childOpenAmount(parent, 4)).toBe(1);
	});

	it("reports nothing to open for a leaf", () => {
		expect(childOpenAmount({ ...parent, childTotal: 0 }, 10)).toBe(0);
	});

	it("flies past the cross-fade boundary, not onto it", () => {
		const scale = scaleToRevealChildren(parent, 0.7);
		expect(childOpenAmount(parent, scale)).toBe(1);
	});

	it("caps a single click's flight, so a deep node is not orders of magnitude away", () => {
		expect(scaleToRevealChildren({ ...parent, depth: 6 }, 0.7)).toBeLessThanOrEqual(0.7 * 3.2);
	});

	it("shrinks each level in, so depth is legible without reading labels", () => {
		expect(radiusForDepth(1)).toBeLessThan(radiusForDepth(0));
		expect(radiusForDepth(20)).toBeGreaterThanOrEqual(7);
	});

	it("counts only children that actually exist", () => {
		expect(childTotalOf({ id: "x", label: "X", ring: "outer" })).toBe(0);
		expect(childTotalOf({ id: "x", label: "X", ring: "outer", children: [] })).toBe(0);
	});
});

describe("nodeVisibility and picking", () => {
	const nested = graph({
		nodes: [
			graph().nodes[0] as GraphNode,
			{
				id: "pin",
				label: "Grouped",
				ring: "outer",
				side: "right",
				children: [{ id: "kid", label: "Inside", ring: "child" }],
			} as GraphNode,
		],
	});

	it("hides a child while the branch it hangs from is still closed", () => {
		const layout = layoutGraph(nested);
		const kid = layout.nodes.find((n) => n.id === "kid");
		if (!kid) throw new Error("missing");
		expect(nodeVisibility(layout, kid, 0.7)).toBe(0);
	});

	it("reveals it once the camera has arrived", () => {
		const layout = layoutGraph(nested);
		const kid = layout.nodes.find((n) => n.id === "kid");
		if (!kid) throw new Error("missing");
		expect(nodeVisibility(layout, kid, 6)).toBe(1);
	});

	it("refuses to pick something the reader cannot see", () => {
		// Without this the map is covered in invisible targets stealing clicks
		// aimed at the parent still hiding them.
		const layout = layoutGraph(nested);
		const kid = layout.nodes.find((n) => n.id === "kid");
		if (!kid) throw new Error("missing");
		expect(pickNode(layout, kid.x, kid.y, 0.7)).not.toBe(kid);
		expect(pickNode(layout, kid.x, kid.y, 6)?.id).toBe("kid");
	});

	it("picks the nearer centre when two discs overlap, not the last one painted", () => {
		const layout = layoutGraph(graph());
		const target = layout.nodes.find((n) => n.id === "res-1");
		if (!target) throw new Error("missing");
		expect(pickNode(layout, target.x + 1, target.y, 1)?.id).toBe("res-1");
	});

	it("returns null on empty canvas", () => {
		expect(pickNode(layoutGraph(graph()), -5000, -5000, 1)).toBeNull();
	});

	it("keeps a tiny node clickable through screen-pixel slop", () => {
		const layout = layoutGraph(graph());
		const target = layout.nodes.find((n) => n.id === "res-1");
		if (!target) throw new Error("missing");
		// Just outside the disc, but within four screen pixels at this zoom.
		expect(pickNode(layout, target.x + target.radius + 10, target.y, 0.3)?.id).toBe("res-1");
	});
});

describe("neighboursOf", () => {
	it("reports both directions, since a hover lights up everything it touches", () => {
		const layout = layoutGraph(graph());
		expect([...neighboursOf(layout, "root")].sort()).toEqual(["id-1", "res-1"]);
	});
});
