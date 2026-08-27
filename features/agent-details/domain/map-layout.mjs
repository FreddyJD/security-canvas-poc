/**
 * The layout behind the access graph: a hub-and-rings arrangement of nodes
 * around one root, and the hit-testing that resolves what is under a point.
 *
 * Ported from the Security-UX `relationshipMapLayout.ts`. Pure, DOM-free, and
 * deterministic — which is what lets the interesting decisions be asserted in
 * Node with no canvas.
 *
 * ### Why rings and not a force simulation
 *
 * A force-directed graph is the obvious choice and the wrong one here. It gives
 * a different picture every run, so a node moves when nothing about it changed;
 * it takes an unbounded number of iterations to settle, which is a frame-budget
 * problem on a map that must also pan; and its output encodes nothing — a node
 * ends up where the springs left it, so its position means nothing a reader can
 * learn to read.
 *
 * Rings encode something. Distance from the center *is* the relationship: the
 * root is the agent being investigated, the inner ring is what reaches it, the
 * outer ring is what it reaches. Someone who has seen two of these maps can
 * read the third without a legend, which is the property that matters for a
 * view people return to.
 *
 * @typedef {import("./types.js").GraphEdge} GraphEdge
 * @typedef {import("./types.js").GraphLayout} GraphLayout
 * @typedef {import("./types.js").GraphNode} GraphNode
 * @typedef {import("./types.js").PositionedEdge} PositionedEdge
 * @typedef {import("./types.js").PositionedNode} PositionedNode
 * @typedef {import("./types.js").RelationshipGraph} RelationshipGraph
 * @typedef {import("./types.js").Ring} Ring
 * @typedef {import("./types.js").Side} Side
 */

/** The world box the rings are laid out in. */
export const WORLD_WIDTH = 900;
export const WORLD_HEIGHT = 620;

/** The root is drawn larger, because it is the thing the map is about. */
const ROOT_RADIUS = 30;
const NODE_RADIUS = 18;

/** Each ring's radius as a fraction of the smaller world dimension. */
const INNER_RATIO = 0.26;
const OUTER_RATIO = 0.44;

/**
 * The outer ring is rotated by a fraction of its own spacing.
 *
 * Without it, an inner node and an outer node frequently share an angle, and
 * the edge to the outer one passes exactly through the inner one — which reads
 * as a connection that is not there. An offset that is not a neat fraction of
 * either ring's spacing keeps the two from lining up at any node count.
 */
const OUTER_ANGLE_OFFSET = Math.PI / 10;

/** Clear space kept between two siblings in a child cluster, in world units. */
const CHILD_GAP = 6;

/**
 * The direction each side points, in canvas radians.
 *
 * Canvas Y grows downward, so `-PI/2` is up and `+PI/2` is down — the reverse
 * of the maths convention, and the single easiest thing to get backwards here.
 *
 * @type {Record<Side, number>}
 */
const SIDE_ANGLE = { right: 0, bottom: Math.PI / 2, left: Math.PI, top: -Math.PI / 2 };

/**
 * How wide a side's arc is.
 *
 * A quadrant would be the obvious choice and is slightly too tight: with only
 * two sides in play, a quarter-turn each leaves the halves looking like two
 * clumps rather than two columns. Slightly wider reads as "this half of the
 * map", which is what a side is meant to say — and it stays under a half-turn
 * so opposite sides cannot meet.
 */
const SIDE_ARC = Math.PI * 0.62;

/**
 * Order nodes within a ring: by side, then kind, then severity, then label.
 *
 * Ordering by *something* rather than by input order is what makes the map
 * stable — a graph rebuilt from a different query returns its nodes in a
 * different order, and without a total sort every node on the ring would move.
 * Kind before severity means nodes of a type sit together as an arc, which is
 * the grouping a reader can actually use; the id tie-break makes the order
 * total, so two nodes that agree on everything else never swap between renders.
 *
 * @param {GraphNode} left
 * @param {GraphNode} right
 * @returns {number}
 */
