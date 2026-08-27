/**
 * Styles for the Agents screen.
 *
 * Every value is a Fluent token custom property from
 * `platform/design-tokens.mjs`, never a literal — which is what makes the
 * light/dark switch a single attribute flip and keeps the palette identical to
 * the Security-UX Agents page.
 */
import { TONE_MARK, TRACK_BACKGROUND, themeVariables } from "../../../platform/design-tokens.mjs";

/** Tone classes, emitted once and shared by dots and meter segments. */
function toneRules() {
	return Object.entries(TONE_MARK)
		.map(([tone, color]) => `.tone-${tone} { --tone: ${color}; }`)
		.join("\n");
}

export const INVENTORY_STYLES = `
${themeVariables()}

${toneRules()}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--fontFamilyBase);
  font-size: var(--fontSizeBase300);
  line-height: var(--lineHeightBase300);
  color: var(--colorNeutralForeground1);
  /* Background2, not Background1: the page is the ground the white cards and
     the table sit on, so it has to be the step *behind* them. */
  background: var(--colorNeutralBackground2);
  height: 100vh;
  overflow: hidden;
}

.page { display: flex; flex-direction: column; height: 100vh; }

/* ----- header ---------------------------------------------------------- */
.page-head {
  display: flex;
  align-items: center;
  gap: var(--spacingHorizontalM);
  padding: var(--spacingVerticalXL) var(--spacingHorizontalXXL) var(--spacingVerticalM);
  flex-shrink: 0;
}
h1 {
  font-size: var(--fontSizeHero700);
  line-height: var(--lineHeightHero700);
  font-weight: var(--fontWeightBold);
  letter-spacing: -0.02em;
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
}

/* ----- metric cards ---------------------------------------------------- */
.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: var(--spacingHorizontalM);
  align-items: stretch;
}
.metric-card {
  position: relative;
  display: flex; flex-direction: column; align-items: flex-start;
  gap: var(--spacingVerticalXXS);
  padding: var(--spacingHorizontalM);
  width: 100%; min-width: 0;
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  border-radius: var(--borderRadiusXLarge);
  transition: background var(--durationFaster) var(--curveEasyEase),
              border-color var(--durationFaster) var(--curveEasyEase);
}
.metric-card:hover { background: var(--colorNeutralBackground1Hover); }

/* Marked twice -- brand border and brand-tinted fill -- because which slice is
   in effect is the one thing on this row that has to be visible at a glance
   and across a colorblind range. aria-pressed carries it for everyone else. */
.metric-card.selected {
  border-color: var(--colorBrandStroke1);
  background: var(--colorBrandBackground2);
}
.metric-card.selected:hover { background: var(--colorBrandBackground2); }

/* The filter, stretched over the whole card. Absolutely positioned so it is a
   hit area and nothing else: a zero-size flex child still consumes a gap. */
.metric-toggle {
  position: absolute; inset: 0;
  border: none; background: none; padding: 0;
  border-radius: var(--borderRadiusXLarge);
  cursor: pointer;
}
.metric-label {
  font-size: var(--fontSizeBase300); line-height: var(--lineHeightBase300);
  font-weight: var(--fontWeightSemibold);
}
.metric-value {
  font-size: var(--fontSizeBase600); line-height: var(--lineHeightBase600);
  font-weight: var(--fontWeightBold); letter-spacing: -0.02em;
}
.metric-share {
  font-size: var(--fontSizeBase200); line-height: var(--lineHeightBase200);
  color: var(--colorNeutralForeground3);
}
/* z-index lifts the link clear of the toggle covering the card -- without it
   the toggle swallows every click aimed here. */
.metric-breakdown {
  position: relative; z-index: 1;
  margin-top: var(--spacingVerticalS);
  border: none; background: none; padding: 0;
  font: inherit; font-size: var(--fontSizeBase200);
  color: var(--colorBrandForegroundLink);
  text-decoration: underline; text-underline-offset: 2px;
  cursor: pointer;
}
.metric-breakdown:hover { color: var(--colorBrandForegroundLinkHover); }

/* ----- filter bar ------------------------------------------------------ */
.filter-bar {
  display: flex; align-items: center; gap: var(--spacingHorizontalS);
  flex-wrap: wrap;
}
.search {
  position: relative;
  display: inline-flex; align-items: center;
  min-width: 18rem;
}
.search-icon {
  position: absolute; left: var(--spacingHorizontalM);
  display: inline-flex; color: var(--colorNeutralForeground3);
  pointer-events: none;
}
.search-icon svg { inline-size: 16px; block-size: 16px; }
.search input {
  width: 100%;
  padding: var(--spacingVerticalS) var(--spacingHorizontalM) var(--spacingVerticalS) 2.25rem;
  font: inherit;
  color: var(--colorNeutralForeground1);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke1);
  border-radius: var(--borderRadiusCircular);
}
.search input::placeholder { color: var(--colorNeutralForeground4); }
.search input:focus-visible { outline: var(--strokeWidthThick) solid var(--colorBrandStroke1); outline-offset: -1px; }

.pills { display: flex; flex-wrap: wrap; gap: var(--spacingHorizontalXS); }
.pill {
  padding: var(--spacingVerticalXS) var(--spacingHorizontalM);
  font: inherit; font-size: var(--fontSizeBase200);
  color: var(--colorNeutralForeground2);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke1);
  border-radius: var(--borderRadiusCircular);
  cursor: pointer; white-space: nowrap;
  transition: background var(--durationFaster) var(--curveEasyEase),
              border-color var(--durationFaster) var(--curveEasyEase);
}
.pill:hover { background: var(--colorNeutralBackground1Hover); }
.pill.active {
  color: var(--colorBrandForeground1);
  background: var(--colorBrandBackground2);
  border-color: var(--colorBrandStroke1);
}

.result-count { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }

.icon-button {
  display: inline-flex; align-items: center; gap: var(--spacingHorizontalXS);
  padding: var(--spacingVerticalXS) var(--spacingHorizontalS);
  font: inherit; font-size: var(--fontSizeBase200);
  color: var(--colorBrandForegroundLink);
  background: none; border: none; border-radius: var(--borderRadiusMedium);
  cursor: pointer;
}
.icon-button:hover { background: var(--colorSubtleBackgroundHover); }
.icon-button svg { inline-size: 14px; block-size: 14px; }

.scope-note {
  font-size: var(--fontSizeBase200); line-height: var(--lineHeightBase200);
  color: var(--colorNeutralForeground3);
}

/* ----- table ----------------------------------------------------------- */
.table-wrap {
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  border-radius: var(--borderRadiusXLarge);
  overflow: hidden;
}
.agent-table { width: 100%; border-collapse: collapse; }
.agent-table th {
  text-align: left; padding: 0;
  border-bottom: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  position: sticky; top: 0; z-index: 1;
  background: var(--colorNeutralBackground1);
}
.th-button {
  display: flex; align-items: center; gap: var(--spacingHorizontalXS);
  width: 100%;
  padding: var(--spacingVerticalM) var(--spacingHorizontalM);
  font: inherit; font-size: var(--fontSizeBase200);
  font-weight: var(--fontWeightSemibold);
  color: var(--colorNeutralForeground2);
  background: none; border: none; cursor: pointer; text-align: left;
}
.th-button:hover { background: var(--colorSubtleBackgroundHover); }
.th-button.active { color: var(--colorNeutralForeground1); }
.caret { font-size: 9px; color: var(--colorBrandForeground1); }

.agent-table td {
  padding: var(--spacingVerticalXS) var(--spacingHorizontalM);
  border-bottom: var(--strokeWidthThin) solid var(--colorNeutralStroke3);
  vertical-align: middle;
}
.agent-table tbody tr:last-child td { border-bottom: none; }
.agent-table tbody tr { transition: background var(--durationFaster) var(--curveEasyEase); }
.agent-table tbody tr:hover { background: var(--colorSubtleBackgroundHover); }
.cell-text { font-size: var(--fontSizeBase300); color: var(--colorNeutralForeground1); }
.empty-row {
  padding: 3rem var(--spacingHorizontalM) !important;
  text-align: center; color: var(--colorNeutralForeground3);
}

/* ----- cells ----------------------------------------------------------- */
.title-cell {
  display: flex; align-items: center; gap: var(--spacingHorizontalS);
  padding: var(--spacingVerticalS) 0;
  min-width: 0;
}
/* Holds its size against a long title: as a flex item the media is the one
   that would otherwise give way, and a squashed icon is worse than a
   truncated word. */
.tile {
  display: inline-flex; align-items: center; justify-content: center;
  inline-size: 28px; block-size: 28px; flex-shrink: 0;
  border-radius: var(--borderRadiusMedium);
  background: var(--colorNeutralBackground3);
  color: var(--colorNeutralForeground3);
}
.tile svg { inline-size: 18px; block-size: 18px; }
.title-text { display: flex; flex-direction: column; min-width: 0; }
.title-name {
  font-size: var(--fontSizeBase300); line-height: var(--lineHeightBase300);
  font-weight: var(--fontWeightSemibold);
  color: var(--colorNeutralForeground1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.title-sub {
  font-size: var(--fontSizeBase200); line-height: var(--lineHeightBase200);
  color: var(--colorNeutralForeground3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* The absence of a measurement, not a value that was reported. */
.dim-italic {
  font-style: italic;
  font-size: var(--fontSizeBase300);
  color: var(--colorNeutralForeground4);
}

.person-cell { display: flex; align-items: center; gap: var(--spacingHorizontalS); min-width: 0; }
.avatar {
  display: inline-flex; align-items: center; justify-content: center;
  inline-size: 26px; block-size: 26px; flex-shrink: 0;
  border-radius: var(--borderRadiusCircular);
  background: var(--colorBrandBackground2);
  color: var(--colorNeutralForeground2);
  font-size: var(--fontSizeBase100); font-weight: var(--fontWeightSemibold);
}
.person-name {
  font-size: var(--fontSizeBase300);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.status-cell { display: flex; align-items: center; gap: var(--spacingHorizontalXS); min-width: 0; }
/* flex-shrink: 0 so a long status word cannot squash the circle into an oval. */
.status-dot {
  inline-size: 8px; block-size: 8px; flex-shrink: 0;
  border-radius: var(--borderRadiusCircular);
  background: var(--tone, var(--colorNeutralForeground2));
}
/* The word stays neutral ink while the dot carries the tone: tinting both makes
   the column a run of coloured text, where hue stops being a signal. */
.status-label { font-size: var(--fontSizeBase200); white-space: nowrap; color: var(--colorNeutralForeground2); }

.meter-cell { display: flex; align-items: center; gap: var(--spacingHorizontalS); min-width: 0; }
.meter { display: flex; gap: var(--spacingHorizontalXXS); flex-shrink: 0; }
/* The unfilled state is the base, so a segment is a track until a tone is
   merged over it. At zero fill all four stay here, which makes this the colour
   a "none" row is drawn entirely in. */
.meter-seg {
  inline-size: 10px; block-size: 10px;
  border-radius: var(--borderRadiusSmall);
  background: ${TRACK_BACKGROUND};
}
.meter-seg.filled { background: var(--tone); }
.meter-label { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground2); white-space: nowrap; }

/* ----- pager ----------------------------------------------------------- */
.pager { display: flex; align-items: center; justify-content: center; gap: var(--spacingHorizontalM); }
.page-button {
  padding: var(--spacingVerticalXS) var(--spacingHorizontalM);
  font: inherit; font-size: var(--fontSizeBase200);
  color: var(--colorNeutralForeground2);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke1);
  border-radius: var(--borderRadiusMedium);
  cursor: pointer;
}
.page-button:hover:not(:disabled) { background: var(--colorNeutralBackground1Hover); }
.page-button:disabled { color: var(--colorNeutralForegroundDisabled); cursor: default; }
.page-status { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }

/* ----- gate ------------------------------------------------------------ */
.gate {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; text-align: center;
  gap: var(--spacingVerticalM); padding: 3rem var(--spacingHorizontalXXL);
}
.gate-icon { inline-size: 40px; block-size: 40px; opacity: 0.5; }
.gate h2 { font-size: var(--fontSizeBase500); font-weight: var(--fontWeightSemibold); }
.gate p { color: var(--colorNeutralForeground3); max-width: 34rem; }
.gate-hint { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground4); }
.err { color: var(--colorStatusDangerForeground1); }

button.primary {
  padding: var(--spacingVerticalS) var(--spacingHorizontalXL);
  font: inherit; font-weight: var(--fontWeightSemibold);
  color: #ffffff; background: var(--colorBrandBackground);
  border: none; border-radius: var(--borderRadiusMedium);
  cursor: pointer;
}
button.primary:hover { background: var(--colorBrandForegroundLinkHover); }

.spin {
  display: inline-block; vertical-align: -2px; margin-right: var(--spacingHorizontalS);
  inline-size: 14px; block-size: 14px;
  border: 2px solid var(--colorNeutralStroke2);
  border-top-color: var(--colorBrandForeground1);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

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
