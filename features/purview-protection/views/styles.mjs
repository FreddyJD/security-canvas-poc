/**
 * Styles for the playbook screen.
 *
 * Same token set as the Agents canvas, so the two panels are visibly one
 * product. Every value is a Fluent custom property; nothing is a literal.
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
  background: var(--colorNeutralBackground2);
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

.scroll {
  flex: 1; min-height: 0; overflow-y: auto;
  padding: 0 var(--spacingHorizontalXXL) var(--spacingVerticalXXL);
  display: flex; flex-direction: column; gap: var(--spacingVerticalL);
  max-width: 60rem;
}

/* ----- coverage -------------------------------------------------------- */
.coverage {
  padding: var(--spacingVerticalM) var(--spacingHorizontalM);
  background: var(--colorBrandBackground2);
  border: var(--strokeWidthThin) solid var(--colorBrandStroke2);
  border-radius: var(--borderRadiusXLarge);
}
.coverage-summary { font-weight: var(--fontWeightSemibold); }
.coverage-stats { display: flex; gap: var(--spacingHorizontalL); margin-top: var(--spacingVerticalS); }
.stat { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground2); }
.stat b {
  display: block; font-size: var(--fontSizeBase500); line-height: var(--lineHeightBase500);
  font-weight: var(--fontWeightBold); color: var(--colorNeutralForeground1);
}
.coverage-examples {
  margin-top: var(--spacingVerticalS);
  font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground2);
}
.dim { color: var(--colorNeutralForeground3); }

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

.handoff-note {
  font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3);
  margin-bottom: var(--spacingVerticalS); max-width: 46rem;
}
.send-button {
  display: inline-flex; align-items: center; gap: var(--spacingHorizontalS);
  margin-bottom: var(--spacingVerticalL);
}
.send-button svg { inline-size: 16px; block-size: 16px; }

button.primary {
  padding: var(--spacingVerticalS) var(--spacingHorizontalXL);
  font: inherit; font-weight: var(--fontWeightSemibold);
  color: #ffffff; background: var(--colorBrandBackground);
  border: none; border-radius: var(--borderRadiusMedium);
  cursor: pointer;
  transition: background var(--durationFaster) var(--curveEasyEase);
}
button.primary:hover { background: var(--colorBrandForegroundLinkHover); }

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