export function compareNodes(left, right) {
	const bySide = (left.side ?? "").localeCompare(right.side ?? "");
	if (bySide !== 0) return bySide;
	const byKind = (left.kind ?? "").localeCompare(right.kind ?? "");
	if (byKind !== 0) return byKind;
	const bySeverity = (right.severity ?? 0) - (left.severity ?? 0);
	if (bySeverity !== 0) return bySeverity;
	const byLabel = left.label.localeCompare(right.label);
	return byLabel !== 0 ? byLabel : left.id.localeCompare(right.id);
}

/**
 * How many children a node has.
 *
 * Just the nodes that are actually there. A declared count a caller could set
 * ahead of a fetch would produce a node badged "20" that opens onto nothing,
 * and a count the reader cannot click through to is worse than no badge at all:
 * it is the map saying something is there and then denying it.
 *
 * @param {GraphNode} node
 * @returns {number}
 */
export function childTotalOf(node) {
	return node.children?.length ?? 0;
}

/**
 * Each level in is drawn smaller, so depth is legible without reading labels.
 * @param {number} depth
 * @returns {number}
 */
export function radiusForDepth(depth) {
	return Math.max(7, NODE_RADIUS * Math.pow(0.66, depth));
}

/**
 * Spread `count` items across an arc centred on `centre`.
 *
 * A single item sits exactly on the centre line rather than at the arc's start,
 * which is what makes one identity on the left look deliberately placed instead
 * of accidentally offset.
 *
 * @param {number} count
 * @param {number} centre
 * @param {number} arc
 * @returns {number[]}
 */
function arcAngles(count, centre, arc) {
	return Array.from({ length: count }, (_unused, index) =>
		count === 1 ? centre : centre - arc / 2 + (arc * index) / (count - 1),
	);
}

/**
 * Place a ring's members around the centre, honouring any side assignments.
 *
 * With no sides this is an even spread, which is the right answer when the
 * reader has no prior question: it uses the space, and no direction claims a
 * meaning it does not have. With sides, each assigned group gets its own arc,
 * and nodes that named no side share whatever is left — so a caller can pin the
 * two sets it cares about without having to assign every node first.
 *
 * Unsided nodes go in the **emptiest** part of the ring, found by sampling.
 * Dropping them into the default even spread would scatter them straight
 * through the groups the caller just separated.
 *
 * @param {readonly GraphNode[]} members
 * @param {number} radius
 * @param {number} angleOffset
 * @param {number} centerX
 * @param {number} centerY
 * @param {Map<string, PositionedNode>} into
 */
function placeRing(members, radius, angleOffset, centerX, centerY, into) {
	/**
	 * @param {GraphNode} node
	 * @param {number} angle
	 */
	const place = (node, angle) => {
		into.set(node.id, {
			...node,
			x: centerX + radius * Math.cos(angle),
			y: centerY + radius * Math.sin(angle),
			radius: NODE_RADIUS,
			depth: 0,
			childTotal: childTotalOf(node),
		});
	};

	const sided = members.filter((node) => node.side !== undefined);
	if (sided.length === 0) {
		members.forEach((node, index) => {
			// `-PI/2` starts the ring at twelve o'clock rather than at three,
			// which is where the eye goes first and where the first sorted item
			// belongs.
			place(node, angleOffset - Math.PI / 2 + (2 * Math.PI * index) / members.length);
		});
		return;
	}

	/** @type {Map<Side, GraphNode[]>} */
	const bySide = new Map();
	for (const node of sided) {
		const side = /** @type {Side} */ (node.side);
		const bucket = bySide.get(side) ?? [];
		bucket.push(node);
		bySide.set(side, bucket);
	}
	for (const [side, group] of bySide) {
		const angles = arcAngles(group.length, SIDE_ANGLE[side], SIDE_ARC);
		group.forEach((node, index) => place(node, angles[index] ?? SIDE_ANGLE[side]));
	}

	const unsided = members.filter((node) => node.side === undefined);
	if (unsided.length === 0) return;

	// The direction furthest from every assigned side, found by sampling rather
	// than solved: the arcs can overlap, and a closed form for "furthest from a
	// set of arcs" is more machinery than this needs.
	const used = [...bySide.keys()].map((side) => SIDE_ANGLE[side]);
	let bestAngle = -Math.PI / 2;
	let bestGap = -Infinity;
	for (let step = 0; step < 72; step += 1) {
		const candidate = -Math.PI + (step * (2 * Math.PI)) / 72;
		const gap = Math.min(
			...used.map((angle) =>
				Math.abs(Math.atan2(Math.sin(candidate - angle), Math.cos(candidate - angle))),
			),
		);
		if (gap > bestGap) {
			bestGap = gap;
			bestAngle = candidate;
		}
	}
	const angles = arcAngles(unsided.length, bestAngle, Math.min(SIDE_ARC, Math.max(0, bestGap * 2 - 0.35)));
	unsided.forEach((node, index) => place(node, angles[index] ?? bestAngle));
}

