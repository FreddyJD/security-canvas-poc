/**
 * Styles for the playbook screen.
 *
 * Same token set as the Agents canvas, so the two panels are visibly one
 * product. Every value is a **Lithium** custom property; nothing is a literal.
 */
import { TONE_MARK, themeVariables } from "../../../platform/design-tokens.mjs";

function toneRules() {
	return Object.entries(TONE_MARK)
		.map(([tone, color]) => `.tone-${tone} { --tone: ${color}; }`)
		.join("\n");
}

export const PLAYBOOK_STYLES = `
${themeVariables()}

${toneRules()}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--fontFamilyBase);
  font-size: var(--fontSizeBase300);
  line-height: var(--lineHeightBase300);
  color: var(--colorNeutralForeground1);
  /* Lithium's ground is a soft off-centre radial wash, not a flat fill — it is
     what separates a Lithium surface from Fluent wearing Lithium's palette.
     Composed from the theme's own gradient stops; see PAGE_BACKGROUND_PROPERTY. */
  background: var(--canvas-page-background);
  height: 100vh;
  overflow: hidden;
}
.page { display: flex; flex-direction: column; height: 100vh; }

.page-head {
  display: flex; align-items: center; gap: var(--spacingHorizontalM);
  padding: var(--spacingVerticalXL) var(--spacingHorizontalXXL) var(--spacingVerticalM);
  flex-shrink: 0;
}
h1 {
  font-size: var(--fontSizeBase600); line-height: var(--lineHeightBase600);
  font-weight: var(--fontWeightBold); letter-spacing: -0.02em;
}
h2 {
  font-size: var(--fontSizeBase200); line-height: var(--lineHeightBase200);
  font-weight: var(--fontWeightSemibold); text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--colorNeutralForeground3);
  margin-bottom: var(--spacingVerticalS);
}
.spacer { flex: 1; }

.theme-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  inline-size: 32px; block-size: 32px;
  border: none; border-radius: var(--borderRadiusMedium);
  background: transparent; color: var(--colorNeutralForeground3);
  cursor: pointer;
  transition: background var(--durationFaster) var(--curveEasyEase),
              color var(--durationFaster) var(--curveEasyEase);
}
.theme-toggle:hover { background: var(--colorSubtleBackgroundHover); color: var(--colorNeutralForeground1); }
.theme-toggle svg { inline-size: 18px; block-size: 18px; }

/* The shell no longer scrolls: it is the frame that holds a scrolling document
   and a pinned action bar. Scrolling moved inward to .doc so the bar stays put
   at the bottom of the viewport regardless of how long the script is. */
.scroll {
  flex: 1; min-height: 0; overflow: hidden;
  display: flex; flex-direction: column;
}

.doc {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 0 var(--spacingHorizontalXXL) var(--spacingVerticalXXL);
  display: flex; flex-direction: column; gap: var(--spacingVerticalL);
  max-width: 60rem;
  /* Overscroll here must not chain to the shell and drag the bar around. */
  overscroll-behavior: contain;
}

/* ----- intro ----------------------------------------------------------- */
.intro { display: flex; flex-direction: column; gap: var(--spacingVerticalS); }
.lead { font-size: var(--fontSizeBase400); line-height: var(--lineHeightBase400); }
.rationale { font-size: var(--fontSizeBase300); color: var(--colorNeutralForeground2); }

.notice {
  padding: var(--spacingVerticalS) var(--spacingHorizontalM);
  font-size: var(--fontSizeBase200);
  background: var(--colorNeutralBackground1);
  border-left: 3px solid var(--colorBrandStroke1);
  border-radius: var(--borderRadiusMedium);
  color: var(--colorNeutralForeground2);
}
.errors {
  list-style: none;
  padding: var(--spacingVerticalS) var(--spacingHorizontalM);
  background: var(--colorStatusDangerBackground1);
  border: var(--strokeWidthThin) solid var(--colorStatusDangerForeground1);
  border-radius: var(--borderRadiusMedium);
  color: var(--colorStatusDangerForeground1);
  font-size: var(--fontSizeBase200);
}

/* ----- params ---------------------------------------------------------- */
.params { display: flex; flex-direction: column; gap: var(--spacingVerticalM); }
.param-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--spacingHorizontalM);
}
.param {
  display: flex; flex-direction: column; gap: var(--spacingVerticalXS);
  padding: var(--spacingVerticalM) var(--spacingHorizontalM);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  border-radius: var(--borderRadiusXLarge);
}
.param label { font-size: var(--fontSizeBase200); font-weight: var(--fontWeightSemibold); }
.param input, .param select {
  padding: var(--spacingVerticalS) var(--spacingHorizontalS);
  font: inherit; font-size: var(--fontSizeBase300);
  color: var(--colorNeutralForeground1);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke1);
  border-radius: var(--borderRadiusMedium);
}
.param input:focus-visible, .param select:focus-visible {
  outline: var(--strokeWidthThick) solid var(--colorBrandStroke1); outline-offset: -1px;
}
.param-help { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }

/* The values, restated wherever the form is not. Aligned as one line so it
   reads as a caption on the scripts below, not as a second settings panel. */
.param-summary {
  display: flex; align-items: baseline; gap: var(--spacingHorizontalS); flex-wrap: wrap;
  font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground2);
}
.param-summary b { font-weight: var(--fontWeightSemibold); color: var(--colorNeutralForeground1); }

.link-button {
  padding: 0; font: inherit; font-size: var(--fontSizeBase200);
  background: none; border: none; cursor: pointer;
  color: var(--colorBrandForegroundLink); text-decoration: underline;
}
.link-button:hover { color: var(--colorBrandForegroundLinkHover); }
.link-button:focus-visible {
  outline: var(--strokeWidthThick) solid var(--colorBrandStroke1); outline-offset: 2px;
  border-radius: var(--borderRadiusSmall);
}

/* ----- action bar ------------------------------------------------------ */
/* One row: choice on the left, commit on the right, baseline-aligned. Equal
   padding on all four sides so the bar reads as a single band rather than a
   stack. Translucent, with the document scrolling underneath rather than
   stopping at an opaque strip — the reader can see there is more above. */
.action-bar {
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--spacingHorizontalL); flex-wrap: wrap;
  padding: var(--spacingVerticalM) var(--spacingHorizontalXXL);
  max-width: 60rem;
  background: color-mix(in srgb, var(--colorNeutralBackground2) 82%, transparent);
  backdrop-filter: blur(20px) saturate(180%);
  /* A fade where content meets the bar, not a hard 1px rule. The geometry is
     custom on purpose — this bar is pinned to the bottom, so the fade is cast
     *upward* into the content, which no shadowN token does (they all throw
     downward). Only the colour comes from the theme, so the fade deepens on the
     dark ground instead of staying a fixed black wash that disappears on it. */
  box-shadow: 0 -12px 16px -12px var(--colorNeutralShadowAmbient);
}
@media (prefers-reduced-transparency: reduce) {
  .action-bar { background: var(--colorNeutralBackground2); backdrop-filter: none; }
}

/* ----- segmented control ----------------------------------------------- */
/* One track, three labels. A track reads as "pick exactly one of these",
   which three separate cards did not. */
.segmented {
  display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  gap: 2px; padding: 3px;
  background: var(--colorNeutralBackground6);
  border-radius: var(--borderRadiusLarge);
}
.segment {
  padding: var(--spacingVerticalS) var(--spacingHorizontalL);
  font: inherit; font-size: var(--fontSizeBase300); font-weight: var(--fontWeightSemibold);
  white-space: nowrap;
  color: var(--colorNeutralForeground2);
  background: transparent; border: none; border-radius: var(--borderRadiusMedium);
  cursor: pointer;
  /* Named properties only, and ease-out so the press reads as immediate. */
  transition: background var(--durationFaster) var(--curveEasyEase),
              color var(--durationFaster) var(--curveEasyEase),
              transform var(--durationFaster) var(--curveEasyEase);
}
@media (hover: hover) and (pointer: fine) {
  .segment:hover { color: var(--colorNeutralForeground1); }
}
/* Feedback on press, not on release. */
.segment:active { transform: scale(0.97); }
.segment.selected {
  color: var(--colorNeutralForeground1);
  background: var(--colorNeutralBackground1);
  box-shadow: var(--shadow2);
}
.segment:focus-visible {
  outline: var(--strokeWidthThick) solid var(--colorBrandStroke1); outline-offset: 1px;
}
@media (max-width: 40rem) {
  .segmented { grid-auto-flow: row; width: 100%; }
  .action-bar { flex-direction: column; align-items: stretch; }
}

/* "Nothing has been changed in here yet." A dot rather than a count: the
   number of untouched fields is not actionable, the fact that none were is. */
.tab-dot {
  display: inline-block; inline-size: 6px; block-size: 6px;
  margin-inline-start: var(--spacingHorizontalXS); vertical-align: middle;
  background: var(--colorBrandForeground1); border-radius: var(--borderRadiusCircular);
}

/* ----- auto ------------------------------------------------------------ */
.auto { display: flex; flex-direction: column; gap: var(--spacingVerticalS); margin-bottom: var(--spacingVerticalL); }
.auto-note { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground2); max-width: 46rem; }
/* The auto script is long; cap it so the button below stays reachable
   without scrolling past a screenful of PowerShell. */
.auto pre { max-height: 22rem; overflow-y: auto; }

/* ----- progress -------------------------------------------------------- */
.progress { display: flex; align-items: center; gap: var(--spacingHorizontalM); margin-bottom: var(--spacingVerticalM); }
.progress-track {
  flex: 1; block-size: 4px; border-radius: var(--borderRadiusCircular);
  background: var(--colorNeutralBackground6); overflow: hidden;
}
.progress-track > i {
  display: block; block-size: 100%; background: var(--colorBrandForeground1);
  transition: width var(--durationNormal) var(--curveDecelerateMid);
}
.progress-label { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); white-space: nowrap; }

/* The commit button. Never moves between panes: same size, same corner, only
   the label and colour change, so the target is muscle memory. */
.bar-button {
  display: inline-flex; align-items: center; gap: var(--spacingHorizontalS);
  flex-shrink: 0; white-space: nowrap;
}
.bar-button svg { inline-size: 16px; block-size: 16px; }

button.primary {
  padding: var(--spacingVerticalS) var(--spacingHorizontalXL);
  font: inherit; font-weight: var(--fontWeightSemibold);
  color: var(--colorNeutralForegroundOnBrand); background: var(--colorBrandBackground);
  border: none; border-radius: var(--borderRadiusMedium);
  cursor: pointer;
  transition: background var(--durationFaster) var(--curveEasyEase),
              transform var(--durationFaster) var(--curveEasyEase);
}
@media (hover: hover) and (pointer: fine) {
  button.primary:hover { background: var(--colorBrandForegroundLinkHover); }
}
/* Instant confirmation that the press landed. */
button.primary:active { transform: scale(0.97); }
button.primary:focus-visible {
  outline: var(--strokeWidthThick) solid var(--colorBrandStroke1); outline-offset: 2px;
}

/* The auto-mode button hands over something that will change the tenant with
   nobody reading between the commands. It is the same button in the same
   place, in the colour that says so. */
button.primary.danger { background: var(--colorStatusDangerBackground3); }
@media (hover: hover) and (pointer: fine) {
  button.primary.danger:hover { background: var(--colorStatusDangerForeground1); }
}

@media (prefers-reduced-motion: reduce) {
  .segment:active, button.primary:active { transform: none; }
  .progress-track > i { transition: none; }
}

/* ----- steps ----------------------------------------------------------- */
.steps { list-style: none; display: flex; flex-direction: column; gap: var(--spacingVerticalS); }
.step {
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  border-radius: var(--borderRadiusXLarge);
  overflow: hidden;
  transition: border-color var(--durationFaster) var(--curveEasyEase);
}
.step.open { border-color: var(--colorBrandStroke2); }

.step-head {
  display: flex; align-items: center; gap: var(--spacingHorizontalM);
  width: 100%; padding: var(--spacingVerticalM) var(--spacingHorizontalM);
  font: inherit; text-align: left; cursor: pointer;
  background: none; border: none; color: inherit;
}
.step-head:hover { background: var(--colorSubtleBackgroundHover); }

/* The number becomes a tick once the operator says they ran it, so the list
   reads as a checklist rather than as a set of equally-pending cards. */
.step-index {
  display: inline-flex; align-items: center; justify-content: center;
  inline-size: 24px; block-size: 24px; flex-shrink: 0;
  border-radius: var(--borderRadiusCircular);
  background: var(--colorNeutralBackground3); color: var(--colorNeutralForeground2);
  font-size: var(--fontSizeBase200); font-weight: var(--fontWeightSemibold);
}
.step-index svg { inline-size: 13px; block-size: 13px; }
.step.done .step-index {
  background: var(--colorStatusSuccessBackground1);
  color: var(--colorStatusSuccessForeground1);
}
.step-title { flex: 1; font-weight: var(--fontWeightSemibold); min-width: 0; }
.step.done .step-title { color: var(--colorNeutralForeground3); }
.step-kind {
  font-size: var(--fontSizeBase100); text-transform: uppercase; letter-spacing: 0.05em;
  font-weight: var(--fontWeightSemibold);
  padding: 2px var(--spacingHorizontalS); border-radius: var(--borderRadiusCircular);
  background: var(--colorNeutralBackground3); color: var(--colorNeutralForeground3);
  white-space: nowrap; flex-shrink: 0;
}

.step-body {
  padding: 0 var(--spacingHorizontalM) var(--spacingVerticalM);
  display: flex; flex-direction: column; gap: var(--spacingVerticalS);
}
.step-body p { color: var(--colorNeutralForeground2); max-width: 46rem; }
.step-docs {
  font-size: var(--fontSizeBase200); color: var(--colorBrandForegroundLink);
  text-underline-offset: 2px; width: fit-content;
}
.step-docs:hover { color: var(--colorBrandForegroundLinkHover); }

.step-done {
  display: inline-flex; align-items: center; gap: var(--spacingHorizontalS);
  font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground2);
  cursor: pointer; width: fit-content; margin-top: var(--spacingVerticalXS);
}
.step-done input { inline-size: 15px; block-size: 15px; accent-color: var(--colorBrandBackground); cursor: pointer; }

/* ----- scripts --------------------------------------------------------- */
.script {
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  border-radius: var(--borderRadiusLarge);
  overflow: hidden;
}
/* A tenant-changing block is outlined in the warning tone so it is obvious
   before the text is read. Read-only blocks are deliberately left plain --
   marking everything would make the mark mean nothing. */
.script.destructive { border-color: var(--colorStatusWarningBorder2); }

.script-warning, .script-effect {
  display: flex; align-items: flex-start; gap: var(--spacingHorizontalS);
  padding: var(--spacingVerticalS) var(--spacingHorizontalM);
  font-size: var(--fontSizeBase200);
}
.script-warning {
  background: var(--colorStatusWarningBackground1);
  color: var(--colorStatusWarningForeground2);
  font-weight: var(--fontWeightSemibold);
}
.script-warning svg { inline-size: 15px; block-size: 15px; flex-shrink: 0; margin-top: 1px; }
.script-effect { color: var(--colorNeutralForeground3); background: var(--colorNeutralBackground2); }

.script-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--spacingVerticalXS) var(--spacingHorizontalS) var(--spacingVerticalXS) var(--spacingHorizontalM);
  background: var(--colorNeutralBackground3);
  border-bottom: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
}
.script-lang {
  font-size: var(--fontSizeBase100); text-transform: uppercase; letter-spacing: 0.06em;
  font-weight: var(--fontWeightSemibold); color: var(--colorNeutralForeground3);
}
.copy-button {
  display: inline-flex; align-items: center; gap: var(--spacingHorizontalXS);
  padding: var(--spacingVerticalXS) var(--spacingHorizontalS);
  font: inherit; font-size: var(--fontSizeBase200);
  color: var(--colorBrandForegroundLink);
  background: none; border: none; border-radius: var(--borderRadiusMedium);
  cursor: pointer;
}
.copy-button:hover { background: var(--colorSubtleBackgroundHover); }
.copy-button svg { inline-size: 13px; block-size: 13px; }
.copy-button.copied { color: var(--colorStatusSuccessForeground1); }

pre {
  padding: var(--spacingVerticalM) var(--spacingHorizontalM);
  background: var(--colorNeutralBackground3);
  overflow-x: auto;
}
code {
  font-family: var(--fontFamilyMonospace);
  font-size: var(--fontSizeBase200); line-height: var(--lineHeightBase300);
  color: var(--colorNeutralForeground1);
  white-space: pre;
}

:focus-visible {
  outline: var(--strokeWidthThick) solid var(--colorBrandStroke1);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
