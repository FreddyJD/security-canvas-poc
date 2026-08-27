/**
 * Fluent UI v9 design tokens, as CSS custom properties.
 *
 * These are the real `webLightTheme` / `webDarkTheme` values from
 * `@fluentui/tokens`, extracted verbatim rather than eyeballed from a
 * screenshot. Copying values instead of importing the package is forced by the
 * runtime: a Copilot plugin install is a plain file copy, so `node_modules`
 * never exists and `@fluentui/react-*` cannot be resolved — and Fluent's React
 * components need React, a bundler, and a build step this canvas deliberately
 * does not have.
 *
 * What that buys is the part that actually matters for matching the Security-UX
 * Agents page: the palette, the type ramp, the spacing scale and the radii are
 * identical, so the two surfaces agree pixel-for-pixel on colour and rhythm
 * without shipping a framework.
 *
 * Emitted as custom properties under `:root` and `[data-theme="dark"]`, which
 * is what makes theme switching a single attribute flip rather than a re-render
 * — no stylesheet swap, no flash, and every component inherits it for free.
 *
 * Names mirror Fluent's exactly (`--colorNeutralBackground1`), so a value can
 * be traced back to its source token without a translation table.
 */

/**
 * Values that differ between light and dark.
 * @type {Record<string, [light: string, dark: string]>}
 */
const THEMED = {
	// Surfaces
	colorNeutralBackground1: ["#ffffff", "#292929"],
	colorNeutralBackground1Hover: ["#f5f5f5", "#3d3d3d"],
	colorNeutralBackground1Pressed: ["#e0e0e0", "#1f1f1f"],
	colorNeutralBackground2: ["#fafafa", "#1f1f1f"],
	colorNeutralBackground3: ["#f5f5f5", "#141414"],
	colorNeutralBackground4: ["#f0f0f0", "#0a0a0a"],
	colorNeutralBackground6: ["#e6e6e6", "#333333"],
	colorSubtleBackgroundHover: ["#f5f5f5", "#383838"],

	// Ink
	colorNeutralForeground1: ["#242424", "#ffffff"],
	colorNeutralForeground2: ["#424242", "#d6d6d6"],
	colorNeutralForeground3: ["#616161", "#adadad"],
	colorNeutralForeground4: ["#707070", "#999999"],
	colorNeutralForegroundDisabled: ["#bdbdbd", "#5c5c5c"],

	// Strokes
	colorNeutralStroke1: ["#d1d1d1", "#666666"],
	colorNeutralStroke2: ["#e0e0e0", "#525252"],
	colorNeutralStroke3: ["#f0f0f0", "#3d3d3d"],
	colorNeutralStrokeAccessible: ["#616161", "#adadad"],

	// Brand
	colorBrandBackground: ["#0f6cbd", "#115ea3"],
	colorBrandBackground2: ["#ebf3fc", "#082338"],
	colorBrandStroke1: ["#0f6cbd", "#479ef5"],
	colorBrandStroke2: ["#b4d6fa", "#0e4775"],
	colorBrandForeground1: ["#0f6cbd", "#479ef5"],
	colorBrandForeground2: ["#115ea3", "#62abf5"],
	colorBrandForegroundLink: ["#115ea3", "#479ef5"],
	colorBrandForegroundLinkHover: ["#0f548c", "#62abf5"],

	// Status — marks (non-text, held to 3:1) and their washes
	colorStatusDangerBackground3: ["#c50f1f", "#c50f1f"],
	colorStatusDangerBackground1: ["#fdf3f4", "#3b0509"],
	colorStatusDangerForeground1: ["#b10e1c", "#dc626d"],
	colorStatusWarningBorder2: ["#bc4b09", "#f98845"],
	colorStatusWarningBackground1: ["#fff9f5", "#4a1e04"],
	colorStatusWarningForeground2: ["#8a3707", "#fdcfb4"],
	colorStatusSuccessForeground1: ["#0e700e", "#54b054"],
	colorStatusSuccessBackground1: ["#f1faf1", "#052505"],

	// Elevation
	shadow2: [
		"0 0 2px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.14)",
		"0 0 2px rgba(0,0,0,0.24), 0 1px 2px rgba(0,0,0,0.28)",
	],
	shadow4: [
		"0 0 2px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.14)",
		"0 0 2px rgba(0,0,0,0.24), 0 2px 4px rgba(0,0,0,0.28)",
	],
	shadow8: [
		"0 0 2px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.14)",
		"0 0 2px rgba(0,0,0,0.24), 0 4px 8px rgba(0,0,0,0.28)",
	],
};