/**
 * Place an expanded node's children in an arc **facing away from the root**,
 * and recurse into any of them that have children of their own.
 *
 * Two decisions carry this, and both are about staying readable when several
 * branches are open at once.
 *
 * **The arc points outward.** Children fanned in a full circle around their
 * parent would put half of them between the parent and the root, on top of the
 * edge that connects them and usually on top of a sibling. Opening away from
 * the centre means a cluster grows into the empty space outside the ring, which
 * is the only direction guaranteed to have room.
 *
 * **The arc widens with the count, up to a limit.** Ten children get a narrow
 * fan; thirty get most of a half-circle. A fixed spread would either waste the
 * space for a small cluster or overlap for a large one.
 *
 * @param {PositionedNode} parent
 * @param {number} rootX
 * @param {number} rootY
 * @param {Map<string, PositionedNode>} into
 * @param {ReadonlySet<string>} [ancestors]
 *   The ids on the path from the root to this parent. A graph whose child
 *   points back at one of its own ancestors is malformed but real — a
 *   permission that grants a role that contains the permission. Without this
 *   the recursion never terminates. Keyed on the *path* rather than on
 *   everything already placed, because the same node legitimately appears under
 *   two different parents; only revisiting an ancestor is a cycle.
 */
function placeChildren(parent, rootX, rootY, into, ancestors = new Set()) {
	const children = parent.children ?? [];
	if (children.length === 0) return;

	const pathIds = new Set(ancestors).add(parent.id);
	const ordered = [...children].sort(compareNodes);
	const depth = parent.depth + 1;
	const childRadius = radiusForDepth(depth);

	// The direction from the root out through the parent. A parent sitting
	// exactly on the root has no such direction, so it fans upward.
	const awayX = parent.x - rootX;
	const awayY = parent.y - rootY;
	const away = Math.hypot(awayX, awayY) < 1e-6 ? -Math.PI / 2 : Math.atan2(awayY, awayX);

	const spread = Math.min(Math.PI * 1.45, Math.max(Math.PI / 3, ordered.length * 0.34));

	// How far the cluster sits from its parent, derived from the spacing the arc
	// actually needs rather than guessed at. Neighbours sit `spread / (n - 1)`
	// radians apart, so the chord between two of them is `2 * d * sin(step / 2)`
	// — and that has to clear two child radii plus a gap. Solving for `d` is the
	// only way the cluster stays legible at *every* count.
	const step = ordered.length > 1 ? spread / (ordered.length - 1) : Math.PI;
	const needed = ordered.length > 1 ? (childRadius * 2 + CHILD_GAP) / (2 * Math.sin(step / 2)) : 0;
	const distance = Math.max(parent.radius + childRadius * 2.6, needed);

	ordered.forEach((child, index) => {
		// Closing the loop back onto an ancestor. Stop, rather than place it a
		// second time at a different position and recurse forever.
		if (pathIds.has(child.id)) return;

		const fraction = ordered.length === 1 ? 0.5 : index / (ordered.length - 1);
		const angle = away - spread / 2 + spread * fraction;
		/** @type {PositionedNode} */
		const placed = {
			...child,
			// Inherited unless the child names its own: a cluster that opened on
			// the opposite half from the node it belongs to would undo the
			// separation the caller asked for.
			side: child.side ?? parent.side,
			ring: "child",
			x: parent.x + distance * Math.cos(angle),
			y: parent.y + distance * Math.sin(angle),
			radius: childRadius,
			parentId: parent.id,
			depth,
			childTotal: childTotalOf(child),
		};
		into.set(placed.id, placed);
		placeChildren(placed, rootX, rootY, into, pathIds);
	});
}

