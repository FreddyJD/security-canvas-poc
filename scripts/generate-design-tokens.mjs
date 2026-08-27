/**
 * Regenerates `platform/design-tokens.mjs` from the real `@sfe/react-theme`.
 *
 * ### Why this script exists
 *
 * The canvas cannot import `@sfe/react-theme`: a Copilot plugin install is a
 * plain file copy, so `node_modules` never exists at runtime. The token values
 * therefore have to be *copied* into the repo — and a hand-copied palette is a
 * palette that silently drifts from the theme it was copied from. (Security-UX
 * has exactly that bug: `app/shared/theming/lithium/tokens.custom.ts` froze a
 * gradient pair that no longer matches Lithium.)
 *
 * So the copy is generated instead of typed. Re-running this against a newer
 * `@sfe/react-theme` produces the new palette with no judgement calls, and the
 * diff shows precisely what SFE changed.
 *
 * ### Usage
 *
 * Point it at a resolved copy of the package — the *hoisted* one, which is what
 * Security-UX's `V2SfeTheme` alias pins. A bare `@sfe/react-theme` specifier in
 * that repo resolves to an older nested copy:
 *
 *   node scripts/generate-design-tokens.mjs \
 *     ../Security-UX/node_modules/@sfe/react-theme > platform/design-tokens.mjs
 *
 * The generated file is committed; this script is not run at build or test time.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const PKG = process.argv[2];

if (!PKG) {
	console.error("usage: node scripts/generate-design-tokens.mjs <path-to-@sfe/react-theme>");
	process.exit(1);
}

const require = createRequire(import.meta.url);
const { lithiumLightTheme } = require(`${PKG}/cjs/themes/lithium/light-theme.js`);
const { lithiumDarkTheme } = require(`${PKG}/cjs/themes/lithium/dark-theme.js`);
const { version } = JSON.parse(readFileSync(`${PKG}/package.json`, "utf8"));

/**
 * Perception's radius ramp, expressed as values to *look up* rather than to set.
 *
 * Verbatim from `PocUnifiedux/shared/data/unifieduxTheme.ts`. See `remapRadii`.
 */
const LITHIUM_RADIUS_RAMP = {
	borderRadiusNone: "0",
	borderRadiusSmall: "6px",
	borderRadiusMedium: "16px",
	borderRadiusLarge: "24px",
	borderRadiusXLarge: "24px",
	borderRadius2XLarge: "12px",
	borderRadius3XLarge: "16px",
	borderRadius4XLarge: "24px",
	borderRadius5XLarge: "32px",
	borderRadius6XLarge: "40px",
	borderRadiusCircular: "10000px",
};

/**
 * Re-point each named radius at the value some existing token already holds.
 *
 * The distinction from assignment is the point. Writing `borderRadiusMedium:
 * '16px'` freezes a number; this says "whatever token currently holds 16px,
 * point `borderRadiusMedium` at its value too" — so the ramp stays internally
 * consistent and an SFE restyle carries through. A desired value no token holds
 * is skipped rather than forced, so this can only ever produce values already in
 * the theme: it re-points the ramp, it never invents a number.
 *
 * @param {Record<string, unknown>} base
 * @returns {Record<string, unknown>}
 */
function remapRadii(base) {
	/** @type {Map<string, string>} */
	const valueToToken = new Map();

	for (const key of Object.keys(base)) {
		const value = String(base[key]);

		if (key.startsWith("borderRadius") && !valueToToken.has(value)) {
			valueToToken.set(value, key);
		}
	}

	/** @type {Record<string, unknown>} */
	const remapped = {};

	for (const [key, value] of Object.entries(LITHIUM_RADIUS_RAMP)) {
		const source = valueToToken.get(value);

		if (source !== undefined) remapped[key] = base[source];
	}

	return remapped;
}

const light = { ...lithiumLightTheme, ...remapRadii(lithiumLightTheme) };
const dark = { ...lithiumDarkTheme, ...remapRadii(lithiumDarkTheme) };

const keys = [...new Set([...Object.keys(light), ...Object.keys(dark)])].sort();

/** @type {string[]} */ const themed = [];
/** @type {string[]} */ const shared = [];

for (const key of keys) {
	if (String(light[key]) !== String(dark[key])) themed.push(key);
	else shared.push(key);
}

/** @param {unknown} value */
const quote = (value) => {
	const text = String(value);
	return text.includes('"') || text.includes("'") ? JSON.stringify(text) : `"${text}"`;
};

let out = `/**
 * The **Lithium** design tokens, as CSS custom properties.
 *
 * These are the real \`lithiumLightTheme\` / \`lithiumDarkTheme\` values from
 * \`@sfe/react-theme\` — the same package and the same two themes that
 * Security-UX's Unified UX POC and Perception render — generated from the
 * package rather than eyeballed, so every value here traces to a token there.
 *
 * ### Why the values are copied instead of imported
 *
 * Forced by the runtime: a Copilot plugin install is a plain file copy, so
 * \`node_modules\` never exists and \`@sfe/react-theme\` cannot be resolved. SFE's
 * components would additionally need React, a bundler and a build step this
 * canvas deliberately does not have.
 *
 * The token map is the part that transfers without any of that. What does *not*
 * transfer is \`lithiumCustomStyleHooks\`, the 54 hooks that restyle Fluent's
 * React components — nothing here renders a Fluent component, so there is
 * nothing for them to restyle. The stylesheets under \`features/*\` play that
 * role and are written against these tokens directly.
 *
 * ### The radius ramp is remapped, not hand-typed
 *
 * Lithium ships \`borderRadiusMedium: 4px\`, but Perception draws with 16px. It
 * gets there by looking up which existing token *already holds* 16px and
 * pointing the ramp at that token's value rather than typing a literal, so an
 * SFE restyle carries through instead of being overwritten. That lookup is
 * already applied below, exactly as \`unifieduxTheme.ts\` applies it at runtime.
 *
 * Emitted under \`:root\` and \`[data-theme="dark"]\`, which makes theme switching
 * a single attribute flip rather than a re-render — no stylesheet swap, no
 * flash, and every component inherits it for free.
 *
 * Do not edit by hand. Regenerate with:
 *   node scripts/generate-design-tokens.mjs <path-to-@sfe/react-theme> > platform/design-tokens.mjs
 *
 * @generated from @sfe/react-theme@${version}
 */

/**
 * Values that differ between light and dark.
 * @type {Record<string, [light: string, dark: string]>}
 */
const THEMED = {
`;

