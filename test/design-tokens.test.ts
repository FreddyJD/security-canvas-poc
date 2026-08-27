import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PAGE_BACKGROUND_PROPERTY, TONE_MARK, TRACK_BACKGROUND, pageBackground, themeDeclarations, themeVariables } from "../platform/design-tokens.mjs";

/**
 * The Lithium theme, as it reaches the page.
 *
 * `platform/design-tokens.mjs` is generated from `@sfe/react-theme`, so its
 * *values* are not this file's business — regenerating against a newer SFE is
 * supposed to change them, and a test that pinned every hex would only ever be
 * updated to match whatever the generator emitted.
 *
 * What is asserted instead is the part a regeneration must never change, and
 * the part a hand-edit is most likely to break:
 *
 *  - the emitted CSS is *shaped* right (two blocks, light on `:root`),
 *  - the radius ramp is Perception's remapped one rather than Lithium's raw
 *    one, which is the difference nobody notices until the cards are square,
 *  - the page background is a real gradient composed from the theme's own
 *    stops, not the stale hardcoded pair the shared Security-UX layer froze,
 *  - and no token resolves to `undefined`, which is how a `var()` silently
 *    drops a declaration and leaves an element transparent.
 */
describe("Lithium design tokens", () => {
	const css = themeVariables();
	const rootBlock = css.slice(0, css.indexOf('[data-theme="dark"]'));
	const darkBlock = css.slice(css.indexOf('[data-theme="dark"]'));

	/** The value of one custom property within one block. */
	function declaration(block: string, name: string): string | undefined {
		const line = block.split("\n").find((entry) => entry.trim().startsWith(`--${name}:`));
		return line?.trim().slice(`--${name}:`.length, -1).trim();
	}

	it("puts light on :root so the first frame is correct before any script runs", () => {
		// Not `[data-theme="light"]`: the boot script sets the attribute, and
		// anything that renders before it must not be unstyled. It is also why an
		// unknown `data-theme` degrades to light rather than to a blank page.
		expect(css.startsWith(":root {")).toBe(true);
		expect(css).toContain('[data-theme="dark"] {');
		expect(declaration(rootBlock, "colorNeutralBackground1")).toBe("#FFFFFF");
		expect(declaration(darkBlock, "colorNeutralBackground1")).toBe("#1B212D");
	});

	it("draws with Perception's remapped radii, not Lithium's raw ramp", () => {
		// Lithium ships 4px here; Unified UX and Perception both render 16px by
		// re-pointing the ramp at a token that already holds it. A regression to
		// 4px is the single most visible way this port can silently stop looking
		// like Lithium, because every card and button squares off at once.
		expect(declaration(rootBlock, "borderRadiusMedium")).toBe("16px");
		expect(declaration(rootBlock, "borderRadiusSmall")).toBe("6px");
		expect(declaration(rootBlock, "borderRadiusLarge")).toBe("24px");
		expect(declaration(rootBlock, "borderRadiusCircular")).toBe("10000px");
	});

	it("composes the page background from the theme's own gradient stops", () => {
		// The stale copy this replaces was `#202935 -> #0D111D`, hardcoded when
		// Lithium shipped no gradient. It does now, so the assertion is that the
		// background is *derived* — it must quote the same stops the theme holds.
		const start = declaration(darkBlock, "colorNeutralGradientStart");
		const end = declaration(darkBlock, "colorNeutralGradientEnd");

		expect(start).toBeDefined();
		expect(end).toBeDefined();

		const dark = pageBackground("dark");
		expect(dark).toContain(String(start));
		expect(dark).toContain(String(end));
		expect(dark).toMatch(/^radial-gradient\(ellipse 80% 60% at 20% 0%,/);

		// The origin differs per scheme: dark lifts the light source to the top
		// edge, light drops it into the upper-left. Both are Perception's.
		expect(pageBackground("light")).toMatch(/^radial-gradient\(ellipse 80% 60% at 15% 25%,/);
	});

	it("publishes the background on a custom property in both schemes", () => {
		// A variable rather than a token because a gradient is not a colour, and
		// SFE's theme is a map of colours. Publishing it per-block is what keeps
		// the ground part of the same single attribute flip as everything else.
		const name = PAGE_BACKGROUND_PROPERTY.replace(/^--/, "");

		expect(declaration(rootBlock, name)).toBe(pageBackground("light"));
		expect(declaration(darkBlock, name)).toBe(pageBackground("dark"));
	});

	it("never emits an undefined or empty value", () => {
		// A `var(--x)` pointing at `undefined` does not fall back — the browser
		// drops the whole declaration, which reads as a transparent element
		// rather than as an error. Cheap to assert, invisible to debug.
		for (const block of [rootBlock, darkBlock]) {
			for (const line of block.split("\n").filter((entry) => entry.trim().startsWith("--"))) {
				expect(line).not.toMatch(/:\s*(undefined|null|NaN)?\s*;$/);
			}
		}
	});

	it("keeps every semantic export pointing at a token that exists", () => {
		// These are the indirections the components actually name. A tone that
		// points at a token the theme dropped is a mark that vanishes, and only
		// on the rows that happen to carry that status.
		const declared = new Set(
			rootBlock
				.split("\n")
				.filter((entry) => entry.trim().startsWith("--"))
				.map((entry) => entry.trim().slice(2).split(":")[0]),
		);

		for (const expression of [...Object.values(TONE_MARK), TRACK_BACKGROUND]) {
			const name = expression.replace(/^var\(--/, "").replace(/\)$/, "");
			expect(declared.has(name)).toBe(true);
		}
	});

	it("exposes one scheme's declarations for surfaces that cannot use data-theme", () => {
		// `platform/auth.mjs` renders on the throwaway loopback origin used for
		// the OAuth redirect: no `localStorage` to read a choice from, no toggle
		// to offer on a tab that closes itself. It emits `themeVariables()` for
		// the `:root` base and then wraps *these* in `prefers-color-scheme`.
		const dark = themeDeclarations("dark");
		const light = themeDeclarations("light");

		expect(dark).toContain("--colorNeutralForeground1: #FFFFFF;");
		expect(light).toContain("--colorNeutralForeground1: #1B212D;");
		expect(dark).toContain("--canvas-page-background: ");

		// The dark set carries every name that differs, so overriding `:root`
		// with it re-themes the page completely. Scheme-invariant values
		// (`fontFamilyBase`, the type ramp) are deliberately absent — they are
		// inherited from the `:root` block rather than repeated, which is why
		// `themeVariables()` has to come first for this to be sound.
		const themedNames = light
			.split("\n")
			.map((line) => line.trim().slice(2).split(":")[0])
			.filter((name) => name && !dark.includes(`--${name}: `));

		for (const name of themedNames) {
			expect(`${light}`).toContain(`--${name}: `);
		}

		expect(dark).not.toContain("--fontFamilyBase: ");
		expect(light).toContain("--fontFamilyBase: ");
	});
});

/**
 * The guard that would have caught the one screen the first pass missed.
 *
 * `platform/auth.mjs` renders the page you land on after the Entra redirect. It
 * was written before the panels and kept its own GitHub-dark palette
 * (`#0d1117`, `#e6edf3`, `#8b949e`, `#f85149`) — four literals, no tokens, no
 * theme. Nothing failed, because it is the one surface no test opened and no
 * screenshot covered: it appears for about two seconds, on a throwaway origin,
 * during a flow you cannot run without a tenant.
 *
 * So the rule is enforced against the source rather than against a rendering:
 * a colour literal outside the generated token file is a screen that will drift
 * out of the theme, and the next one should fail here rather than be noticed by
 * whoever happens to sign in.
 */
describe("no untokenized colour outside the generated theme", () => {
	/** Everything that ships, minus the generated token file itself. */
	function sourceFiles(dir: string, found: string[] = []): string[] {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;

			const path = join(dir, entry.name);

			if (entry.isDirectory()) sourceFiles(path, found);
			else if (/\.(mjs|ts)$/.test(entry.name)) found.push(path);
		}

		return found;
	}

	// The token file is the one legitimate home for literals — it *is* the
	// palette. `scripts/` generates it and quotes the same values. `test/` is
	// excluded because assertions must name concrete resolved colours: that is
	// exactly what `agent-details-paint.test.ts` exists to check, and what this
	// file does two describes up.
	const exempt = new Set(["platform/design-tokens.mjs", "scripts/generate-design-tokens.mjs"]);

	const files = sourceFiles(".")
		.map((path) => path.replace(/^\.\//, ""))
		.filter((path) => !exempt.has(path) && !path.startsWith("test/"));

	it("finds no hex literal in any shipped source file", () => {
		/** @type {string[]} */
		const offenders: string[] = [];

		for (const path of files) {
			const source = readFileSync(path, "utf8");

			source.split("\n").forEach((line, index) => {
				// Strip comments first: `map-paint.mjs` documents the hexes it no
				// longer uses, and that prose is the record of this fix.
				const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
				const hex = code.match(/#[0-9a-fA-F]{3,8}\b/);

				if (hex) offenders.push(`${path}:${index + 1}  ${hex[0]}`);
			});
		}

		expect(offenders).toEqual([]);
	});

	it("finds no raw rgb()/rgba()/hsl() colour in any shipped source file", () => {
		const offenders: string[] = [];

		for (const path of files) {
			const source = readFileSync(path, "utf8");

			source.split("\n").forEach((line, index) => {
				const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
				const fn = code.match(/\b(rgba?|hsla?)\s*\(/);

				// `withAlpha` in map-canvas builds an rgba() string at runtime from
				// a resolved token — that is the opposite of a literal, so allow a
				// template that interpolates rather than one that hardcodes.
				if (fn && !code.includes("${")) offenders.push(`${path}:${index + 1}  ${fn[0]}`);
			});
		}

		expect(offenders).toEqual([]);
	});
});