/**
 * Shorten an edge so it runs between the two discs' *rims* rather than their
 * centers.
 *
 * Otherwise every line is drawn underneath the node it points at, which is
 * invisible while the nodes are opaque and appears as a spike through them the
 * moment anything is translucent. Trimming by each end's own radius also keeps
 * the gap correct when the root is larger than everything else.
 *
 * @param {GraphEdge} edge
 * @param {PositionedNode} from
 * @param {PositionedNode} to
 * @returns {PositionedEdge}
 */
function resolveEdge(edge, from, to) {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const distance = Math.hypot(dx, dy) || 1;
	const unitX = dx / distance;
	const unitY = dy / distance;
	return {
		...edge,
		x1: from.x + unitX * from.radius,
		y1: from.y + unitY * from.radius,
		x2: to.x - unitX * to.radius,
		y2: to.y - unitY * to.radius,
	};
}

/**
 * Lay the graph out as a hub with two rings.
 *
 * An edge whose endpoints are not both present is **dropped**, not drawn to
 * nowhere. That case is real rather than defensive: pruning a graph removes
 * nodes and leaves the edges that referenced them, and a line trailing into
 * empty space is a relationship the reader will believe in.
 *
 * @param {RelationshipGraph} graph
 * @param {ReadonlyMap<string, { dx: number, dy: number }>} [dragOffsets]
 *   Where the reader has dragged nodes to, as world-space offsets from where
 *   the layout would otherwise have put them. Offsets rather than absolute
 *   positions, deliberately: a dragged node keeps its *relationship* to the
 *   layout, so the ring still resizes with the viewport and a node moved 40px
 *   right stays 40px right of wherever it now belongs. Absolute positions would
 *   freeze a node to a coordinate the rest of the map has since moved away from.
 * @returns {GraphLayout}
 */
