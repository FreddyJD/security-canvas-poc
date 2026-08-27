/**
 * The access-graph surface: the framed, pannable `<canvas>` and everything
 * around it that is not the drawing.
 *
 * This is the browser half of the map. It owns the gesture engine (drag to pan,
 * wheel to zoom toward the cursor, buttons to step and reframe), the animation
 * loop that makes each of those a glide rather than a jump, the shimmer that
 * runs while the graph is fetching, the hover label, the node detail card, and
 * the keyboard-reachable mirror of what was painted.
 *
 * ### Why a target camera, rather than moving the camera directly
 *
 * Zoom, fit and flight all set a **target** and let a frame loop ease the live
 * camera toward it. That indirection is the entire reason a map feels like a
 * map: a camera that jumps to its new value on click reads as a slideshow, and
 * a zoom control that steps discretely gives no sense of the two views being
 * the same place. The loop stops as soon as it arrives, so an idle map costs
 * nothing.
 *
 * A **drag is the exception** and moves both together. Direct manipulation must
 * track the pointer exactly — easing toward a finger is the one place where
 * smoothing reads as lag rather than as polish — so a pan writes the live
 * camera and the target in the same breath.
 *
 * ### Accessibility
 *
 * A `<canvas>` is a bitmap and is completely opaque to assistive technology, so
 * the picture also exists as a list of real focusable buttons. A map that
 * stopped at the bitmap would be an unlabelled image with a pile of
 * inaccessible click targets on it — and the failure is invisible to everyone
 * who tests with a mouse.
 *
 * @typedef {import("../domain/types.js").Camera} Camera
 * @typedef {import("../domain/types.js").GraphLayout} GraphLayout
 * @typedef {import("../domain/types.js").PositionedNode} PositionedNode
 * @typedef {import("../domain/types.js").RelationshipGraph} RelationshipGraph
 */
import {
	ZOOM_STEP,
	boundsOf,
	cameraSettled,
	clampScale,
	easeInOut,
	fitCamera,
	lerpCamera,
	panBy,
	screenToWorld,
	wheelZoomFactor,
	zoomAt,
} from "../domain/map-camera.mjs";
import {
	childOpenAmount,
	layoutGraph,
	neighboursOf,
	pickNode,
	scaleToRevealChildren,
} from "../domain/map-layout.mjs";
import { forcedColorsActive, prefersReducedMotion, resolveMapInk, sizeCanvas, viewOf } from "./map-canvas.mjs";
import { paintGraph } from "./map-paint.mjs";
import { esc } from "./primitives.mjs";

/**
 * Pointer travel, in px, past which a gesture is a pan rather than a tap.
 *
 * Zero would make every click on a trackpad a pan, because a finger lifting off
 * a physical button moves a pixel or two. Much larger and a deliberate short
 * drag registers as a click on whatever it started over.
 */
const TAP_SLOP = 4;

/** How much of the remaining distance the camera closes each frame. */
const EASE_FACTOR = 0.22;

/**
 * How long the loading shimmer takes to cross the frame once.
 *
 * Deliberately unhurried. A light that crosses quickly reads as a glitch or as
 * something failing to settle; one that takes well over a second reads as work
 * in progress, which is the only thing the placeholder is trying to say.
 */
const SHIMMER_PERIOD_MS = 1600;

/**
 * How far past each edge the shimmer travels, as a fraction of the frame.
 *
 * Without it the band appears at the left edge and vanishes at the right, which
 * reads as the highlight blinking on and off rather than as light crossing.
 */
const SHIMMER_OVERSHOOT = 0.25;

/**
 * How long the real map takes to fade up over the placeholder.
 *
 * Short, because nothing here is being explained — the cross-fade exists only
 * so the answer does not *snap* into place, and a longer one would make the
 * reader wait after the data has already arrived.
 */
const REVEAL_MS = 400;

/** @returns {number} */
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * The static markup for the graph section.
 *
 * Rendered once and then owned by {@link mountAccessGraph}, which is the split
 * that matters: the surrounding page re-renders from SSE on every state change,
 * and a map that was re-created each time would lose its camera, its drag
 * offsets and its open card on every unrelated update.
 *
 * @returns {string}
 */