for (const key of themed) out += `\t${key}: [${quote(light[key])}, ${quote(dark[key])}],\n`;

out += `};

/**
 * Values that are identical in both themes.
 * @type {Record<string, string>}
 */
const STATIC = {
`;

for (const key of shared) out += `\t${key}: ${quote(light[key])},\n`;

out += `};

/**
 * @param {Record<string, string>} vars
 * @returns {string}
 */
function declarations(vars) {
	return Object.entries(vars)
		.map(([name, value]) => \`  --\${name}: \${value};\`)
		.join("\\n");
}

/**
 * Every custom property for one scheme, without a selector around them.
 *
 * Exists so a surface that cannot use \`data-theme\` can still be driven by the
 * same generated values instead of hand-picking a few — \`platform/auth.mjs\`
 * renders on a throwaway loopback origin with no \`localStorage\` and no toggle,
 * so it wraps these in \`prefers-color-scheme\` instead. Hand-picking is what
 * this whole file exists to avoid.
 *
 * @param {"light" | "dark"} scheme
 * @returns {string}
 */
export function themeDeclarations(scheme) {
	const index = scheme === "dark" ? 1 : 0;

	/** @type {Record<string, string>} */
	const vars = scheme === "dark" ? {} : { ...STATIC };

	for (const [name, values] of Object.entries(THEMED)) vars[name] = values[index];

	vars[PAGE_BACKGROUND_NAME] = pageBackground(scheme);

	return declarations(vars);
}

/**
 * The \`:root\` / \`[data-theme="dark"]\` custom-property blocks.
 *
 * Light lives on \`:root\` rather than on \`[data-theme="light"]\` so the canvas
 * renders correctly for one frame before any script runs. Dark then overrides
 * it, which is also why an unknown \`data-theme\` value degrades to light rather
 * than to an unstyled page.
 *
 * @returns {string}
 */
export function themeVariables() {
	return \`:root {\\n\${themeDeclarations("light")}\\n}\\n\\n[data-theme="dark"] {\\n\${themeDeclarations("dark")}\\n}\`;
}

/** The custom property name, without the leading dashes. */
const PAGE_BACKGROUND_NAME = "canvas-page-background";

/**
 * The custom property the page background is published on.
 *
 * A CSS variable rather than a token because a gradient is not a colour, and
 * SFE's theme is a map of colours. Unified UX publishes it the same way, under
 * its own name (\`--unifiedux-page-background\`).
 */
export const PAGE_BACKGROUND_PROPERTY = \`--\${PAGE_BACKGROUND_NAME}\`;

/**
 * The page's background for a scheme, composed from the theme's own gradient
 * stops.
 *
 * This is the detail that makes a Lithium surface look like Lithium rather than
 * like Fluent wearing Lithium's palette: the ground is a soft off-centre radial
 * wash, not a flat fill. The origin differs per scheme — dark lifts the light
 * source to the top edge, light drops it into the upper-left — and both are
 * Perception's.
 *
 * Falls back to the flat neutral surface when a theme ships no gradient, so a
 * future SFE theme without one renders a plain background rather than a
 * \`radial-gradient(..., undefined, undefined)\` the browser drops entirely,
 * which would leave the page transparent.
 *
 * @param {"light" | "dark"} scheme
 * @returns {string}
 */
export function pageBackground(scheme) {
	const index = scheme === "dark" ? 1 : 0;

	const start = THEMED.colorNeutralGradientStart?.[index];
	const end = THEMED.colorNeutralGradientEnd?.[index];

	if (start === undefined || end === undefined) {
		return "var(--colorNeutralBackground1)";
	}

	const origin = scheme === "dark" ? "20% 0%" : "15% 25%";

	return \`radial-gradient(ellipse 80% 60% at \${origin}, \${start} 0%, \${end} 100%)\`;
}

/**
 * Tone → the mark colour a status dot or meter segment takes.
 *
 * \`STATUS_MARK\` in Security-UX, and the distinction from a text colour is
 * load-bearing: an 8px dot is a non-text mark held to 3:1, while the text ramp
 * is tuned for letterforms and goes muddy at that size.
 *
 * @type {Record<string, string>}
 */
export const TONE_MARK = {
	neutral: "var(--colorNeutralForeground2)",
	brand: "var(--colorBrandForeground2)",
	danger: "var(--colorStatusDangerBackground3)",
	warning: "var(--colorStatusWarningBorder2)",
	success: "var(--colorStatusSuccessForeground1)",
};

/**
 * The unfilled meter segment.
 *
 * \`colorNeutralBackground6\` rather than a recessed step: on a dark row the
 * darker neutrals read as four holes punched through the surface instead of as
 * an empty track.
 */
export const TRACK_BACKGROUND = "var(--colorNeutralBackground6)";
`;

process.stdout.write(out);
console.error(`themed ${themed.length} · static ${shared.length} · total ${keys.length}`);