/** Values that are identical in both themes. */
const STATIC = {
	fontFamilyBase:
		"'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif",
	fontFamilyMonospace: "Consolas, 'Courier New', Courier, monospace",

	fontSizeBase100: "10px",
	fontSizeBase200: "12px",
	fontSizeBase300: "14px",
	fontSizeBase400: "16px",
	fontSizeBase500: "20px",
	fontSizeBase600: "24px",
	fontSizeHero700: "28px",

	lineHeightBase100: "14px",
	lineHeightBase200: "16px",
	lineHeightBase300: "20px",
	lineHeightBase400: "22px",
	lineHeightBase500: "28px",
	lineHeightBase600: "32px",
	lineHeightHero700: "36px",

	fontWeightRegular: "400",
	fontWeightMedium: "500",
	fontWeightSemibold: "600",
	fontWeightBold: "700",

	borderRadiusSmall: "2px",
	borderRadiusMedium: "4px",
	borderRadiusLarge: "6px",
	borderRadiusXLarge: "8px",
	borderRadiusCircular: "10000px",

	spacingHorizontalXXS: "2px",
	spacingHorizontalXS: "4px",
	spacingHorizontalS: "8px",
	spacingHorizontalM: "12px",
	spacingHorizontalL: "16px",
	spacingHorizontalXL: "20px",
	spacingHorizontalXXL: "24px",

	spacingVerticalXXS: "2px",
	spacingVerticalXS: "4px",
	spacingVerticalS: "8px",
	spacingVerticalM: "12px",
	spacingVerticalL: "16px",
	spacingVerticalXL: "20px",
	spacingVerticalXXL: "24px",

	durationFaster: "100ms",
	durationNormal: "200ms",
	curveEasyEase: "cubic-bezier(0.33,0,0.67,1)",
	curveDecelerateMid: "cubic-bezier(0,0,0,1)",

	strokeWidthThin: "1px",
	strokeWidthThick: "2px",
};

/**
 * @param {Record<string, string>} vars
 * @returns {string}
 */
function declarations(vars) {
	return Object.entries(vars)
		.map(([name, value]) => `  --${name}: ${value};`)
		.join("\n");
}

/**
 * The `:root` / `[data-theme="dark"]` custom-property blocks.
 *
 * Light lives on `:root` rather than on `[data-theme="light"]` so the canvas
 * renders correctly for one frame before any script runs. Dark then overrides
 * it, which is also why an unknown `data-theme` value degrades to light rather
 * than to an unstyled page.
 *
 * @returns {string}
 */
export function themeVariables() {
	/** @type {Record<string, string>} */
	const light = { ...STATIC };
	/** @type {Record<string, string>} */
	const dark = {};

	for (const [name, [lightValue, darkValue]] of Object.entries(THEMED)) {
		light[name] = lightValue;
		dark[name] = darkValue;
	}

	return `:root {\n${declarations(light)}\n}\n\n[data-theme="dark"] {\n${declarations(dark)}\n}`;
}

/**
 * Tone → the mark colour a status dot or meter segment takes.
 *
 * `STATUS_MARK` in Security-UX, and the distinction from a text colour is
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
 * `colorNeutralBackground6` rather than a recessed step: on a dark row the
 * darker neutrals read as four holes punched through the surface instead of as
 * an empty track.
 */
export const TRACK_BACKGROUND = "var(--colorNeutralBackground6)";
