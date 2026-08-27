/**
 * The "Unified risk score" card: a ring gauge and the security posture.
 *
 * Two readings that belong together in ONE card. On the left a single-value
 * ring showing the agent's real secure score with a low/medium/high RISK
 * caption beneath it; on the right the posture — a toned tag, a heading, and an
 * honest sentence composed from the agent's real protection flags.
 *
 * Stateless. The view model carries semantic enums and flags only; every
 * user-visible word is resolved here, so the domain tier stays string-free.
 *
 * @typedef {import("../domain/types.js").Posture} Posture
 * @typedef {import("../domain/types.js").SecureScore} SecureScore
 */
import { BAND_RISK_LABEL } from "../domain/secure-score.mjs";
import { CHECK_ICON, WARNING_ICON, esc } from "./primitives.mjs";

/**
 * The ring's geometry, in SVG user units.
 *
 * Drawn as an SVG rather than on a canvas because it never moves: a canvas
 * would buy nothing and cost the theme-resolution machinery the map needs. A
 * stroked circle with a dash offset is the whole gauge — no path arithmetic, no
 * arc-flag edge case at 100%, and it animates for free if it ever needs to.
 */
const RADIUS = 34;
const STROKE = 8;
const SIZE = (RADIUS + STROKE) * 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The ring gauge.
 *
 * Rotated -90° so the arc starts at twelve o'clock, which is where a reader
 * expects a gauge to begin — starting at three reads as an arbitrary offset.
 *
 * The whole thing is one `role="img"` with the reading in its name: two stroked
 * circles are announced as nothing at all, and labelling each would announce
 * the picture rather than the fact.
 *
 * @param {SecureScore} risk
 * @returns {string}
 */
export function riskDonut(risk) {
	const score = Math.max(0, Math.min(100, risk.score));
	const caption = BAND_RISK_LABEL[risk.band];
	// `strokeDasharray` of the full circumference with an offset is the fill.
	// Guarded to a whole number of user units so a sub-pixel remainder cannot
	// leave a hairline gap at 100%.
	const filled = (score / 100) * CIRCUMFERENCE;

	return `<div class="donut-wrap">
    <svg class="donut" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Unified risk score ${score} out of 100, ${esc(caption)} risk">
      <circle class="donut-track" cx="${SIZE / 2}" cy="${SIZE / 2}" r="${RADIUS}" fill="none" stroke-width="${STROKE}"/>
      <circle
        class="donut-fill tone-${esc(risk.tone)}"
        cx="${SIZE / 2}" cy="${SIZE / 2}" r="${RADIUS}"
        fill="none" stroke-width="${STROKE}" stroke-linecap="round"
        stroke-dasharray="${filled.toFixed(2)} ${(CIRCUMFERENCE - filled).toFixed(2)}"
        transform="rotate(-90 ${SIZE / 2} ${SIZE / 2})"
      />
      <text class="donut-score" x="${SIZE / 2}" y="${SIZE / 2}" text-anchor="middle" dominant-baseline="central" aria-hidden>${score}</text>
    </svg>
    <span class="donut-caption" aria-hidden>${esc(caption)}</span>
  </div>`;
}

/**
 * A protection flag paired with the clause it contributes to the sentence.
 * @type {{ flag: keyof Posture, label: string }[]}
 */
const POSTURE_CLAUSES = [
	{ flag: "coverage", label: "Conditional Access coverage" },
	{ flag: "caGoverned", label: "Conditional Access governance" },
	{ flag: "defenderProtected", label: "Microsoft Defender protection" },
	{ flag: "dlpProtected", label: "Microsoft Purview DLP" },
];

/**
 * Join clauses into a conjunction list: "a", "a and b", "a, b, and c".
 *
 * `Intl.ListFormat` where it exists, so the connectives follow the active
 * locale rather than being hardcoded English, and a plain comma join otherwise
 * — falling back to inventing connective words would be worse than omitting
 * them.
 *
 * @param {readonly string[]} items
 * @returns {string}
 */
export function joinClauses(items) {
	if (typeof Intl?.ListFormat !== "function") return items.join(", ");
	return new Intl.ListFormat(undefined, { style: "long", type: "conjunction" }).format(items);
}

/**
 * The honest protection sentence, composed from the real posture flags.
 *
 * Three buckets, not two. A flag that is `true` is stated as protection, a flag
 * that is `false` is stated as a gap, and a flag that is **absent** is stated as
 * nothing at all — because "Not yet protected by Microsoft Purview DLP" is a
 * finding, and saying it about an agent DLP was never asked about would be a
 * fabricated one.
 *
 * @param {Posture} posture
 * @returns {string}
 */
export function postureBody(posture) {
	/** @type {string[]} */
	const active = [];
	/** @type {string[]} */
	const missing = [];
	for (const { flag, label } of POSTURE_CLAUSES) {
		if (posture[flag] === true) active.push(label);
		else if (posture[flag] === false) missing.push(label);
	}

	/** @type {string[]} */
	const parts = [];
	if (active.length > 0) parts.push(`Protected by ${joinClauses(active)}.`);
	if (missing.length > 0) parts.push(`Not yet protected by ${joinClauses(missing)}.`);
	if (parts.length === 0) parts.push("No protection signals have been evaluated for this agent yet.");
	return parts.join(" ");
}

/**
 * The unified risk score card: gauge plus posture.
 * @param {SecureScore} risk
 * @param {Posture} posture
 * @returns {string}
 */
export function unifiedRiskScore(risk, posture) {
	const secure = posture.status === "secure";
	return `<div class="risk-body">
    ${riskDonut(risk)}
    <div class="posture">
      <span class="tag tone-${esc(posture.tone)}">${secure ? CHECK_ICON : WARNING_ICON}${secure ? "Secure" : "Review"}</span>
      <h3 class="posture-heading">${secure ? "Agent is secure" : "Review recommended"}</h3>
      <p class="posture-body">${esc(postureBody(posture))}</p>
    </div>
  </div>`;
}
