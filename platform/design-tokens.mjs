/**
 * The **Lithium** design tokens, as CSS custom properties.
 *
 * These are the real `lithiumLightTheme` / `lithiumDarkTheme` values from
 * `@sfe/react-theme` — the same package and the same two themes that
 * Security-UX's Unified UX POC and Perception render — generated from the
 * package rather than eyeballed, so every value here traces to a token there.
 *
 * ### Why the values are copied instead of imported
 *
 * Forced by the runtime: a Copilot plugin install is a plain file copy, so
 * `node_modules` never exists and `@sfe/react-theme` cannot be resolved. SFE's
 * components would additionally need React, a bundler and a build step this
 * canvas deliberately does not have.
 *
 * The token map is the part that transfers without any of that. What does *not*
 * transfer is `lithiumCustomStyleHooks`, the 54 hooks that restyle Fluent's
 * React components — nothing here renders a Fluent component, so there is
 * nothing for them to restyle. The stylesheets under `features/*` play that
 * role and are written against these tokens directly.
 *
 * ### The radius ramp is remapped, not hand-typed
 *
 * Lithium ships `borderRadiusMedium: 4px`, but Perception draws with 16px. It
 * gets there by looking up which existing token *already holds* 16px and
 * pointing the ramp at that token's value rather than typing a literal, so an
 * SFE restyle carries through instead of being overwritten. That lookup is
 * already applied below, exactly as `unifieduxTheme.ts` applies it at runtime.
 *
 * Emitted under `:root` and `[data-theme="dark"]`, which makes theme switching
 * a single attribute flip rather than a re-render — no stylesheet swap, no
 * flash, and every component inherits it for free.
 *
 * Do not edit by hand. Regenerate with:
 *   node scripts/generate-design-tokens.mjs <path-to-@sfe/react-theme> > platform/design-tokens.mjs
 *
 * @generated from @sfe/react-theme@0.10.1
 */

/**
 * Values that differ between light and dark.
 * @type {Record<string, [light: string, dark: string]>}
 */