export function layoutGraph(graph, dragOffsets = new Map()) {
	const centerX = WORLD_WIDTH / 2;
	const centerY = WORLD_HEIGHT / 2;
	const base = Math.min(WORLD_WIDTH, WORLD_HEIGHT);
	/** @type {Map<string, PositionedNode>} */
	const positioned = new Map();

	const root = graph.nodes.find((node) => node.id === graph.rootId);
	if (root) {
		positioned.set(root.id, {
			...root,
			x: centerX,
			y: centerY,
			radius: ROOT_RADIUS,
			depth: 0,
			childTotal: childTotalOf(root),
		});
	}

	/** @param {Ring} ring */
	const ringMembers = (ring) =>
		graph.nodes.filter((node) => node.id !== graph.rootId && node.ring === ring).sort(compareNodes);

	// A node marked `root` that is not *the* root would otherwise be silently
	// dropped, so it joins the inner ring rather than vanishing.
	const stray = graph.nodes.filter((node) => node.id !== graph.rootId && node.ring === "root");
	const inner = stray.length > 0 ? [...ringMembers("inner"), ...stray].sort(compareNodes) : ringMembers("inner");

	placeRing(inner, base * INNER_RATIO, 0, centerX, centerY, positioned);
	placeRing(ringMembers("outer"), base * OUTER_RATIO, OUTER_ANGLE_OFFSET, centerX, centerY, positioned);

	// Children come after every ring is placed, because a cluster fans away from
	// the root *through its parent* — which is not known until the parent has a
	// position. Snapshotted first: `placeChildren` writes into the same map it
	// would otherwise be iterating.
	//
	// Placed unconditionally, for every node that has them. Positions are the
	// cheap part and they must exist before the paint can fade them in as the
	// camera approaches; gating them on a click is what would make this a toggle
	// instead of a map.
	for (const node of [...positioned.values()]) {
		placeChildren(node, centerX, centerY, positioned);
	}

	// Apply the reader's drags — after all placement and before any edge is
	// resolved, which is what makes connectors follow a dragged node rather than
	// pointing at where it used to be. A child inherits its parent's offset on
	// top of its own, so dragging a parent carries its whole cluster with it.
	if (dragOffsets.size > 0) {
		/** @param {PositionedNode} node */
		const totalOffset = (node) => {
			let dx = 0;
			let dy = 0;
			/** @type {PositionedNode | undefined} */
			let current = node;
			const seen = new Set();
			while (current && !seen.has(current.id)) {
				seen.add(current.id);
				const own = dragOffsets.get(current.id);
				if (own) {
					dx += own.dx;
					dy += own.dy;
				}
				current = current.parentId ? positioned.get(current.parentId) : undefined;
			}
			return { dx, dy };
		};
		for (const [id, node] of [...positioned.entries()]) {
			const offset = totalOffset(node);
			if (offset.dx !== 0 || offset.dy !== 0) {
				positioned.set(id, { ...node, x: node.x + offset.dx, y: node.y + offset.dy });
			}
		}
	}

	/** @type {PositionedEdge[]} */
	const edges = [];
	for (const edge of graph.edges) {
		const from = positioned.get(edge.fromId);
		const to = positioned.get(edge.toId);
		if (from && to) edges.push(resolveEdge(edge, from, to));
	}

	// Containment edges are derived, never declared. A caller that also had to
	// supply an edge for every parent/child pair would be stating the same fact
	// twice, and the two would disagree the first time one was edited alone.
	for (const node of positioned.values()) {
		const parent = node.parentId ? positioned.get(node.parentId) : undefined;
		if (parent) edges.push(resolveEdge({ fromId: parent.id, toId: node.id }, parent, node));
	}

	return { nodes: [...positioned.values()], edges };
}

/**
 * On-screen radius, in px, at which a revealed child is fully drawn.
 *
 * The reveal is driven by how big a child would be **on screen**, not by the
 * raw camera scale. That is what makes the threshold mean the same thing at
 * every depth: a level-3 child is laid out much smaller in world units than a
 * level-1 one, so a scale-based trigger would pop the deep ones in far too
 * early and the shallow ones far too late.
 *
 * Calibrated against the zoom the map rests at. A fitted graph sits near 0.7,
 * where a first-level child is about 8px across — so both thresholds are above
 * that, and the map opens with every parent as a single labelled disc rather
 * than already showing its contents.
 */
const CHILD_FULL_PX = 18;

/**
 * On-screen radius below which children stay hidden.
 *
 * Kept well apart from {@link CHILD_FULL_PX} so there is a real cross-fade band
 * rather than a threshold that snaps. A parent reads as a single labelled node
 * at rest, and its contents bleed in only once someone has deliberately zoomed
 * toward it — which is what makes opening feel like an answer to the gesture
 * rather than a rendering artifact.
 */
const CHILD_HIDDEN_PX = 9;

/** Below this alpha a node is too faint to be worth a click. */
export const PICKABLE_ALPHA = 0.45;

/**
 * How revealed a node's children are at the current zoom: 0 shows the parent as
 * one disc with a count badge, 1 shows its children, and in between the two
 * cross-fade.
 *
 * This is the Google-Maps behaviour: detail is a function of how close you are,
 * not of a click you remembered to make. Zooming out again hides it, so the map
 * never accumulates open branches the reader has to tidy up.
 *
 * @param {PositionedNode} node
 * @param {number} scale
 * @returns {number}
 */
export function childOpenAmount(node, scale) {
	if (node.childTotal === 0) return 0;
	const childPx = radiusForDepth(node.depth + 1) * scale;
	if (childPx <= CHILD_HIDDEN_PX) return 0;
	if (childPx >= CHILD_FULL_PX) return 1;
	return (childPx - CHILD_HIDDEN_PX) / (CHILD_FULL_PX - CHILD_HIDDEN_PX);
}

