/**
 * Browser entry point for the playbook screen.
 *
 * Subscribes to state, renders the view, turns interaction into POSTs.
 * Everything except copy-to-clipboard round-trips through the server, so the
 * canvas and any tool call see the same state.
 */
import { createThemeToggle } from "../../../platform/theme-toggle.mjs";
import { renderPlaybook } from "./playbook-screen.mjs";

/** @param {string} id */
function el(id) {
	const node = document.getElementById(id);
	if (!node) throw new Error(`Canvas shell is missing #${id}`);
	return node;
}

const ui = { main: el("main"), theme: el("theme-toggle") };
const toggleTheme = createThemeToggle(ui.theme);

/**
 * @param {string} url
 * @param {Record<string, unknown>} [body]
 */
const post = (url, body) =>
	fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body || {}),
	});

/** @param {any} vm */
function render(vm) {
	// Preserve focus and caret across a re-render, so editing a parameter does
	// not eject the reader from the field they are typing in.
	const active = document.activeElement;
	const activeParam = active instanceof HTMLElement ? active.dataset.param : undefined;
	const caret = active instanceof HTMLInputElement ? active.selectionStart : null;

	ui.main.innerHTML = renderPlaybook(vm);

	if (activeParam) {
		const next = document.querySelector(`[data-param="${activeParam}"]`);
		if (next instanceof HTMLElement) {
			next.focus();
			if (next instanceof HTMLInputElement && caret !== null) next.setSelectionRange(caret, caret);
		}
	}
}

/**
 * @param {EventTarget | null} target
 * @param {string} selector
 * @returns {HTMLElement | null}
 */
function closest(target, selector) {
	return target instanceof Element ? /** @type {HTMLElement | null} */ (target.closest(selector)) : null;
}

/**
 * Copy a script block.
 *
 * Reads the rendered `<pre>` rather than a copy of the string held in JS: what
 * lands on the clipboard is then provably the same text the operator just read,
 * which matters when the next thing they do is paste it into an admin shell.
 *
 * @param {HTMLElement} button
 */
async function copyScript(button) {
	const stepId = button.dataset.copy;
	const pre = document.getElementById(`script-${stepId}`);
	if (!pre?.textContent) return;

	try {
		await navigator.clipboard.writeText(pre.textContent);
	} catch {
		// Clipboard access can be denied in an embedded webview. The script is
		// on screen and selectable, so this is a lost convenience, not a dead end.
		return;
	}

	const label = button.querySelector("span");
	if (!label) return;
	button.classList.add("copied");
	label.textContent = "Copied";
	setTimeout(() => {
		button.classList.remove("copied");
		label.textContent = "Copy";
	}, 1600);
}

document.addEventListener("click", (e) => {
	if (closest(e.target, "#theme-toggle")) return toggleTheme();

	const copy = closest(e.target, "[data-copy]");
	if (copy) return void copyScript(copy);

	const step = closest(e.target, "[data-step]");
	if (step) return void post("/api/playbook/step", { stepId: step.dataset.step });

	const action = closest(e.target, "[data-action]");
	if (action?.dataset.action === "handoff") return void post("/api/playbook/handoff");
});

document.addEventListener("change", (e) => {
	const target = e.target;
	if (!(target instanceof HTMLElement)) return;

	const done = target.dataset.done;
	if (done) return void post("/api/playbook/done", { stepId: done });

	const param = target.dataset.param;
	if (param && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
		post("/api/playbook/params", { [param]: target.value });
	}
});

new EventSource("/api/playbook/events").addEventListener("state", (e) => {
	render(JSON.parse(/** @type {MessageEvent} */ (e).data));
});