const THEMED = {
	colorBrandBackground: ["#00449B", "#0052B3"],
	colorBrandBackground2: ["#D9F1FF", "#002A6D"],
	colorBrandBackground2Hover: ["#B9E0FF", "#003784"],
	colorBrandBackground2Pressed: ["#75BCFF", "#000630"],
	colorBrandBackgroundHover: ["#003784", "#0060CA"],
	colorBrandBackgroundPressed: ["#001D58", "#002A6D"],
	colorBrandBackgroundSelected: ["#003784", "#00449B"],
	colorBrandForeground1: ["#0060CA", "#2496FF"],
	colorBrandForeground2: ["#0052B3", "#2496FF"],
	colorBrandForeground2Hover: ["#00449B", "#75BCFF"],
	colorBrandForeground2Pressed: ["#001D58", "#D9F1FF"],
	colorBrandForegroundInverted: ["#0084F1", "#2496FF"],
	colorBrandForegroundLink: ["#0052B3", "#75BCFF"],
	colorBrandForegroundLinkHover: ["#00449B", "#98CEFF"],
	colorBrandForegroundLinkPressed: ["#002A6D", "#B9E0FF"],
	colorBrandForegroundLinkSelected: ["#0052B3", "#75BCFF"],
	colorBrandStroke1: ["#0060CA", "#0084F1"],
	colorBrandStroke2Contrast: ["#98CEFF", "#003784"],
	colorBrandStroke2Hover: ["#4DA9FF", "#003784"],
	colorBrandStroke2Pressed: ["#0060CA", "#001D58"],
	colorCompoundBrandBackground: ["#0060CA", "#0084F1"],
	colorCompoundBrandBackgroundHover: ["#0052B3", "#0084F1"],
	colorCompoundBrandBackgroundPressed: ["#00449B", "#0072DD"],
	colorCompoundBrandForeground1: ["#0060CA", "#0084F1"],
	colorCompoundBrandForeground1Hover: ["#0052B3", "#2496FF"],
	colorCompoundBrandForeground1Pressed: ["#00449B", "#0072DD"],
	colorCompoundBrandStroke: ["#0052B3", "#0084F1"],
	colorCompoundBrandStrokeHover: ["#00449B", "#0072DD"],
	colorCompoundBrandStrokePressed: ["#00449B", "#0072DD"],
	colorDataVizSlot11: ["#3c51b4", "#93a4f4"],
	colorDataVizSlot12: ["#ad006a", "#ee5fb7"],
	colorDataVizSlot13: ["#026467", "#4cb4b7"],
	colorDataVizSlot14: ["#674c8c", "#a083c9"],
	colorDataVizSlot15: ["#0e7a0b", "#27ac22"],
	colorDataVizSlot16: ["#2c72a8", "#4fa1e1"],
	colorDataVizSlot17: ["#9a3d0c", "#d77440"],
	colorDataVizSlot18: ["#405f14", "#73aa24"],
	colorDataVizSlot19: ["#863593", "#c36bd1"],
	colorDataVizSlot20: ["#6d5700", "#d0b232"],
	colorDataVizSlot30: ["#937700", "#c19c00"],
	colorDataVizSlot31: ["#2c3c85", "#c8d1fa"],
	colorDataVizSlot32: ["#7f004e", "#f7adda"],
	colorDataVizSlot33: ["#02494c", "#9bd9db"],
	colorDataVizSlot34: ["#4c3867", "#b29ad4"],
	colorDataVizSlot35: ["#0b5a08", "#a7e3a5"],
	colorDataVizSlot36: ["#20547c", "#83bdeb"],
	colorDataVizSlot37: ["#712d09", "#df8e64"],
	colorDataVizSlot38: ["#23330b", "#a4cc6c"],
	colorDataVizSlot39: ["#63276d", "#cf87da"],
	colorDataVizSlot40: ["#3a2f00", "#dac157"],
	colorNeutralBackground1: ["#FFFFFF", "#1B212D"],
	colorNeutralBackground1Hover: ["#F4F5F8", "#273342"],
	colorNeutralBackground1Pressed: ["#D9DFE8", "#141A21"],
	colorNeutralBackground1Selected: ["#E9EBEF", "#2C3848"],
	colorNeutralBackground2: ["#F9FAFD", "#171F27"],
	colorNeutralBackground2Hover: ["#F1F2F5", "#273342"],
	colorNeutralBackground2Pressed: ["#D3DCE5", "#131415"],
	colorNeutralBackground2Selected: ["#E4E6EB", "#242E3B"],
	colorNeutralBackground3: ["#F4F5F8", "#131415"],
	colorNeutralBackground3Hover: ["#E9EBEF", "#202935"],
	colorNeutralBackground3Pressed: ["#CED6E1", "#0A0A0A"],
	colorNeutralBackground3Selected: ["#D9DFE8", "#1B212D"],
	colorNeutralBackground4: ["#F1F2F5", "#0A0A0A"],
	colorNeutralBackground4Hover: ["#F9FAFD", "#171F27"],
	colorNeutralBackground4Pressed: ["#F4F5F8", "#000000"],
	colorNeutralBackground4Selected: ["#FFFFFF", "#141A21"],
	colorNeutralBackground5: ["#E9EBEF", "#000000"],
	colorNeutralBackground5Hover: ["#F4F5F8", "#131415"],
	colorNeutralBackground5Pressed: ["#F1F2F5", "#050505"],
	colorNeutralBackground5Selected: ["#F9FAFD", "#0F0F0F"],
	colorNeutralBackground6: ["#E4E6EB", "#273342"],
	colorNeutralBackground7Hover: ["#ebebeb", "#1a1a1a"],
	colorNeutralBackground7Pressed: ["#d6d6d6", "#0a0a0a"],
	colorNeutralBackground8: ["#fcfcfc", "#292929"],
	colorNeutralBackgroundAlpha: ["rgba(255,255,255,0.5)", "rgba(26,26,26,0.5)"],
	colorNeutralBackgroundAlpha2: ["rgba(255,255,255,0.8)", "rgba(31,31,31,0.7)"],
	colorNeutralBackgroundAlpha3: ["rgba(250,250,250,0.9)", "rgba(0,0,0,0.9)"],
	colorNeutralBackgroundDisabled: ["#F1F2F5", "#131415"],
	colorNeutralBackgroundDisabled2: ["#ffffff", "#292929"],
	colorNeutralBackgroundInverted: ["#202935", "#FFFFFF"],
	colorNeutralBackgroundInvertedHover: ["#3d3d3d", "#f5f5f5"],
	colorNeutralBackgroundInvertedPressed: ["#1f1f1f", "#e0e0e0"],
	colorNeutralBackgroundInvertedSelected: ["#383838", "#ebebeb"],
	colorNeutralBackgroundStatic: ["#273342", "#303A4F"],
	colorNeutralCardBackground: ["#FFFFFF", "#19212E"],
	colorNeutralCardBackgroundAlternative: ["#F9FAFD", "#0C1219"],
	colorNeutralCardBackgroundAlternativeHover: ["#F4F5F8", "#1D2B3D"],
	colorNeutralCardBackgroundAlternativePressed: ["#EFF6FF", "#2C3848"],
	colorNeutralCardBackgroundAlternativeSelected: ["#F1F2F5", "#1A2635"],
	colorNeutralCardBackgroundDisabled: ["#f0f0f0", "#141414"],
	colorNeutralCardBackgroundHover: ["#F9FAFD", "#1D2B3D"],
	colorNeutralCardBackgroundPressed: ["#FCFCFC", "#0E1216"],
	colorNeutralCardBackgroundSelected: ["#F4F5F8", "#1D2F48"],
	colorNeutralForeground1: ["#1B212D", "#FFFFFF"],
	colorNeutralForeground1Hover: ["#1B212D", "#FFFFFF"],
	colorNeutralForeground1Pressed: ["#1B212D", "#FFFFFF"],
	colorNeutralForeground1Selected: ["#1B212D", "#FFFFFF"],
	colorNeutralForeground1Static: ["#1B212D", "#202020"],
	colorNeutralForeground2: ["#343F56", "#CED6E1"],
	colorNeutralForeground2BrandHover: ["#0060CA", "#0084F1"],
	colorNeutralForeground2BrandPressed: ["#0052B3", "#0072DD"],
	colorNeutralForeground2BrandSelected: ["#0060CA", "#0084F1"],
	colorNeutralForeground2Hover: ["#1B212D", "#FFFFFF"],
	colorNeutralForeground2Link: ["#343F56", "#CED6E1"],
	colorNeutralForeground2LinkHover: ["#1B212D", "#FFFFFF"],
	colorNeutralForeground2LinkPressed: ["#1B212D", "#FFFFFF"],
	colorNeutralForeground2LinkSelected: ["#1B212D", "#FFFFFF"],
	colorNeutralForeground2Pressed: ["#1B212D", "#FFFFFF"],
	colorNeutralForeground2Selected: ["#1B212D", "#FFFFFF"],
	colorNeutralForeground3: ["#4C617E", "#9FB1C0"],
	colorNeutralForeground3BrandHover: ["#0060CA", "#0084F1"],
	colorNeutralForeground3BrandPressed: ["#0052B3", "#0072DD"],
	colorNeutralForeground3BrandSelected: ["#0060CA", "#0084F1"],
	colorNeutralForeground3Hover: ["#343F56", "#CED6E1"],
	colorNeutralForeground3Pressed: ["#343F56", "#CED6E1"],
	colorNeutralForeground3Selected: ["#343F56", "#CED6E1"],
	colorNeutralForeground4: ["#586F93", "#8598B6"],
	colorNeutralForeground5: ["#616161", "#adadad"],
	colorNeutralForeground5Hover: ["#242424", "#ffffff"],
	colorNeutralForeground5Pressed: ["#242424", "#ffffff"],
	colorNeutralForeground5Selected: ["#242424", "#ffffff"],
	colorNeutralForegroundDisabled: ["#B0BBCF", "#485A78"],
	colorNeutralForegroundInverted: ["#FFFFFF", "#1B212D"],
	colorNeutralForegroundInverted2: ["#FFFFFF", "#1B212D"],
	colorNeutralForegroundInvertedHover: ["#FFFFFF", "#1B212D"],
	colorNeutralForegroundInvertedPressed: ["#FFFFFF", "#1B212D"],
	colorNeutralForegroundInvertedSelected: ["#FFFFFF", "#1B212D"],
	colorNeutralGradientEnd: ["#F1F2F5", "#0E1216"],
	colorNeutralGradientStart: ["#FFFFFF", "#0B1B31"],
	colorNeutralShadowAmbient: ["rgba(0,0,0,0.12)", "rgba(0,0,0,0.24)"],
	colorNeutralShadowAmbientDarker: ["rgba(0,0,0,0.20)", "rgba(0,0,0,0.40)"],
	colorNeutralShadowAmbientLighter: ["rgba(0,0,0,0.06)", "rgba(0,0,0,0.12)"],
	colorNeutralShadowKey: ["rgba(0,0,0,0.14)", "rgba(0,0,0,0.28)"],
	colorNeutralShadowKeyDarker: ["rgba(0,0,0,0.24)", "rgba(0,0,0,0.48)"],
	colorNeutralShadowKeyLighter: ["rgba(0,0,0,0.07)", "rgba(0,0,0,0.14)"],
	colorNeutralStencil1: ["#E4E6EB", "#445771"],
	colorNeutralStencil1Alpha: ["rgba(0, 0, 0, 0.1)", "rgba(255, 255, 255, 0.1)"],
	colorNeutralStencil2: ["#F9FAFD", "#273342"],
	colorNeutralStencil2Alpha: ["rgba(0, 0, 0, 0.05)", "rgba(255, 255, 255, 0.05)"],
	colorNeutralStroke1: ["#C7D1DE", "#506586"],
	colorNeutralStroke1Hover: ["#BCC7D7", "#5D749A"],
	colorNeutralStroke1Pressed: ["#A4B3C8", "#546A8D"],
	colorNeutralStroke1Selected: ["#B0BBCF", "#586F93"],
	colorNeutralStroke2: ["#D9DFE8", "#404F6C"],
	colorNeutralStroke3: ["#F1F2F5", "#303A4F"],
	colorNeutralStroke4: ["#ebebeb", "#3d3d3d"],
	colorNeutralStroke4Hover: ["#e0e0e0", "#2e2e2e"],
	colorNeutralStroke4Pressed: ["#d6d6d6", "#242424"],
	colorNeutralStroke4Selected: ["#ebebeb", "#3d3d3d"],
	colorNeutralStrokeAccessible: ["#4C617E", "#9CABC4"],
	colorNeutralStrokeAccessibleHover: ["#445771", "#B0BBCF"],
	colorNeutralStrokeAccessiblePressed: ["#3C4A65", "#A4B3C8"],
	colorNeutralStrokeAccessibleSelected: ["#0060CA", "#0084F1"],
	colorNeutralStrokeAlpha: ["rgba(0,0,0,0.1)", "rgba(255,255,255,0.1)"],
	colorNeutralStrokeAlpha2: ["rgba(255,255,255,0.2)", "#202020"],
	colorNeutralStrokeDisabled: ["#D9DFE8", "#343F56"],
	colorNeutralStrokeDisabled2: ["#ebebeb", "#3d3d3d"],
	colorNeutralStrokeSubtle: ["#D2E4F3", "#0A0A0A"],
	colorPaletteAnchorBackground2: ["#bcc3c7", "#202427"],
	colorPaletteAnchorBorderActive: ["#394146", "#808a90"],
	colorPaletteAnchorForeground2: ["#202427", "#bcc3c7"],
	colorPaletteBeigeBackground2: ["#d7d4d4", "#444241"],
	colorPaletteBeigeBorderActive: ["#7a7574", "#afabaa"],
	colorPaletteBeigeForeground2: ["#444241", "#d7d4d4"],
	colorPaletteBerryBackground1: ["#fdf5fc", "#3a1136"],
	colorPaletteBerryBackground2: ["#edbbe7", "#6d2064"],
	colorPaletteBerryBorder1: ["#edbbe7", "#c239b3"],
	colorPaletteBerryBorder2: ["#c239b3", "#d161c4"],
	colorPaletteBerryBorderActive: ["#c239b3", "#da7ed0"],
	colorPaletteBerryForeground1: ["#af33a1", "#da7ed0"],
	colorPaletteBerryForeground2: ["#6d2064", "#edbbe7"],
	colorPaletteBerryForeground3: ["#c239b3", "#d161c4"],
	colorPaletteBlueBackground2: ["#a9d3f2", "#004377"],
	colorPaletteBlueBorderActive: ["#0078d4", "#5caae5"],
	colorPaletteBlueForeground2: ["#004377", "#a9d3f2"],
	colorPaletteBrassBackground2: ["#e0cea2", "#553e06"],
	colorPaletteBrassBorderActive: ["#986f0b", "#c1a256"],
	colorPaletteBrassForeground2: ["#553e06", "#e0cea2"],
	colorPaletteBrownBackground2: ["#ddc3b0", "#50301a"],
	colorPaletteBrownBorderActive: ["#8e562e", "#bb8f6f"],
	colorPaletteBrownForeground2: ["#50301a", "#ddc3b0"],
	colorPaletteCornflowerBackground2: ["#c8d1fa", "#2c3c85"],
	colorPaletteCornflowerBorderActive: ["#4f6bed", "#93a4f4"],
	colorPaletteCornflowerForeground2: ["#2c3c85", "#c8d1fa"],
	colorPaletteCranberryBackground2: ["#eeacb2", "#6e0811"],
	colorPaletteCranberryBorderActive: ["#c50f1f", "#dc626d"],
	colorPaletteCranberryForeground2: ["#6e0811", "#eeacb2"],
	colorPaletteDarkGreenBackground2: ["#9ad29a", "#063b06"],
	colorPaletteDarkGreenBorderActive: ["#0b6a0b", "#4da64d"],
	colorPaletteDarkGreenForeground2: ["#063b06", "#9ad29a"],
	colorPaletteDarkOrangeBackground1: ["#fdf6f3", "#411200"],
	colorPaletteDarkOrangeBackground2: ["#f4bfab", "#7a2101"],
	colorPaletteDarkOrangeBorder1: ["#f4bfab", "#da3b01"],
	colorPaletteDarkOrangeBorder2: ["#da3b01", "#e9835e"],
	colorPaletteDarkOrangeBorderActive: ["#da3b01", "#e9835e"],
	colorPaletteDarkOrangeForeground1: ["#c43501", "#e9835e"],
	colorPaletteDarkOrangeForeground2: ["#7a2101", "#f4bfab"],
	colorPaletteDarkOrangeForeground3: ["#da3b01", "#e9835e"],
	colorPaletteDarkRedBackground2: ["#d69ca5", "#590815"],
	colorPaletteDarkRedBorderActive: ["#750b1c", "#ac4f5e"],
	colorPaletteDarkRedForeground2: ["#420610", "#d69ca5"],
	colorPaletteForestBackground2: ["#bdd99b", "#294903"],
	colorPaletteForestBorderActive: ["#498205", "#85b44c"],
	colorPaletteForestForeground2: ["#294903", "#bdd99b"],
	colorPaletteGoldBackground2: ["#ecdfa5", "#6c5700"],
	colorPaletteGoldBorderActive: ["#c19c00", "#dac157"],
	colorPaletteGoldForeground2: ["#6c5700", "#ecdfa5"],
	colorPaletteGrapeBackground2: ["#d9a7e0", "#4c0d55"],
	colorPaletteGrapeBorderActive: ["#881798", "#b55fc1"],
	colorPaletteGrapeForeground2: ["#4c0d55", "#d9a7e0"],
	colorPaletteGreenBackground1: ["#f1faf1", "#052505"],
	colorPaletteGreenBackground2: ["#9fd89f", "#094509"],
	colorPaletteGreenBorder1: ["#9fd89f", "#107c10"],
	colorPaletteGreenBorder2: ["#107c10", "#9fd89f"],
	colorPaletteGreenBorderActive: ["#107c10", "#54b054"],
	colorPaletteGreenForeground1: ["#0e700e", "#54b054"],
	colorPaletteGreenForeground2: ["#094509", "#9fd89f"],
	colorPaletteGreenForeground3: ["#107c10", "#9fd89f"],
	colorPaletteGreenForegroundInverted: ["#359b35", "#107c10"],
	colorPaletteLavenderBackground2: ["#d2ccf8", "#3f3682"],
	colorPaletteLavenderBorderActive: ["#7160e8", "#a79cf1"],
	colorPaletteLavenderForeground2: ["#3f3682", "#d2ccf8"],
	colorPaletteLightGreenBackground1: ["#f2fbf2", "#063004"],
	colorPaletteLightGreenBackground2: ["#a7e3a5", "#0b5a08"],
	colorPaletteLightGreenBorder1: ["#a7e3a5", "#13a10e"],
	colorPaletteLightGreenBorder2: ["#13a10e", "#3db838"],
	colorPaletteLightGreenBorderActive: ["#13a10e", "#5ec75a"],
	colorPaletteLightGreenForeground1: ["#11910d", "#5ec75a"],
	colorPaletteLightGreenForeground2: ["#0b5a08", "#a7e3a5"],
	colorPaletteLightGreenForeground3: ["#13a10e", "#3db838"],
	colorPaletteLightTealBackground2: ["#a6e9ed", "#00666d"],
	colorPaletteLightTealBorderActive: ["#00b7c3", "#58d3db"],
	colorPaletteLightTealForeground2: ["#00666d", "#a6e9ed"],
	colorPaletteLilacBackground2: ["#e6bfed", "#63276d"],
	colorPaletteLilacBorderActive: ["#b146c2", "#cf87da"],
	colorPaletteLilacForeground2: ["#63276d", "#e6bfed"],
	colorPaletteMagentaBackground2: ["#eca5d1", "#6b0043"],
	colorPaletteMagentaBorderActive: ["#bf0077", "#d957a8"],
	colorPaletteMagentaForeground2: ["#6b0043", "#eca5d1"],
	colorPaletteMarigoldBackground1: ["#fefbf4", "#463100"],
	colorPaletteMarigoldBackground2: ["#f9e2ae", "#835b00"],
	colorPaletteMarigoldBorder1: ["#f9e2ae", "#eaa300"],
	colorPaletteMarigoldBorder2: ["#eaa300", "#efb839"],
	colorPaletteMarigoldBorderActive: ["#eaa300", "#f2c661"],
	colorPaletteMarigoldForeground1: ["#d39300", "#f2c661"],
	colorPaletteMarigoldForeground2: ["#835b00", "#f9e2ae"],
	colorPaletteMarigoldForeground3: ["#eaa300", "#efb839"],
	colorPaletteMinkBackground2: ["#cecccb", "#343231"],
	colorPaletteMinkBorderActive: ["#5d5a58", "#9e9b99"],
	colorPaletteMinkForeground2: ["#343231", "#cecccb"],
	colorPaletteNavyBackground2: ["#a3b2e8", "#001665"],
	colorPaletteNavyBorderActive: ["#0027b4", "#546fd2"],
	colorPaletteNavyForeground2: ["#001665", "#a3b2e8"],
	colorPalettePeachBackground2: ["#ffddb3", "#8f4e00"],
	colorPalettePeachBorderActive: ["#ff8c00", "#ffba66"],
	colorPalettePeachForeground2: ["#8f4e00", "#ffddb3"],
	colorPalettePinkBackground2: ["#f7c0e3", "#80215d"],
	colorPalettePinkBorderActive: ["#e43ba6", "#ef85c8"],
	colorPalettePinkForeground2: ["#80215d", "#f7c0e3"],
	colorPalettePlatinumBackground2: ["#cdd6d8", "#3b4447"],
	colorPalettePlatinumBorderActive: ["#69797e", "#a0adb2"],
	colorPalettePlatinumForeground2: ["#3b4447", "#cdd6d8"],
	colorPalettePlumBackground2: ["#d696c0", "#5a003b"],
	colorPalettePlumBorderActive: ["#77004d", "#ad4589"],
	colorPalettePlumForeground2: ["#43002b", "#d696c0"],
	colorPalettePumpkinBackground2: ["#efc4ad", "#712d09"],
	colorPalettePumpkinBorderActive: ["#ca5010", "#df8e64"],
	colorPalettePumpkinForeground2: ["#712d09", "#efc4ad"],
	colorPalettePurpleBackground2: ["#c6b1de", "#341a51"],
	colorPalettePurpleBorderActive: ["#5c2e91", "#9470bd"],
	colorPalettePurpleForeground2: ["#341a51", "#c6b1de"],
	colorPaletteRedBackground1: ["#fdf6f6", "#3f1011"],
	colorPaletteRedBackground2: ["#f1bbbc", "#751d1f"],
	colorPaletteRedBorder1: ["#f1bbbc", "#d13438"],
	colorPaletteRedBorder2: ["#d13438", "#e37d80"],
	colorPaletteRedBorderActive: ["#d13438", "#e37d80"],
	colorPaletteRedForeground1: ["#bc2f32", "#e37d80"],
	colorPaletteRedForeground2: ["#751d1f", "#f1bbbc"],
	colorPaletteRedForeground3: ["#d13438", "#e37d80"],
	colorPaletteRedForegroundInverted: ["#dc5e62", "#d13438"],
	colorPaletteRoyalBlueBackground2: ["#9abfdc", "#002c4e"],
	colorPaletteRoyalBlueBorderActive: ["#004e8c", "#4a89ba"],
	colorPaletteRoyalBlueForeground2: ["#002c4e", "#9abfdc"],
	colorPaletteSeafoamBackground2: ["#a8f0cd", "#00723b"],
	colorPaletteSeafoamBorderActive: ["#00cc6a", "#5ae0a0"],
	colorPaletteSeafoamForeground2: ["#00723b", "#a8f0cd"],
	colorPaletteSteelBackground2: ["#94c8d4", "#00333f"],
	colorPaletteSteelBorderActive: ["#005b70", "#4496a9"],
	colorPaletteSteelForeground2: ["#00333f", "#94c8d4"],
	colorPaletteTealBackground2: ["#9bd9db", "#02494c"],
	colorPaletteTealBorderActive: ["#038387", "#4cb4b7"],
	colorPaletteTealForeground2: ["#02494c", "#9bd9db"],
	colorPaletteYellowBackground1: ["#fffef5", "#4c4400"],
	colorPaletteYellowBackground2: ["#fef7b2", "#817400"],
	colorPaletteYellowBorder1: ["#fef7b2", "#fde300"],
	colorPaletteYellowBorder2: ["#fde300", "#fdea3d"],
	colorPaletteYellowBorderActive: ["#fde300", "#feee66"],
	colorPaletteYellowForeground1: ["#817400", "#feee66"],
	colorPaletteYellowForeground2: ["#817400", "#fef7b2"],
	colorPaletteYellowForeground3: ["#fde300", "#fdea3d"],
	colorPaletteYellowForegroundInverted: ["#fef7b2", "#817400"],
	colorSeverityCriticalBackground1: ["#960B18", "#D33F4C"],
	colorSeverityCriticalStroke1: ["#6E0811", "#D33F4C"],
	colorSeverityHighBackground1: ["#C50F1F", "#DC626D"],
	colorSeverityHighStroke1: ["#960B18", "#DC626D"],
	colorSeverityLowBackground1: ["#EAA300", "#EFB839"],
	colorSeverityLowStroke1: ["#B27C00", "#EFB839"],
	colorSeverityMediumBackground1: ["#DE590B", "#F98845"],
	colorSeverityMediumStroke1: ["#BC4B09", "#F98845"],
	colorStatusDangerBackground1: ["#FDF3F4", "#3B0509"],
	colorStatusDangerBackground2: ["#eeacb2", "#6e0811"],
	colorStatusDangerBackground3: ["#C50F1F", "#DC626D"],
	colorStatusDangerBorder1: ["#EEACB2", "#C50F1F"],
	colorStatusDangerBorder2: ["#960B18", "#DC626D"],
	colorStatusDangerBorderActive: ["#c50f1f", "#dc626d"],
	colorStatusDangerForeground1: ["#C50F1F", "#EEACB2"],
	colorStatusDangerForeground2: ["#6e0811", "#eeacb2"],
	colorStatusDangerForeground3: ["#C50F1F", "#DC626D"],
	colorStatusDangerForegroundInverted: ["#dc626d", "#b10e1c"],
	colorStatusSevereBackground1: ["#FDF6F3", "#411200"],
	colorStatusSevereBorder1: ["#F4BFAB", "#DA3B01"],
	colorStatusSevereBorder2: ["#6E0811", "#D33F4C"],
	colorStatusSevereForeground1: ["#C43501", "#E9835E"],
	colorStatusSevereForeground2: ["#960B18", "#D33F4C"],
	colorStatusSevereForeground3: ["#DA3B01", "#E9835E"],
	colorStatusSuccessBackground1: ["#F1FAF1", "#052505"],
	colorStatusSuccessBackground2: ["#9fd89f", "#094509"],
	colorStatusSuccessBorder1: ["#9FD89F", "#107C10"],
	colorStatusSuccessBorder2: ["#107C10", "#9FD89F"],
	colorStatusSuccessBorderActive: ["#107c10", "#54b054"],
	colorStatusSuccessForeground1: ["#0E700E", "#54B054"],
	colorStatusSuccessForeground2: ["#094509", "#9fd89f"],
	colorStatusSuccessForeground3: ["#107C10", "#9FD89F"],
	colorStatusSuccessForegroundInverted: ["#359B35", "#107C10"],
	colorStatusWarningBackground1: ["#FFF9F5", "#4A1E04"],
	colorStatusWarningBackground2: ["#fdcfb4", "#8a3707"],
	colorStatusWarningBackground3: ["#EAA300", "#EFB839"],
	colorStatusWarningBorder1: ["#FDCFB4", "#DE590B"],
	colorStatusWarningBorder2: ["#BC4B09", "#F98845"],
	colorStatusWarningBorder3: ["#B27C00", "#EFB839"],
	colorStatusWarningBorderActive: ["#f7630c", "#faa06b"],
	colorStatusWarningForeground1: ["#DE590B", "#F98845"],
	colorStatusWarningForeground2: ["#DE590B", "#F98845"],
	colorStatusWarningForeground3: ["#EAA300", "#EFB839"],
	colorStatusWarningForegroundInverted: ["#faa06b", "#bc4b09"],
	colorStrokeFocus1: ["#FFFFFF", "#000000"],
	colorStrokeFocus2: ["#000000", "#FFFFFF"],
	colorSubtleBackgroundHover: ["#F4F5F8", "#2C3848"],
	colorSubtleBackgroundLightAlphaHover: ["rgba(255,255,255,0.7)", "rgba(36,36,36,0.8)"],
	colorSubtleBackgroundLightAlphaPressed: ["rgba(255,255,255,0.5)", "rgba(36,36,36,0.5)"],
	colorSubtleBackgroundPressed: ["#D9DFE8", "#242E3B"],
	colorSubtleBackgroundSelected: ["#E9EBEF", "#273342"],
	shadow16: ["0 0 2px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.14)", "0 0 2px rgba(0,0,0,0.24), 0 8px 16px rgba(0,0,0,0.28)"],
	shadow2: ["0 0 2px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.14)", "0 0 2px rgba(0,0,0,0.24), 0 1px 2px rgba(0,0,0,0.28)"],
	shadow28: ["0 0 8px rgba(0,0,0,0.12), 0 14px 28px rgba(0,0,0,0.14)", "0 0 8px rgba(0,0,0,0.24), 0 14px 28px rgba(0,0,0,0.28)"],
	shadow4: ["0 0 2px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.14)", "0 0 2px rgba(0,0,0,0.24), 0 2px 4px rgba(0,0,0,0.28)"],
	shadow64: ["0 0 8px rgba(0,0,0,0.12), 0 32px 64px rgba(0,0,0,0.14)", "0 0 8px rgba(0,0,0,0.24), 0 32px 64px rgba(0,0,0,0.28)"],
	shadow8: ["0 0 2px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.14)", "0 0 2px rgba(0,0,0,0.24), 0 4px 8px rgba(0,0,0,0.28)"],
};