/**
 * The scale a click should fly to in order to reveal `node`'s children.
 *
 * Deliberately past {@link CHILD_FULL_PX} rather than exactly at it, so a click
 * lands solidly inside revealed territory instead of on the cross-fade boundary
 * where the children are half-faded and the badge is half-gone.
 *
 * @param {PositionedNode} node
 * @param {number} currentScale
 * @returns {number}
 */
export function scaleToRevealChildren(node, currentScale) {
	const childRadius = radiusForDepth(node.depth + 1);
	if (childRadius <= 0) return currentScale;
	// A single click never multiplies the zoom by more than this. Without the
	// cap, clicking a deep node on a zoomed-out map is a flight through orders
	// of magnitude, which arrives disorientingly rather than reading as travel.
	const desired = (CHILD_FULL_PX * 1.25) / childRadius;
	return Math.max(currentScale, Math.min(desired, currentScale * 3.2));
}

/**
 * How visible a node is at the current zoom: 1 for anything on the root's own
 * rings, and its parent's {@link childOpenAmount} for a child.
 *
 * A child is only as visible as the branch it hangs from, all the way up — a
 * grandchild inside a parent that has not opened yet stays hidden even though
 * its own size would qualify. That is what keeps the reveal reading as one
 * continuous zoom rather than as levels popping in independently.
 *
 * @param {GraphLayout} layout
 * @param {PositionedNode} node
 * @param {number} scale
 * @returns {number}
 */
export function nodeVisibility(layout, node, scale) {
	/** @type {PositionedNode | undefined} */
	let current = node;
	let visibility = 1;
	const seen = new Set();
	while (current?.parentId && !seen.has(current.id)) {
		seen.add(current.id);
		/** @type {string} */
		const parentId = current.parentId;
		/** @type {PositionedNode | undefined} */
		const parent = layout.nodes.find((entry) => entry.id === parentId);
		if (!parent) break;
		visibility = Math.min(visibility, childOpenAmount(parent, scale));
		if (visibility <= 0) return 0;
		current = parent;
	}
	return visibility;
}

/**
 * The node under a world point, or null.
 *
 * "Topmost" is resolved by **distance to center** rather than by draw order:
 * when two discs overlap, the one whose center is nearer is the one being aimed
 * at, regardless of which happened to be painted last.
 *
 * `slopPx` is screen pixels converted to world units, so a node that is only a
 * few pixels across when zoomed out stays clickable without the targets
 * overlapping at normal zoom.
 *
 * @param {GraphLayout} layout
 * @param {number} worldX
 * @param {number} worldY
 * @param {number} scale
 * @param {number} [slopPx]
 * @returns {PositionedNode | null}
 */
export function pickNode(layout, worldX, worldY, scale, slopPx = 4) {
	const slop = slopPx / Math.max(scale, 0.0001);
	/** @type {PositionedNode | null} */
	let best = null;
	let bestDistance = Infinity;
	for (const node of layout.nodes) {
		// Something the reader cannot see must not take their click. Children are
		// positioned at every zoom and only faded in as the camera approaches, so
		// without this the map would be covered in invisible targets stealing
		// clicks aimed at the parent still hiding them.
		if (nodeVisibility(layout, node, scale) < PICKABLE_ALPHA) continue;
		const distance = Math.hypot(node.x - worldX, node.y - worldY);
		if (distance <= node.radius + slop && distance < bestDistance) {
			best = node;
			bestDistance = distance;
		}
	}
	return best;
}

/**
 * The ids directly connected to a node — what a hover should light up.
 * @param {GraphLayout} layout
 * @param {string} nodeId
 * @returns {Set<string>}
 */
export function neighboursOf(layout, nodeId) {
	const ids = new Set();
	for (const edge of layout.edges) {
		if (edge.fromId === nodeId) ids.add(edge.toId);
		else if (edge.toId === nodeId) ids.add(edge.fromId);
	}
	return ids;
}
