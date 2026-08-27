/**
 * Styles for the agent-details screen.
 *
 * Every value is a Fluent token custom property from
 * `platform/design-tokens.mjs`, never a literal — which is what makes the
 * light/dark switch a single attribute flip and keeps the palette identical to
 * the Agents panel and to the Security-UX page this was ported from.
 */
import { TONE_MARK, TRACK_BACKGROUND, themeVariables } from "../../../platform/design-tokens.mjs";

/** Tone classes, emitted once and shared by marks, tags, and the donut arc. */
function toneRules() {
	return Object.entries(TONE_MARK)
		.map(([tone, color]) => `.tone-${tone} { --tone: ${color}; color: var(--tone); }`)
		.join("\n");
}

export const DETAILS_STYLES = `
${themeVariables()}

${toneRules()}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--fontFamilyBase);
  font-size: var(--fontSizeBase300);
  line-height: var(--lineHeightBase300);
  color: var(--colorNeutralForeground1);
  /* Background2, not Background1: the page is the ground the white cards sit
     on, so it has to be the step *behind* them. */
  background: var(--colorNeutralBackground2);
  height: 100vh;
  overflow: hidden;
}

.page { display: flex; flex-direction: column; height: 100vh; }

.page-head {
  display: flex; align-items: center; gap: var(--spacingHorizontalM);
  padding: var(--spacingVerticalL) var(--spacingHorizontalXXL) var(--spacingVerticalS);
  flex-shrink: 0;
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
  padding: 0 var(--spacingHorizontalXXL) 4rem;
  display: flex; flex-direction: column; gap: var(--spacingVerticalXL);
}

/* ----- header ---------------------------------------------------------- */
.detail-head { display: flex; flex-direction: column; gap: var(--spacingVerticalM); }

.crumbs { display: flex; align-items: center; gap: var(--spacingHorizontalXS); }
.crumb-link {
  font: inherit; font-size: var(--fontSizeBase200);
  color: var(--colorNeutralForeground3);
  background: none; border: none; padding: 0;
  border-radius: var(--borderRadiusMedium); cursor: pointer;
  transition: color var(--durationFaster) var(--curveEasyEase);
}
.crumb-link:hover { color: var(--colorNeutralForeground1); text-decoration: underline; }
.crumb-sep { color: var(--colorNeutralForeground4); font-size: var(--fontSizeBase300); }
.crumb-current {
  font-size: var(--fontSizeBase200); font-weight: var(--fontWeightSemibold);
  color: var(--colorNeutralForeground1);
}

.head-row { display: flex; align-items: center; gap: var(--spacingHorizontalL); }
.head-avatar {
  display: inline-flex; align-items: center; justify-content: center;
  inline-size: 34px; block-size: 34px; flex-shrink: 0;
  border-radius: var(--borderRadiusMedium);
  background-image: linear-gradient(135deg, var(--colorBrandBackground), var(--colorBrandBackgroundPressed, var(--colorBrandForegroundLinkHover)));
  color: #ffffff;
}
.head-avatar svg { inline-size: 20px; block-size: 20px; }
.head-text { display: flex; flex-direction: column; gap: var(--spacingVerticalXS); min-width: 0; }
.head-name {
  font-size: var(--fontSizeHero700); line-height: var(--lineHeightHero700);
  font-weight: var(--fontWeightBold); letter-spacing: -0.02em;
}
.head-status { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacingHorizontalS); }
.head-verified { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }

/* The governance verdict. Soft fill rather than a solid badge: it states a
   posture, not an alert, and a solid red pill beside an agent's name reads as
   an active incident. */
.gov {
  font-size: var(--fontSizeBase200); font-weight: var(--fontWeightSemibold);
  padding: var(--spacingVerticalXXS) var(--spacingHorizontalS);
  border-radius: var(--borderRadiusMedium);
}
.gov-ungoverned { color: var(--colorStatusDangerForeground1); background: var(--colorStatusDangerBackground1); }
.gov-governed { color: var(--colorStatusSuccessForeground1); background: var(--colorStatusSuccessBackground1); }

/* ----- layout ---------------------------------------------------------- */
.detail-grid {
  display: grid;
  grid-template-columns: 1.4fr 24rem;
  gap: var(--spacingHorizontalL);
  align-items: stretch;
}
@media (max-width: 64rem) {
  .detail-grid { grid-template-columns: 1fr; gap: var(--spacingVerticalXL); align-items: start; }
}
.detail-main { display: flex; flex-direction: column; min-width: 0; }
.details-card { flex-grow: 1; }
.detail-rail { display: flex; flex-direction: column; gap: var(--spacingVerticalL); min-width: 0; }
.rail-fill { flex-grow: 1; }

/* ----- card ------------------------------------------------------------ */
.card {
  display: flex; flex-direction: column; gap: var(--spacingVerticalM);
  padding: var(--spacingHorizontalL);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  border-radius: var(--borderRadiusXLarge);
  min-width: 0;
}
.card-title {
  font-size: var(--fontSizeBase400); line-height: var(--lineHeightBase400);
  font-weight: var(--fontWeightSemibold);
}
.card-subtitle {
  font-size: var(--fontSizeBase200); line-height: var(--lineHeightBase200);
  color: var(--colorNeutralForeground3);
}

/* ----- identity list --------------------------------------------------- */
/* flex-grow lets the list own the card's leftover height (the card stretches
   to match the right rail), but the rows keep their gap rather than being
   spread across it. Spreading makes the gap a minimum rather than a rhythm, so
   the same list is spaced differently on two agents. Surplus height collects at
   the bottom, where it reads as room rather than as drift. */
.identity { display: flex; flex-direction: column; gap: var(--spacingVerticalL); flex-grow: 1; }
.identity-row { display: flex; align-items: center; gap: var(--spacingHorizontalM); min-width: 0; }
.identity-label {
  flex: 0 0 40%; min-width: 0;
  font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3);
}
.identity-value { display: flex; align-items: center; min-width: 0; flex-grow: 1; }
.value { font-size: var(--fontSizeBase300); color: var(--colorNeutralForeground1); min-width: 0; }
.value.mono {
  font-family: var(--fontFamilyMonospace); font-size: var(--fontSizeBase200);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.status-value, .avatar-value, .copy-row {
  display: flex; align-items: center; gap: var(--spacingHorizontalXS); min-width: 0;
}
.avatar-value { gap: var(--spacingHorizontalS); }
.mark { inline-size: 16px; block-size: 16px; flex-shrink: 0; }

/* The absence of a measurement, not a value that was reported. One stop back in
   the foreground ramp: the row exists so the fact is accounted for, not so the
   absence competes with the answers beside it. */
.missing { color: var(--colorNeutralForeground4); font-size: var(--fontSizeBase300); }

.face {
  display: inline-flex; align-items: center; justify-content: center;
  inline-size: 24px; block-size: 24px; flex-shrink: 0;
  border-radius: var(--borderRadiusCircular);
  background: var(--colorBrandBackground2);
  color: var(--colorNeutralForeground2);
  font-size: var(--fontSizeBase100); font-weight: var(--fontWeightSemibold);
}
/* The overlap is what makes a facepile read as one group rather than as a row
   of separate people. The ring is the surface, so each face cuts a clean edge
   out of the one behind it. */
.facepile { display: inline-flex; align-items: center; }
.facepile .face { margin-inline-start: -6px; box-shadow: 0 0 0 2px var(--colorNeutralBackground1); }
.facepile .face:first-child { margin-inline-start: 0; }
.face-more { background: var(--colorNeutralBackground3); color: var(--colorNeutralForeground3); }

.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  inline-size: 28px; block-size: 28px; flex-shrink: 0;
  border: none; border-radius: var(--borderRadiusMedium);
  background: transparent; color: var(--colorNeutralForeground3);
  font: inherit; font-size: var(--fontSizeBase400); cursor: pointer;
  transition: background var(--durationFaster) var(--curveEasyEase),
              color var(--durationFaster) var(--curveEasyEase);
}
.icon-btn:hover { background: var(--colorSubtleBackgroundHover); color: var(--colorNeutralForeground1); }
.icon-btn svg { inline-size: 16px; block-size: 16px; }
/* Copy confirms itself. Without it the only feedback is the clipboard, which is
   invisible — so the button reads as broken on a slow machine. */
.icon-btn.copied { color: var(--colorStatusSuccessForeground1); }

/* ----- risk donut ------------------------------------------------------ */
.risk-body { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--spacingHorizontalL); }
.donut-wrap {
  display: flex; flex-direction: column; align-items: center;
  gap: var(--spacingVerticalXS); flex-shrink: 0;
}
.donut { inline-size: 84px; block-size: 84px; }
.donut-track { stroke: ${TRACK_BACKGROUND}; }
.donut-fill { stroke: var(--tone); transition: stroke-dasharray var(--durationNormal) var(--curveDecelerateMid); }
.donut-score {
  font-size: 22px; font-weight: var(--fontWeightBold);
  fill: var(--colorNeutralForeground1);
  font-family: var(--fontFamilyBase);
}
.donut-caption { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }

.posture {
  display: flex; flex-direction: column; align-items: flex-start;
  gap: var(--spacingVerticalXS); flex: 1 1 12rem; min-width: 0;
}
.posture-heading {
  font-size: var(--fontSizeBase300); line-height: var(--lineHeightBase300);
  font-weight: var(--fontWeightSemibold); color: var(--colorNeutralForeground1);
}
.posture-body { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }

.tag {
  display: inline-flex; align-items: center; gap: var(--spacingHorizontalXXS);
  padding: var(--spacingVerticalXXS) var(--spacingHorizontalS);
  border-radius: var(--borderRadiusMedium);
  font-size: var(--fontSizeBase200); font-weight: var(--fontWeightSemibold);
  color: var(--tone, var(--colorNeutralForeground2));
  /* A soft wash derived from the tone rather than a second hand-picked token,
     so a retint of the ramp carries here for free. */
  background: color-mix(in srgb, var(--tone, currentColor) 12%, transparent);
}
.tag .mark { inline-size: 14px; block-size: 14px; }

/* ----- access card ----------------------------------------------------- */
.access-groups { display: flex; flex-direction: column; gap: var(--spacingVerticalL); }
.access-group { display: flex; flex-direction: column; gap: var(--spacingVerticalXS); min-width: 0; }
.access-head { display: flex; align-items: baseline; gap: var(--spacingHorizontalXS); min-width: 0; }
.access-title { font-size: var(--fontSizeBase300); font-weight: var(--fontWeightSemibold); }
.access-count { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }
.access-none { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }
.access-more { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); align-self: center; }
.chips { display: flex; flex-wrap: wrap; gap: var(--spacingHorizontalXS); min-width: 0; }
.chip {
  padding: var(--spacingVerticalXXS) var(--spacingHorizontalS);
  font-size: var(--fontSizeBase200);
  color: var(--colorNeutralForeground2);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke1);
  border-radius: var(--borderRadiusCircular);
  white-space: nowrap;
}
.chip-sev { color: var(--colorStatusWarningForeground2); border-color: var(--colorStatusWarningBorder2); }
.resource-list { display: flex; flex-direction: column; gap: var(--spacingVerticalXS); min-width: 0; }
.resource-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--spacingHorizontalS); min-width: 0;
}
.resource-name {
  font-size: var(--fontSizeBase300); font-weight: var(--fontWeightSemibold);
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.access-empty {
  display: flex; flex-direction: column; gap: var(--spacingVerticalXS);
  padding: var(--spacingVerticalXL) var(--spacingHorizontalM);
  text-align: center;
  background: var(--colorNeutralBackground3);
  border-radius: var(--borderRadiusLarge);
}
.access-empty-title { font-size: var(--fontSizeBase300); font-weight: var(--fontWeightSemibold); }
.access-empty-body { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }

/* ----- graph ----------------------------------------------------------- */
.graph-section { display: flex; flex-direction: column; gap: var(--spacingVerticalS); }
.graph-heading {
  font-size: var(--fontSizeBase500); line-height: var(--lineHeightBase500);
  font-weight: var(--fontWeightSemibold);
}
.graph-subtitle { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }

.graph-frame {
  position: relative;
  width: 100%; height: 460px;
  margin-top: var(--spacingVerticalS);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  border-radius: var(--borderRadiusXLarge);
  overflow: hidden;
  /* Declared so the pan gesture reaches us at all rather than being taken by
     the panel's own scroll. */
  touch-action: none;
  cursor: default;
}
.graph-frame.is-panning { cursor: grabbing; }
.graph-frame.is-fullscreen {
  position: fixed; inset: 0; z-index: 50;
  height: auto; margin: 0; border-radius: 0;
}
.graph-canvas { display: block; width: 100%; height: 100%; }
/* The element canvas colours are resolved against. Must be in the live themed
   tree, so it cannot be display:none — a hidden element still computes styles,
   but keeping it laid out at zero size is the form that is guaranteed to. */
.graph-probe { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }

.graph-controls {
  position: absolute; top: var(--spacingVerticalM); right: var(--spacingHorizontalM);
  z-index: 10;
  display: flex; flex-direction: column; gap: var(--spacingVerticalXXS);
  padding: var(--spacingVerticalXXS);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  border-radius: var(--borderRadiusLarge);
  box-shadow: var(--shadow2);
}

.graph-hint {
  position: absolute; left: var(--spacingHorizontalM); bottom: var(--spacingVerticalM);
  padding: var(--spacingVerticalXXS) var(--spacingHorizontalS);
  font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  border-radius: var(--borderRadiusLarge);
  /* Never what a drag lands on — the hint sits over the gesture surface. */
  pointer-events: none;
}

/* The name of the node under the pointer. A DOM element rather than more canvas
   text, because it is the one label that must be readable at a fixed size
   regardless of zoom — painting it into the bitmap would tie it to the camera
   scale and shrink it to nothing at exactly the zoom where someone is scanning.

   pointer-events:none is load-bearing: the label sits directly above the
   node that produced it, so accepting pointer events would put it under the
   cursor, steal the leave event, dismiss itself, and re-open — a flicker for as
   long as the pointer stays still. */
.graph-tooltip {
  position: absolute; z-index: 4;
  transform: translate(-50%, -100%);
  margin-top: calc(-1 * var(--spacingVerticalXS));
  max-width: 240px; padding: var(--spacingVerticalXXS) var(--spacingHorizontalS);
  font-size: var(--fontSizeBase200); font-weight: var(--fontWeightSemibold);
  color: var(--colorNeutralForeground1);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  border-radius: var(--borderRadiusMedium);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  pointer-events: none;
}

.graph-card {
  position: absolute; z-index: 5;
  transform: translate(-50%, 0);
  margin-top: var(--spacingVerticalS);
}
.node-card {
  display: flex; flex-direction: column; gap: var(--spacingVerticalXS);
  align-items: flex-start;
  min-width: 13rem; max-width: 18rem;
  padding: var(--spacingVerticalM) var(--spacingHorizontalM);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorNeutralStroke2);
  border-radius: var(--borderRadiusLarge);
  box-shadow: var(--shadow8);
}
.node-card-head { display: flex; align-items: flex-start; gap: var(--spacingHorizontalS); width: 100%; }
.node-card-titles { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.node-card-title {
  font-size: var(--fontSizeBase300); font-weight: var(--fontWeightSemibold);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.node-card-sub { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }
.node-card-stat { display: flex; align-items: baseline; gap: var(--spacingHorizontalXS); }
.node-card-value { font-size: var(--fontSizeBase500); font-weight: var(--fontWeightBold); }
.node-card-caption { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }
.node-card-detail { font-size: var(--fontSizeBase200); color: var(--colorNeutralForeground3); }

/* The keyboard mirror. Visually hidden until focused, then revealed on screen
   so a sighted keyboard user can see where they are — a focus ring on an
   invisible element is the classic way a "keyboard accessible" map is still
   unusable. */
.graph-nodes { list-style: none; }
.graph-node-btn {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
  border: none; background: none; font: inherit; color: inherit;
}
.graph-node-btn:focus-visible {
  position: absolute; left: var(--spacingHorizontalM); bottom: 3rem;
  width: auto; height: auto; overflow: visible; clip: auto; clip-path: none;
  z-index: 20;
  padding: var(--spacingVerticalXS) var(--spacingHorizontalM);
  font-size: var(--fontSizeBase200);
  color: var(--colorNeutralForeground1);
  background: var(--colorNeutralBackground1);
  border: var(--strokeWidthThin) solid var(--colorBrandStroke1);
  border-radius: var(--borderRadiusMedium);
  box-shadow: var(--shadow8);
}

.sr-only {
  position: absolute; width: 1px; height: 1px;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}

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
.gate code {
  font-family: var(--fontFamilyMonospace); font-size: var(--fontSizeBase200);
  background: var(--colorNeutralBackground3);
  padding: 2px 6px; border-radius: var(--borderRadiusSmall);
}
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

/* The canvas honours this by hand — see prefersReducedMotion in map-canvas.mjs.
   A stylesheet cannot reach a requestAnimationFrame loop painting a bitmap. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