/**
 * Values that are identical in both themes.
 * @type {Record<string, string>}
 */
const STATIC = {
	borderRadius2XL: "12px",
	borderRadius2XLarge: "12px",
	borderRadius3XL: "16px",
	borderRadius3XLarge: "16px",
	borderRadius4XL: "24px",
	borderRadius4XLNudge: "28px",
	borderRadius4XLarge: "24px",
	borderRadius5XL: "40px",
	borderRadius5XLarge: "32px",
	borderRadius6XLarge: "40px",
	borderRadiusCircular: "10000px",
	borderRadiusLarge: "24px",
	borderRadiusMedium: "16px",
	borderRadiusNone: "0",
	borderRadiusSmall: "6px",
	borderRadiusXLarge: "24px",
	breakpointL: "640",
	breakpointM: "480",
	breakpointS: "320",
	breakpointXL: "1024",
	breakpointXXL: "1366",
	breakpointXXXL: "1920",
	colorBackgroundOverlay: "rgba(0,0,0,0.4)",
	colorBrandBackground3Static: "#00449B",
	colorBrandBackground4Static: "#002A6D",
	colorBrandBackgroundInverted: "#FFF",
	colorBrandBackgroundInvertedHover: "#D9F1FF",
	colorBrandBackgroundInvertedPressed: "#98CEFF",
	colorBrandBackgroundInvertedSelected: "#B9E0FF",
	colorBrandBackgroundStatic: "#0060CA",
	colorBrandForegroundInvertedHover: "#2496FF",
	colorBrandForegroundInvertedPressed: "#0084F1",
	colorBrandForegroundOnLight: "#0060CA",
	colorBrandForegroundOnLightHover: "#0052B3",
	colorBrandForegroundOnLightPressed: "#003784",
	colorBrandForegroundOnLightSelected: "#00449B",
	colorBrandShadowAmbient: "rgba(0,0,0,0.30)",
	colorBrandShadowKey: "rgba(0,0,0,0.25)",
	colorBrandStroke2: "#98CEFF",
	colorDataVizSlot1: "#637cef",
	colorDataVizSlot10: "#ae8c00",
	colorDataVizSlot2: "#e3008c",
	colorDataVizSlot21: "#4f6bed",
	colorDataVizSlot22: "#ea38a6",
	colorDataVizSlot23: "#038387",
	colorDataVizSlot24: "#8764b8",
	colorDataVizSlot25: "#11910d",
	colorDataVizSlot26: "#3487c7",
	colorDataVizSlot27: "#d06228",
	colorDataVizSlot28: "#689920",
	colorDataVizSlot29: "#ba58c9",
	colorDataVizSlot3: "#2aa0a4",
	colorDataVizSlot4: "#9373c0",
	colorDataVizSlot5: "#13a10e",
	colorDataVizSlot6: "#3a96dd",
	colorDataVizSlot7: "#ca5010",
	colorDataVizSlot8: "#57811b",
	colorDataVizSlot9: "#b146c2",
	colorNeutralBackground7: "#00000000",
	colorNeutralBackground7Selected: "#00000000",
	colorNeutralBackgroundInvertedDisabled: "rgba(255,255,255,0.1)",
	colorNeutralForegroundInvertedDisabled: "rgba(255,255,255,0.4)",
	colorNeutralForegroundInvertedLink: "#FFFFFF",
	colorNeutralForegroundInvertedLinkHover: "#FFFFFF",
	colorNeutralForegroundInvertedLinkPressed: "#FFFFFF",
	colorNeutralForegroundInvertedLinkSelected: "#FFFFFF",
	colorNeutralForegroundOnBrand: "#FFFFFF",
	colorNeutralForegroundStaticInverted: "#FFFFFF",
	colorNeutralStrokeInvertedDisabled: "rgba(255,255,255,0.4)",
	colorNeutralStrokeOnBrand: "#FFFFFF",
	colorNeutralStrokeOnBrand2: "#FFFFFF",
	colorNeutralStrokeOnBrand2Hover: "#FFFFFF",
	colorNeutralStrokeOnBrand2Pressed: "#FFFFFF",
	colorNeutralStrokeOnBrand2Selected: "#FFFFFF",
	colorPaletteBerryBackground3: "#c239b3",
	colorPaletteDarkOrangeBackground3: "#da3b01",
	colorPaletteGreenBackground3: "#107c10",
	colorPaletteLightGreenBackground3: "#13a10e",
	colorPaletteMarigoldBackground3: "#eaa300",
	colorPaletteRedBackground3: "#d13438",
	colorPaletteYellowBackground3: "#fde300",
	colorScrollbarOverlay: "rgba(0,0,0,0.5)",
	colorStatusDangerBackground3Hover: "#b10e1c",
	colorStatusDangerBackground3Pressed: "#960b18",
	colorStatusSuccessBackground3: "#107C10",
	colorSubtleBackground: "transparent",
	colorSubtleBackgroundInverted: "transparent",
	colorSubtleBackgroundInvertedHover: "rgba(0,0,0,0.1)",
	colorSubtleBackgroundInvertedPressed: "rgba(0,0,0,0.3)",
	colorSubtleBackgroundInvertedSelected: "rgba(0,0,0,0.2)",
	colorSubtleBackgroundLightAlphaSelected: "transparent",
	colorTransparentBackground: "transparent",
	colorTransparentBackgroundHover: "transparent",
	colorTransparentBackgroundPressed: "transparent",
	colorTransparentBackgroundSelected: "transparent",
	colorTransparentStroke: "transparent",
	colorTransparentStrokeDisabled: "transparent",
	colorTransparentStrokeInteractive: "transparent",
	curveAccelerateMax: "cubic-bezier(0.9,0.1,1,0.2)",
	curveAccelerateMid: "cubic-bezier(1,0,1,1)",
	curveAccelerateMin: "cubic-bezier(0.8,0,0.78,1)",
	curveDecelerateMax: "cubic-bezier(0.1,0.9,0.2,1)",
	curveDecelerateMid: "cubic-bezier(0,0,0,1)",
	curveDecelerateMin: "cubic-bezier(0.33,0,0.1,1)",
	curveEasyEase: "cubic-bezier(0.33,0,0.67,1)",
	curveEasyEaseMax: "cubic-bezier(0.8,0,0.2,1)",
	curveLinear: "cubic-bezier(0,0,1,1)",
	durationFast: "150ms",
	durationFaster: "100ms",
	durationGentle: "250ms",
	durationNormal: "200ms",
	durationSlow: "300ms",
	durationSlower: "400ms",
	durationUltraFast: "50ms",
	durationUltraSlow: "500ms",
	fontFamilyBase: "'Segoe Sans', 'Segoe UI', 'Segoe UI Web (West European)', 'Helvetica Neue', 'Arial', sans-serif",
	fontFamilyMonospace: "Consolas, 'Courier New', Courier, monospace",
	fontFamilyNumeric: "Bahnschrift, 'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif",
	fontSizeBase100: "10px",
	fontSizeBase200: "12px",
	fontSizeBase300: "14px",
	fontSizeBase400: "16px",
	fontSizeBase500: "20px",
	fontSizeBase600: "24px",
	fontSizeHero1000: "68px",
	fontSizeHero700: "28px",
	fontSizeHero800: "32px",
	fontSizeHero900: "40px",
	fontWeightBold: "700",
	fontWeightMedium: "500",
	fontWeightRegular: "400",
	fontWeightSemibold: "600",
	lineHeightBase100: "14px",
	lineHeightBase200: "16px",
	lineHeightBase300: "20px",
	lineHeightBase400: "22px",
	lineHeightBase500: "28px",
	lineHeightBase600: "32px",
	lineHeightHero1000: "92px",
	lineHeightHero700: "36px",
	lineHeightHero800: "40px",
	lineHeightHero900: "52px",
	shadow16Brand: "0 0 2px rgba(0,0,0,0.30), 0 8px 16px rgba(0,0,0,0.25)",
	shadow28Brand: "0 0 8px rgba(0,0,0,0.30), 0 14px 28px rgba(0,0,0,0.25)",
	shadow2Brand: "0 0 2px rgba(0,0,0,0.30), 0 1px 2px rgba(0,0,0,0.25)",
	shadow4Brand: "0 0 2px rgba(0,0,0,0.30), 0 2px 4px rgba(0,0,0,0.25)",
	shadow64Brand: "0 0 8px rgba(0,0,0,0.30), 0 32px 64px rgba(0,0,0,0.25)",
	shadow8Brand: "0 0 2px rgba(0,0,0,0.30), 0 4px 8px rgba(0,0,0,0.25)",
	spacingHorizontal4XL: "40px",
	spacingHorizontal5XL: "48px",
	spacingHorizontal6XL: "64px",
	spacingHorizontal7XL: "80px",
	spacingHorizontalL: "16px",
	spacingHorizontalM: "12px",
	spacingHorizontalMNudge: "10px",
	spacingHorizontalNone: "0",
	spacingHorizontalS: "8px",
	spacingHorizontalSNudge: "6px",
	spacingHorizontalXL: "20px",
	spacingHorizontalXS: "4px",
	spacingHorizontalXXL: "24px",
	spacingHorizontalXXS: "2px",
	spacingHorizontalXXXL: "32px",
	spacingVertical4XL: "40px",
	spacingVertical5XL: "48px",
	spacingVertical6XL: "64px",
	spacingVertical7XL: "80px",
	spacingVerticalL: "16px",
	spacingVerticalM: "12px",
	spacingVerticalMNudge: "10px",
	spacingVerticalNone: "0",
	spacingVerticalS: "8px",
	spacingVerticalSNudge: "6px",
	spacingVerticalXL: "20px",
	spacingVerticalXS: "4px",
	spacingVerticalXXL: "24px",
	spacingVerticalXXS: "2px",
	spacingVerticalXXXL: "32px",
	strokeWidthThick: "2px",
	strokeWidthThicker: "3px",
	strokeWidthThickest: "4px",
	strokeWidthThin: "1px",
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
 * Every custom property for one scheme, without a selector around them.
 *
 * Exists so a surface that cannot use `data-theme` can still be driven by the
 * same generated values instead of hand-picking a few — `platform/auth.mjs`
 * renders on a throwaway loopback origin with no `localStorage` and no toggle,
 * so it wraps these in `prefers-color-scheme` instead. Hand-picking is what
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
	return `:root {\n${themeDeclarations("light")}\n}\n\n[data-theme="dark"] {\n${themeDeclarations("dark")}\n}`;
}

/** The custom property name, without the leading dashes. */
const PAGE_BACKGROUND_NAME = "canvas-page-background";

/**
 * The custom property the page background is published on.
 *
 * A CSS variable rather than a token because a gradient is not a colour, and
 * SFE's theme is a map of colours. Unified UX publishes it the same way, under
 * its own name (`--unifiedux-page-background`).
 */
export const PAGE_BACKGROUND_PROPERTY = `--${PAGE_BACKGROUND_NAME}`;

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
 * `radial-gradient(..., undefined, undefined)` the browser drops entirely,
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

	return `radial-gradient(ellipse 80% 60% at ${origin}, ${start} 0%, ${end} 100%)`;
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
