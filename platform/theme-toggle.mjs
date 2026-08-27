/**
 * Theme toggle for a canvas panel.
 *
 * Shared because both panels need identical behaviour and a second copy is how
 * they would drift. Theme is deliberately client-side state: it is a per-reader
 * display preference, not tenant data, so routing it through the server would
 * cost a round-trip and a full re-render to change a colour — and would make
 * two panels open side by side fight over one value.
 */

const SUN = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <circle cx="10" cy="10" r="3.5"/>
  <path d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M16 4l-1.4 1.4M5.4 14.6 4 16M16 16l-1.4-1.4M5.4 5.4 4 4" stroke-linecap="round"/>
</svg>`;

const MOON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <path d="M17 12.3A7.5 7.5 0 0 1 7.7 3a7.5 7.5 0 1 0 9.3 9.3z" stroke-linejoin="round"/>
</svg>`;

/** One key across panels, so switching theme in one is reflected in the other. */
export const THEME_KEY = "security-canvas-theme";

/**
 * The reader's stored choice, else the OS preference.
 *
 * Honouring `prefers-color-scheme` on first open matters here: the canvas is
 * embedded in an app that already has a theme, and defaulting to light inside a
 * dark host is a flash of the wrong colour on every launch.
 *
 * @returns {"light" | "dark"}
 */
export function initialTheme() {
	try {
		const stored = localStorage.getItem(THEME_KEY);
		if (stored === "light" || stored === "dark") return stored;
	} catch {
		/* storage can be unavailable in an embedded webview */
	}
	return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Wire a toggle button. Returns a function that flips the theme.
 *
 * `data-theme` on the root is the whole mechanism: the token custom properties
 * are scoped to it, so one attribute retints every component with no re-render
 * and no stylesheet swap.
 *
 * @param {HTMLElement} button
 * @returns {() => void}
 */
export function createThemeToggle(button) {
	/** @param {"light" | "dark"} theme */
	const apply = (theme) => {
		document.documentElement.dataset.theme = theme;
		button.innerHTML = theme === "dark" ? SUN : MOON;
		button.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
		try {
			localStorage.setItem(THEME_KEY, theme);
		} catch {
			// The toggle still works for this session; it just is not remembered.
		}
	};

	apply(initialTheme());
	return () => apply(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

/**
 * The inline script for the shell's `<head>`.
 *
 * Runs before first paint so the page never renders light and then flips — a
 * flash of the wrong theme on every open is exactly the kind of detail that
 * makes a panel feel unfinished.
 *
 * @returns {string}
 */
export function themeBootScript() {
	return `<script>
    (function () {
      try {
        var stored = localStorage.getItem('${THEME_KEY}');
        if (stored === 'light' || stored === 'dark') { document.documentElement.dataset.theme = stored; return; }
      } catch (e) { /* storage unavailable in some webviews */ }
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.dataset.theme = 'dark';
      }
    })();
  </script>`;
}