export function accessGraphSection() {
	return `<section class="graph-section" aria-label="Agent's access graph">
    <h2 class="graph-heading">Agent's access graph</h2>
    <p class="graph-subtitle">Pan and zoom to inspect ownership, roles, and high-risk edges.</p>
    <div class="graph-frame" id="graph-frame">
      <div class="graph-probe" id="graph-probe" aria-hidden></div>
      <canvas class="graph-canvas" id="graph-canvas"></canvas>
      <div class="graph-tooltip" id="graph-tooltip" role="status" hidden></div>
      <div class="graph-card" id="graph-card" hidden></div>
      <div class="graph-controls">
        <button type="button" class="icon-btn" data-map="zoom-in" aria-label="Zoom in">${zoomInIcon()}</button>
        <button type="button" class="icon-btn" data-map="zoom-out" aria-label="Zoom out">${zoomOutIcon()}</button>
        <button type="button" class="icon-btn" data-map="fit" aria-label="Fit to view">${fitIcon()}</button>
        <button type="button" class="icon-btn" data-map="full" aria-label="Full screen" aria-pressed="false">${fullIcon()}</button>
      </div>
      <div class="graph-hint" id="graph-hint">Scroll to zoom in — nodes open as you get closer. Drag a node, or a card, to move it.</div>
      <div class="graph-live sr-only" id="graph-live" role="status"></div>
      <ul class="graph-nodes" id="graph-nodes" aria-label="Agent's access graph"></ul>
    </div>
  </section>`;
}

const zoomInIcon = () =>
	`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2 17 17M9 6.75v4.5M6.75 9h4.5" stroke-linecap="round"/></svg>`;
const zoomOutIcon = () =>
	`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13.2 13.2 17 17M6.75 9h4.5" stroke-linecap="round"/></svg>`;
const fitIcon = () =>
	`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 8V4.5A1.5 1.5 0 0 1 4.5 3H8M12 3h3.5A1.5 1.5 0 0 1 17 4.5V8M17 12v3.5a1.5 1.5 0 0 1-1.5 1.5H12M8 17H4.5A1.5 1.5 0 0 1 3 15.5V12" stroke-linecap="round"/></svg>`;
const fullIcon = () =>
	`<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 7.5V3.75A.75.75 0 0 1 3.75 3H7.5M12.5 3h3.75a.75.75 0 0 1 .75.75V7.5M17 12.5v3.75a.75.75 0 0 1-.75.75H12.5M7.5 17H3.75a.75.75 0 0 1-.75-.75V12.5" stroke-linecap="round"/></svg>`;

/**
 * Bring the graph section to life, and hand back a controller.
 *
 * Returns an `update(graph, isLoading)` so the page can feed the map new data
 * without remounting it — which is what preserves the camera, the drags, and
 * the open card across an SSE frame that changed something else entirely.
 *
 * @param {{ graph: RelationshipGraph, isLoading?: boolean }} options
 * @returns {{ update: (graph: RelationshipGraph, isLoading: boolean) => void, destroy: () => void } | null}
 */
