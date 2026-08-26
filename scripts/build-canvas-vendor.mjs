#!/usr/bin/env node
/**
 * Regenerates extensions/security-canvas/vendor/ from the compiled TypeScript.
 *
 * Why this exists: a Copilot plugin install is a plain file copy. No
 * `npm install` runs, so `node_modules` never exists at runtime and a declared
 * npm dependency is never fetched. The canvas can therefore only import Node
 * builtins, `@github/copilot-sdk` (injected by the app), and files committed
 * alongside it.
 *
 * The scoring engine (correlate + risk-catalog) compiles to ESM with zero
 * external imports, so it can be copied verbatim and shared with the MCP
 * server. This script is the only supported way to produce vendor/ — do not
 * edit those files by hand.
 *
 * Usage: npm run build && node scripts/build-canvas-vendor.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const vendorDir = join(root, "extensions", "security-canvas", "vendor");

const MODULES = ["risk-catalog.js", "correlate.js"];

if (!existsSync(distDir)) {
	console.error("dist/ not found. Run `npm run build` first.");
	process.exit(1);
}

mkdirSync(vendorDir, { recursive: true });

const banner = (name) =>
	`// GENERATED FILE — do not edit.\n` +
	`// Source: src/${name.replace(/\.js$/, ".ts")}\n` +
	`// Regenerate: npm run build && node scripts/build-canvas-vendor.mjs\n` +
	`//\n` +
	`// Vendored because a Copilot plugin install never runs npm install.\n\n`;

let failed = false;
for (const name of MODULES) {
	const src = join(distDir, name);
	if (!existsSync(src)) {
		console.error(`missing ${src}`);
		failed = true;
		continue;
	}
	const code = readFileSync(src, "utf8");

	// Guard the invariant this whole approach depends on: these modules must
	// not import anything that would need node_modules at runtime.
	const badImport = [...code.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)]
		.map((m) => m[1])
		.find((spec) => !spec.startsWith("./") && !spec.startsWith("../") && !spec.startsWith("node:"));
	if (badImport) {
		console.error(`${name} imports "${badImport}" — cannot vendor a module with external deps.`);
		failed = true;
		continue;
	}

	writeFileSync(join(vendorDir, name.replace(/\.js$/, ".mjs")), banner(name) + code.replace(/\.js"/g, '.mjs"'));
	console.log(`  vendored ${name} -> vendor/${name.replace(/\.js$/, ".mjs")}`);
}

process.exit(failed ? 1 : 0);