export function mountAccessGraph({ graph, isLoading = false }) {
	const frame = /** @type {HTMLElement | null} */ (document.getElementById("graph-frame"));
	const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("graph-canvas"));
	const probe = /** @type {HTMLElement | null} */ (document.getElementById("graph-probe"));
	const tooltip = /** @type {HTMLElement | null} */ (document.getElementById("graph-tooltip"));
	const cardHost = /** @type {HTMLElement | null} */ (document.getElementById("graph-card"));
	const nodeList = /** @type {HTMLElement | null} */ (document.getElementById("graph-nodes"));
	const live = /** @type {HTMLElement | null} */ (document.getElementById("graph-live"));
	const hint = /** @type {HTMLElement | null} */ (document.getElementById("graph-hint"));
	if (!frame || !canvas || !probe || !tooltip || !cardHost || !nodeList || !live || !hint) return null;

	/** @type {RelationshipGraph} */
	let currentGraph = graph;
	let loading = isLoading;
	/** @type {Map<string, { dx: number, dy: number }>} */
	let dragOffsets = new Map();
	/** @type {GraphLayout} */
	let layout = layoutGraph(currentGraph, dragOffsets);

	/** @type {Camera} */
	let camera = { x: 0, y: 0, scale: 1 };
	/** @type {Camera} */
	let target = { x: 0, y: 0, scale: 1 };
	/** @type {number | null} */
	let easeFrame = null;
	/** @type {number | null} */
	let flightFrame = null;
	/** @type {number | null} */
	let shimmerFrame = null;

	let shimmer = 0;
	let reveal = loading ? 0 : 1;
	let reducedMotion = prefersReducedMotion();

	/** @type {string | undefined} */
	let hoveredId;
	/** @type {string | undefined} */
	let selectedId;
	/** @type {{ id: string, dx: number, dy: number } | null} */
	let dragging = null;
	/** @type {{ pointerId: number, lastX: number, lastY: number, downX: number, downY: number, moved: boolean, grabbed: boolean } | null} */
	let gesture = null;

	// ---------------------------------------------------------------- paint

	const draw = () => {
		const view = viewOf(frame);
		if (view.width === 0 || view.height === 0) return;
		const ctx = sizeCanvas(canvas, view);
		if (!ctx) return;

		ctx.clearRect(0, 0, view.width, view.height);
		paintGraph(ctx, {
			layout,
			camera,
			view,
			// Resolved fresh on every paint and never cached, which is what makes
			// a theme flip correct by construction rather than by remembering to
			// invalidate something.
			ink: resolveMapInk(probe, forcedColorsActive()),
			...(selectedId ? { selectedNodeId: selectedId } : {}),
			...(hoveredId ? { focusedNodeId: hoveredId, focusedNeighbours: neighboursOf(layout, hoveredId) } : {}),
			reveal,
			// The placeholder fades out as the map fades in, so both are on screen
			// for the frames between and the swap reads as one shape gaining
			// colour rather than as two pictures changing places.
			...(reveal >= 1 ? {} : { placeholder: { alpha: 1 - reveal, sweep: shimmer, animate: !reducedMotion } }),
		});
	};

	// --------------------------------------------------------------- camera

	const cancelMotion = () => {
		if (easeFrame !== null) cancelAnimationFrame(easeFrame);
		if (flightFrame !== null) cancelAnimationFrame(flightFrame);
		easeFrame = null;
		flightFrame = null;
	};

	/** Ease the live camera toward the target until it settles. */
	const requestRender = () => {
		if (easeFrame !== null) return;
		// Reduced motion: arrive, do not travel. The destination is identical;
		// only the journey is dropped.
		if (prefersReducedMotion()) {
			camera = { ...target };
			draw();
			return;
		}
		const step = () => {
			easeFrame = null;
			camera = lerpCamera(camera, target, EASE_FACTOR);
			draw();
			if (cameraSettled(camera, target)) {
				// Snap exactly onto the target, so repeated zooms cannot accumulate
				// the easing's residual error into a drift.
				camera = { ...target };
				draw();
				return;
			}
			easeFrame = requestAnimationFrame(step);
		};
		easeFrame = requestAnimationFrame(step);
	};

	const fitToView = () => {
		cancelMotion();
		// Framed from the *undragged* layout: dragging changes the extent every
		// frame, so fitting the dragged one would pull the camera away from the
		// node the reader is holding.
		const base = dragOffsets.size === 0 ? layout : layoutGraph(currentGraph);
		target = fitCamera(viewOf(frame), boundsOf(base.nodes, 24));
		requestRender();
	};

	/** @param {number} factor */
	const zoomButton = (factor) => {
		const view = viewOf(frame);
		dismissOverlays();
		target = zoomAt(target, view, factor, view.width / 2, view.height / 2);
		requestRender();
	};

	/**
	 * Ease the camera to centre a point at a scale, over `durationMs`.
	 *
	 * The one camera move that is *narrative* rather than mechanical: it is how
	 * the map answers a click by taking you somewhere. Eased at both ends,
	 * because a flight that starts at full speed reads as a cut.
	 *
	 * @param {number} x @param {number} y @param {number} scale @param {number} [durationMs]
	 */
	const flyTo = (x, y, scale, durationMs = 620) => {
		cancelMotion();
		const from = { ...camera };
		const to = { x, y, scale: clampScale(scale) };
		target = to;
		if (prefersReducedMotion()) {
			camera = { ...to };
			draw();
			return;
		}
		const start = now();
		const step = () => {
			const progress = Math.min(1, (now() - start) / Math.max(1, durationMs));
			camera = lerpCamera(from, to, easeInOut(progress));
			draw();
			flightFrame = progress < 1 ? requestAnimationFrame(step) : null;
		};
		flightFrame = requestAnimationFrame(step);
	};

	// -------------------------------------------------------------- overlays

	const dismissOverlays = () => {
		hoveredId = undefined;
		tooltip.hidden = true;
		// The card is pinned to a canvas position, so it is wrong the moment the
		// camera moves. Dismissing beats letting it drift away from its node.
		cardHost.hidden = true;
	};

	/**
	 * @param {PositionedNode} node
	 * @returns {{ left: number, top: number }}
	 */
	const anchorFor = (node) => {
		const view = viewOf(frame);
		return {
			left: (node.x - camera.x) * camera.scale + view.width / 2,
			top: (node.y - camera.y) * camera.scale + view.height / 2 - node.radius * camera.scale,
		};
	};

	/** @param {PositionedNode} node */
	const openCard = (node) => {
		const anchor = anchorFor(node);
		const reach = layout.edges.filter((e) => e.fromId === node.id || e.toId === node.id).length;
		const risk =
			(node.severity ?? 0) >= 3
				? { label: "High risk", tone: "danger" }
				: (node.severity ?? 0) > 0
					? { label: "Medium risk", tone: "warning" }
					: { label: "Low risk", tone: "success" };

		cardHost.innerHTML = `<div class="node-card">
      <div class="node-card-head">
        <div class="node-card-titles">
          <span class="node-card-title">${esc(node.label)}</span>
          <span class="node-card-sub">${esc(node.kind ?? "node")}</span>
        </div>
        <button type="button" class="icon-btn" data-map="close-card" aria-label="Close ${esc(node.label)} details">&times;</button>
      </div>
      <span class="tag tone-${esc(risk.tone)}">${esc(risk.label)}</span>
      <div class="node-card-stat">
        <span class="node-card-value">${reach}</span>
        <span class="node-card-caption">direct relationships</span>
      </div>
      ${node.detail ? `<p class="node-card-detail">${esc(node.detail)}</p>` : ""}
    </div>`;
		cardHost.style.left = `${anchor.left}px`;
		cardHost.style.top = `${anchor.top + node.radius * camera.scale * 2}px`;
		cardHost.hidden = false;
	};

	// ------------------------------------------------------------ hit-testing

	/**
	 * The node under a wrapper-relative point, or null.
	 *
	 * The single gate for every pointer path — hover, tap and grab all resolve
	 * through here — rather than three guards that could disagree about whether
	 * the map is interactive yet. Nothing on a loading map is real, so nothing
	 * on it can be picked.
	 *
	 * @param {number} screenX @param {number} screenY
	 * @returns {PositionedNode | null}
	 */
	const nodeAt = (screenX, screenY) => {
		if (loading) return null;
		const view = viewOf(frame);
		const world = screenToWorld(camera, view, screenX, screenY);
		return pickNode(layout, world.x, world.y, camera.scale);
	};

	/** @param {PointerEvent} event */
	const relative = (event) => {
		const rect = frame.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	};

	// -------------------------------------------------------------- gestures

	/** @param {PointerEvent} event */
	const onPointerDown = (event) => {
		// A press inside the card or the controls belongs to them.
		if (/** @type {Element} */ (event.target).closest?.(".graph-card, .graph-controls")) return;
		/** @type {Element} */ (event.target).setPointerCapture?.(event.pointerId);
		const point = relative(event);
		// Offered now, while what is under the pointer is still known: a node
		// takes the press and drags, empty canvas pans. Only *what is under the
		// pointer at the moment it went down* can decide which gesture this is.
		const node = nodeAt(point.x, point.y);
		if (node) dragging = { id: node.id, dx: dragOffsets.get(node.id)?.dx ?? 0, dy: dragOffsets.get(node.id)?.dy ?? 0 };
		gesture = {
			pointerId: event.pointerId,
			lastX: event.clientX,
			lastY: event.clientY,
			downX: event.clientX,
			downY: event.clientY,
			moved: false,
			grabbed: Boolean(node),
		};
	};

	/** @param {PointerEvent} event */
	const onPointerMove = (event) => {
		if (!gesture || gesture.pointerId !== event.pointerId) {
			// Hover. Repaint immediately rather than waiting on anything else:
			// the dimming is painted on the canvas, and deferring it puts visible
			// lag between the pointer and the highlight it produced.
			const point = relative(event);
			const node = nodeAt(point.x, point.y);
			const nextId = node?.id;
			if (nextId === hoveredId) return;
			hoveredId = nextId;
			if (node && cardHost.hidden) {
				const anchor = anchorFor(node);
				tooltip.textContent = node.label;
				tooltip.style.left = `${anchor.left}px`;
				tooltip.style.top = `${anchor.top}px`;
				tooltip.hidden = false;
			} else {
				tooltip.hidden = true;
			}
			draw();
			return;
		}

		const dx = event.clientX - gesture.lastX;
		const dy = event.clientY - gesture.lastY;
		gesture.lastX = event.clientX;
		gesture.lastY = event.clientY;

		if (!gesture.moved && Math.hypot(event.clientX - gesture.downX, event.clientY - gesture.downY) > TAP_SLOP) {
			gesture.moved = true;
			if (!gesture.grabbed) frame.classList.add("is-panning");
			cancelMotion();
			dismissOverlays();
		}
		if (!gesture.moved) return;

		if (gesture.grabbed && dragging) {
			// Converted to world units so a dragged node tracks the pointer
			// exactly at any zoom — the same reason a pan divides by the scale.
			dragging.dx += dx / camera.scale;
			dragging.dy += dy / camera.scale;
			dragOffsets = new Map(dragOffsets);
			dragOffsets.set(dragging.id, { dx: dragging.dx, dy: dragging.dy });
			layout = layoutGraph(currentGraph, dragOffsets);
			draw();
			return;
		}

		// Live camera and target together: a drag is direct manipulation and must
		// track the pointer exactly. If the target lagged behind, the next eased
		// frame would pull the view back toward where the drag began.
		camera = panBy(camera, dx, dy);
		target = camera;
		draw();
	};

	/** @param {PointerEvent} event */
	const onPointerUp = (event) => {
		const session = gesture;
		gesture = null;
		frame.classList.remove("is-panning");
		if (!session || session.pointerId !== event.pointerId) return;
		/** @type {Element} */ (event.target).releasePointerCapture?.(event.pointerId);

		const wasDragging = dragging;
		dragging = null;
		// A drag is a pan or a move, never a selection.
		if (session.moved) return;
		if (wasDragging) void wasDragging;

		const point = relative(event);
		const node = nodeAt(point.x, point.y);
		if (!node) {
			selectedId = undefined;
			dismissOverlays();
			draw();
			return;
		}

		selectedId = node.id;
		tooltip.hidden = true;

		// Only a node whose children are still hidden has somewhere to fly to.
		// Once they are on screen, clicking its body must not zoom again — a
		// click that keeps sending the reader somewhere else is the single most
		// confusing thing an infinite-zoom map can do.
		const canReveal = node.childTotal > 0 && childOpenAmount(node, camera.scale) < 1;
		if (canReveal) {
			flyTo(node.x, node.y, scaleToRevealChildren(node, camera.scale));
			cardHost.hidden = true;
		} else {
			openCard(node);
		}
		draw();
		renderNodeList();
	};

	/** @param {PointerEvent} event */
	const onPointerCancel = (event) => {
		// A cancelled pointer is not a click — the reader never completed
		// anything — so this is pointerup minus the tap. Without it the gesture
		// survives its own pointer, and since a mouse's id is stable, the next
		// hover would pick up the stale drag and move a node with no button held.
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		gesture = null;
		dragging = null;
		frame.classList.remove("is-panning");
	};

	const onPointerLeave = () => {
		if (hoveredId === undefined) return;
		hoveredId = undefined;
		tooltip.hidden = true;
		draw();
	};

	/**
	 * Wheel zoom, attached by hand because it must be **non-passive** — a
	 * passive listener's `preventDefault` is ignored, and the panel would scroll
	 * out from under the map while it zooms.
	 *
	 * @param {WheelEvent} event
	 */
	const onWheel = (event) => {
		event.preventDefault();
		const rect = frame.getBoundingClientRect();
		cancelMotion();
		dismissOverlays();
		target = zoomAt(
			target,
			{ width: rect.width, height: rect.height },
			wheelZoomFactor(event.deltaY),
			event.clientX - rect.left,
			event.clientY - rect.top,
		);
		requestRender();
	};

	/** @param {MouseEvent} event */
	const onControlClick = (event) => {
		const button = /** @type {HTMLElement | null} */ (
			/** @type {Element} */ (event.target).closest?.("[data-map]")
		);
		if (!button) return;
		event.stopPropagation();

		switch (button.dataset.map) {
			case "zoom-in":
				return zoomButton(ZOOM_STEP);
			case "zoom-out":
				return zoomButton(1 / ZOOM_STEP);
			case "fit":
				// Put everything the reader rearranged back where the map wants
				// it. Wired to "fit to view" rather than given a control of its
				// own: that control already means "undo what I did to the view".
				dragOffsets = new Map();
				layout = layoutGraph(currentGraph);
				dismissOverlays();
				return fitToView();
			case "full": {
				const full = frame.classList.toggle("is-fullscreen");
				button.setAttribute("aria-pressed", String(full));
				dismissOverlays();
				// Full screen is a size change no observer can see coming, so the
				// canvas is re-sized and reframed a frame after the class lands.
				requestAnimationFrame(fitToView);
				return;
			}
			case "close-card":
				cardHost.hidden = true;
				selectedId = undefined;
				draw();
				return;
		}
	};

	/** @param {KeyboardEvent} event */
	const onKeyDown = (event) => {
		// Escape leaves full screen, so there is always a keyboard way back out
		// of a view that covers the whole panel.
		if (event.key === "Escape" && frame.classList.contains("is-fullscreen")) {
			frame.classList.remove("is-fullscreen");
			frame.querySelector('[data-map="full"]')?.setAttribute("aria-pressed", "false");
			requestAnimationFrame(fitToView);
		}
	};

	// ------------------------------------------------------- keyboard mirror

	/**
	 * The keyboard mirror: every node on the map, as a real button.
	 *
	 * Only the root's own rings are listed. Children are positioned at every
	 * zoom and revealed by the camera, and a keyboard user cannot fly a camera —
	 * so listing every descendant would hand them hundreds of entries for things
	 * nobody can see, which is worse than not exposing the feature at all.
	 * Activating a node with children flies the camera *and* leaves the entry
	 * focused, which is the closest equivalent available.
	 *
	 * A loading map lists nothing: the placeholder discs are a silhouette, not
	 * data, so offering them as buttons would open cards about nothing and read
	 * out names the map does not yet know.
	 */
	const renderNodeList = () => {
		if (loading) {
			nodeList.innerHTML = "";
			nodeList.setAttribute("aria-busy", "true");
			return;
		}
		nodeList.removeAttribute("aria-busy");
		nodeList.innerHTML = layout.nodes
			.filter((node) => node.depth === 0)
			.map((node) => {
				const contains = node.childTotal > 0 ? `, contains ${node.childTotal}, activate to open` : "";
				const label = `${node.label}${node.kind ? `, ${node.kind}` : ""}${node.detail ? `, ${node.detail}` : ""}${contains}`;
				return `<li><button type="button" class="graph-node-btn" data-node="${esc(node.id)}" aria-label="${esc(label)}"${
					node.id === selectedId ? ' aria-current="true"' : ""
				}>${esc(node.label)}</button></li>`;
			})
			.join("");
	};

	/** @param {MouseEvent} event */
	const onNodeListClick = (event) => {
		const button = /** @type {HTMLElement | null} */ (
			/** @type {Element} */ (event.target).closest?.("[data-node]")
		);
		if (!button) return;
		const node = layout.nodes.find((entry) => entry.id === button.dataset.node);
		if (!node) return;
		selectedId = node.id;
		if (node.childTotal > 0 && childOpenAmount(node, camera.scale) < 1) {
			flyTo(node.x, node.y, scaleToRevealChildren(node, camera.scale));
		} else {
			openCard(node);
		}
		draw();
		renderNodeList();
	};

	// -------------------------------------------------------------- shimmer

	/**
	 * Run the shimmer while loading, then fade the real map up over it.
	 *
	 * One loop owns both, because they are one animation: the hand-over is the
	 * moment the shimmer stops and the reveal starts, and two loops would have
	 * to agree about when that was.
	 *
	 * Reduced motion keeps the placeholder — a reader who asked for less motion
	 * still needs to know the map is loading — and drops only its travel and the
	 * cross-fade, so the map arrives in one step instead of over 400ms.
	 */
	const runShimmer = () => {
		if (shimmerFrame !== null) cancelAnimationFrame(shimmerFrame);
		shimmerFrame = null;
		reducedMotion = prefersReducedMotion();

		if (loading) {
			reveal = 0;
			if (reducedMotion) return draw();
			const start = now();
			const step = () => {
				const cycle = ((now() - start) % SHIMMER_PERIOD_MS) / SHIMMER_PERIOD_MS;
				shimmer = cycle * (1 + SHIMMER_OVERSHOOT * 2) - SHIMMER_OVERSHOOT;
				draw();
				shimmerFrame = requestAnimationFrame(step);
			};
			shimmerFrame = requestAnimationFrame(step);
			return;
		}

		if (reducedMotion || reveal >= 1) {
			reveal = 1;
			return draw();
		}

		const start = now();
		const step = () => {
			reveal = Math.min(1, Math.max(0, (now() - start) / REVEAL_MS));
			draw();
			shimmerFrame = reveal < 1 ? requestAnimationFrame(step) : null;
		};
		shimmerFrame = requestAnimationFrame(step);
	};

	// ---------------------------------------------------------------- wiring

	frame.addEventListener("pointerdown", onPointerDown);
	frame.addEventListener("pointermove", onPointerMove);
	frame.addEventListener("pointerup", onPointerUp);
	frame.addEventListener("pointercancel", onPointerCancel);
	frame.addEventListener("pointerleave", onPointerLeave);
	frame.addEventListener("wheel", onWheel, { passive: false });
	frame.addEventListener("click", onControlClick);
	nodeList.addEventListener("click", onNodeListClick);
	window.addEventListener("keydown", onKeyDown);

	// The frame resizes for reasons a window event never sees — the full-screen
	// toggle, the panel's own layout. Deferred by a frame because a
	// ResizeObserver callback that writes layout-affecting values synchronously
	// re-triggers the observer, which the browser reports as "loop completed
	// with undelivered notifications".
	let queued = 0;
	const observer =
		typeof ResizeObserver === "undefined"
			? null
			: new ResizeObserver(() => {
					if (queued) return;
					queued = requestAnimationFrame(() => {
						queued = 0;
						fitToView();
					});
				});
	observer?.observe(frame);

	// The theme flips by swapping custom properties on the root, which fires no
	// event of its own. Watching the attribute that carries it is what turns a
	// token change into a repaint.
	const themeObserver =
		typeof MutationObserver === "undefined"
			? null
			: new MutationObserver(() => draw());
	themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

	live.textContent = loading ? "Loading the agent's access graph" : "";
	fitToView();
	renderNodeList();
	runShimmer();

	return {
		/**
		 * Feed the map new data without remounting it.
		 * @param {RelationshipGraph} nextGraph
		 * @param {boolean} nextLoading
		 */
		update(nextGraph, nextLoading) {
			const graphChanged = JSON.stringify(nextGraph) !== JSON.stringify(currentGraph);
			const loadingChanged = nextLoading !== loading;
			if (!graphChanged && !loadingChanged) return;

			currentGraph = nextGraph;
			loading = nextLoading;
			live.textContent = loading ? "Loading the agent's access graph" : "";
			hint.hidden = loading;

			if (graphChanged) {
				// New data invalidates the reader's rearrangement: the offsets were
				// keyed to nodes that may no longer exist, and a stale one would
				// displace whatever inherited its id.
				dragOffsets = new Map();
				layout = layoutGraph(currentGraph);
				dismissOverlays();
				selectedId = undefined;
				fitToView();
				renderNodeList();
			}
			runShimmer();
		},

		destroy() {
			cancelMotion();
			if (shimmerFrame !== null) cancelAnimationFrame(shimmerFrame);
			if (queued) cancelAnimationFrame(queued);
			observer?.disconnect();
			themeObserver?.disconnect();
			frame.removeEventListener("pointerdown", onPointerDown);
			frame.removeEventListener("pointermove", onPointerMove);
			frame.removeEventListener("pointerup", onPointerUp);
			frame.removeEventListener("pointercancel", onPointerCancel);
			frame.removeEventListener("pointerleave", onPointerLeave);
			frame.removeEventListener("wheel", onWheel);
			frame.removeEventListener("click", onControlClick);
			nodeList.removeEventListener("click", onNodeListClick);
			window.removeEventListener("keydown", onKeyDown);
		},
	};
}
