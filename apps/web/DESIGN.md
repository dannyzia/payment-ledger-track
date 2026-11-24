---
name: Kumon Ledger Track
description: Jet-Age Coupon Wallet — a payment ledger that files every payment as a stamped carbon stub in the month's wallet.
colors:
  stock-ground: "#F2F3F0"
  coupon-white: "#FFFFFF"
  carbon-ink: "#1D2333"
  quiet-slate: "#5A6373"
  jet-red: "#D7262D"
  jet-red-pressed: "#B81E24"
  carrier-navy: "#0D1B3D"
  carbon-purple: "#4B2E83"
  navy-paper: "#E9EDF6"
  navy-muted: "#A9B5CD"
  navy-night: "#0A1124"
  coupon-navy: "#141D36"
  band-night: "#1A2749"
  carbon-night: "#B9A7EC"
  commission-green: "#17694F"
  vat-amber: "#8C4F00"
  vat-wash: "#FFE8C2"
  bkash-magenta: "#B80053"
  bkash-wash: "#FFD8EA"
  visa-blue: "#1A54B8"
  visa-wash: "#DCE8FF"
  mastercard-rust: "#9E3600"
  mastercard-wash: "#FFDBC8"
  stamp-pad: "#EFC4C6"
  stamp-pad-ink: "#8F3A3E"
  stamp-pad-night: "#43282D"
  stamp-pad-ink-night: "#D8989C"
typography:
  display:
    fontFamily: "Archivo, Noto Sans Bengali, sans-serif"
    fontWeight: 800
    fontSize: "1.375rem"
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Archivo, Noto Sans Bengali, sans-serif"
    fontWeight: 700
    fontSize: "1.25rem"
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo, Noto Sans Bengali, sans-serif"
    fontWeight: 500
    fontSize: "0.875rem"
    lineHeight: 1.5
  label:
    fontFamily: "Archivo Narrow, Archivo, Noto Sans Bengali, sans-serif"
    fontWeight: 700
    fontSize: "0.75rem"
    letterSpacing: "0.08em"
  tab:
    fontFamily: "Archivo Narrow, Archivo, Noto Sans Bengali, sans-serif"
    fontWeight: 700
    fontSize: "0.6875rem"
    letterSpacing: "0.14em"
  money:
    fontFamily: "Spline Sans Mono, Noto Sans Bengali, ui-monospace, monospace"
    fontWeight: 500
    fontSize: "1rem"
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
rounded:
  stub: "10px"
  panel: "12px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  card: "20px"
  page: "24px"
components:
  button-stamp:
    backgroundColor: "{colors.jet-red}"
    textColor: "#FFFFFF"
    typography: "{typography.tab}"
    rounded: "{rounded.stub}"
    padding: "10px 18px"
    height: "44px"
  button-stamp-disabled:
    backgroundColor: "{colors.stamp-pad}"
    textColor: "{colors.stamp-pad-ink}"
    typography: "{typography.tab}"
  button-stamp-hover:
    backgroundColor: "{colors.jet-red-pressed}"
  button-stub:
    backgroundColor: "{colors.coupon-white}"
    textColor: "{colors.carrier-navy}"
    rounded: "{rounded.stub}"
    padding: "10px 18px"
    height: "44px"
  card-stub:
    backgroundColor: "{colors.coupon-white}"
    rounded: "{rounded.stub}"
    padding: "20px"
  coupon-tab:
    backgroundColor: "{colors.carrier-navy}"
    textColor: "{colors.navy-paper}"
    typography: "{typography.tab}"
  date-flag:
    backgroundColor: "{colors.jet-red}"
    textColor: "#FFFFFF"
    typography: "{typography.label}"
  chip-method-selected:
    backgroundColor: "{colors.carrier-navy}"
    textColor: "#FFFFFF"
    rounded: "{rounded.pill}"
  chip-method-unselected:
    backgroundColor: "#FFFFFF"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.pill}"
---

<!-- DESIGN.md — recorded from the shipped build, 2026-11-24.
     Provenance: Jet-Age Coupon Wallet, dealt challenger chosen by Zia over the
     assigned Counterfoil Book (2026-11-23). World seed e335f1c6921f8de6;
     direction round key 24d8a30e. Replaces the pearl/jade "Calm Financial
     Clarity" world (frosted glass + Geist), whose tokens no longer exist in
     code — see "What this world replaced" in Overview. Proving surface:
     src/routes/(app)/entries/new/+page.svelte; verified captures in
     .impeccable/review/{desktop,mobile,download}.png. -->

# Design System: Kumon Ledger Track

## Overview

**Creative North Star: "Jet-Age Coupon Wallet"**

The month is a coupon wallet. Every payment is filed as a carbon stub — a notched tab-cap head carrying a serial, a red date flag riding the edge, a hairline fare-box split of the money, and a dashed tear-off perforation above the one red action that stamps the stub into the wallet. Nothing behind a filed stub changes: a voided entry is stamped VOID, a closed month carries the seal, corrections are new stubs that supersede old ones. The world refuses the category default of floating white cards on a grey SaaS ground; colour owns whole regions instead of accenting chips.

Carrier navy `#0D1B3D` is the shell: the desktop rail, the mobile pill, and every page's coupon-head band are navy regions set with the `.on-navy` scope, which re-points the ink tokens so ordinary markup reads correctly on the band. Jet red `#D7262D` is scarce by design — the primary action, the date flag, and alert accents and nothing else. Carbon purple `#4B2E83` is the ink of money: every entered figure and every amount sets in tabular mono at carbon. Coupon white stubs are paper — solid, crisp, never blurred; the old frosted chrome is retired, and `.glass` is now a paper material with a quiet navy-tinted lift.

WCAG AA (≥ 4.5:1 body, ≥ 3:1 large) in light and dark themes is a hard constraint, as are 44px minimum touch targets and the `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast: more` media contracts. The dark theme is the same wallet at night: navy night ground, lifted band, carbon figures set in lavender.

**What this world replaced.** The pearl/jade "Calm Financial Clarity" token layer (frosted-glass surfaces, Geist/Geist Mono, engraved gradients) was removed on 2026-11-23. Class names and token names were kept stable while the values they resolve to changed wholesale: `.glass` is paper, `--pearl-*` names carry re-skinned world values, `--accent-2` is carrier navy. Geist font files remain on disk in `static/fonts/` but nothing references them; new work must not re-import them.

**Rollout state.** The world is rolled out and finish-reviewed on every surface: the proving surface `/entries/new`, the three dashboards, ledger, reports, settlements (list and detail), reconcile (overview and upload), months close, the admin family, login and the public `/download` page. Later work inherits this brief rather than re-deciding it.

**Key Characteristics:**
- Colour owns regions (navy bands), not accent chips.
- Money always sets in tabular mono at carbon; labels set in narrow caps.
- Stubs are paper: solid fills, hairline borders, no backdrop blur anywhere.
- One red primary per screen — the stamp action.
- Dashed perforations separate the stub from its action zone.
- Reserved devices held as headroom: security-dot guilloche, void-red hatch, carbon-copy lavender treatment, chamfered ticket corners, `///` hatch marks. These are ceiling devices for later surfaces, not defects to add now.

## Colors

A cold, printed palette: deep carrier navy and jet red do the structural work, carbon purple speaks for money, and everything else is coupon white on cold grey-green stock.

### Primary
- **Jet Red** (`#D7262D`, 4.9:1 against white both directions): the one primary. The STAMP & FILE action, the date flag riding coupon heads, alert accents, and void/destroy treatments. Pressed state deepens to `#B81E24`. The disabled primary is an ink-starved stamp pad: `#EFC4C6` fill with `#8F3A3E` text (dark: `#43282D` / `#D8989C`) — readable, unmistakably not ready.

### Secondary
- **Carrier Navy** (`#0D1B3D`, 15:1 on white): the shell voice. Desktop rail, mobile pill, coupon-head bands, selected method chips, and caret/focus colour in light theme. Band text inks are **Navy Paper** `#E9EDF6` (13.6:1) and **Navy Muted** `#A9B5CD` (6.2:1). In dark theme the band lifts to `#1A2749` over a `#0A1124` night ground.

### Tertiary
- **Carbon Purple** (`#4B2E83`, 9.4:1 on white): the money voice. Every entered figure, the gross hero input, the net result, dark-theme button labels and focus rings. Dark theme sets money in **Carbon Night** lavender `#B9A7EC` (7.3:1).

### Neutral
- **Coupon White** (`#FFFFFF`): stub surfaces, cards, solid buttons; dark theme swaps to **Coupon Navy** `#141D36`.
- **Cold Stock** (`#F2F3F0`): the flat ground everything rides on; dark theme is **Navy Night** `#0A1124`.
- **Carbon Ink** (`#1D2333`, 14.5:1 on white): body text; flips to navy paper inside `.on-navy`.
- **Quiet Slate** (`#5A6373`, 5.3:1 on white): field labels, muted copy, hairline content (4.9:1 in dark as `#A3AEC6`).
- **Pearl hairline** (`rgba(29,35,51,0.16)`, dark `rgba(233,237,246,0.16)`): every stub border. Carried by the legacy `--pearl-border` name.

### Data-series (functional, kept stable)
Method and deduction colours with wash backgrounds, used for chips, badges and the semantic `.btn--*` fills: **Commission** `#17694F`, **VAT** `#8C4F00` on `#FFE8C2`, **bKash** `#B80053` on `#FFD8EA`, **Visa** `#1A54B8` on `#DCE8FF`, **Mastercard** `#9E3600` on `#FFDBC8`. Dark theme lifts each to a brighter ink on a near-black wash (e.g. bKash `#F75990` on `#420A21`); dark fills flip their text to night ink.

### Named Rules
**The Colour Owns Regions Rule.** Navy owns whole regions — bands, rails, pills — through the `.on-navy` scope, which re-points `--ink`, `--muted`, `--surface` and `--pearl-border` so children read navy-safe without markup changes. Colour is never applied as a chip-level accent to fake structure; red accents an action, navy declares a region.

**Approved status washes.** LedgerRow's internal amber/red/blue washes are approved status accents — they mark void, superseded and pending states inside a stub, not structure, so they do not break the Colour Owns Regions Rule.

**The Carbon Ink Rule.** Every entered figure, amount, serial and money value sets in Spline Sans Mono with `tabular-nums` (`.carbon-nums`), in carbon purple. Money never sets in the sans face and never in a colour other than carbon (dark: carbon night).

**The Paper Rule.** Stubs are paper. Solid fills, one hairline border, no backdrop-filter, no translucency in primary surfaces; `.glass-subtle` translucency exists only as a background wash and collapses to solid under `prefers-reduced-transparency` and browsers without backdrop-filter support.

## Typography

**Display Font:** Archivo (variable, 100–900) with Noto Sans Bengali fallback
**Body Font:** Archivo (same family; Bengali text renders through Noto Sans Bengali)
**Label/Mono Font:** Archivo Narrow (600/700) for tab-caps labels; Spline Sans Mono (500/700) for money and serials

**Character:** A workhorse grotesk carries reading text; a condensed narrow face at 700 with wide tracking speaks in ticket-stub caps; a rounded tabular mono is the only voice money is allowed. All faces are self-hosted woff2 with `font-display: swap`.

### Hierarchy
- **Display** (Archivo 800, ~1.375rem, tight −0.01em): page titles on navy heads ("Record Transaction").
- **Headline** (Archivo 700, 1.25rem, −0.01em): card titles and section heads.
- **Body** (Archivo 500, 0.875rem, 1.5): field values, prose, nav links.
- **Label** (`.tab-caps`, Archivo Narrow 700, 0.6875–0.75rem, +0.08em, uppercase): field labels, fare-box column heads, "LIVE CALCULATION BREAKDOWN".
- **Micro-label** (`.tab-caps` at 10px, Archivo Narrow 700, +0.08em, uppercase): a deliberate ramp step, not a fallback — it carries VOID/status chips, date-flag internals and serial previews, and holds AA at its sizes.
- **Tab** (`.coupon-tab` voice, Archivo Narrow 700, 0.6875rem, +0.14em, uppercase): the notched tab-caps themselves (ENTRY, STUB) and the stamp button.
- **Money** (`.carbon-nums`, Spline Sans Mono 500/700, tabular, −0.01em): all amounts, serials (`E-MHK-202611-······`), timestamps, and the gross hero figure (text-2xl, 700, carbon).

### Named Rules
**The Two Ink Voices Rule.** Uppercase text is always Archivo Narrow 700 with tracking (labels, tabs, stamps); mono is always tabular and always for numbers. Sans never fakes either voice — no letter-spaced sans caps, no proportional digits in money.

## Layout

A single column of stubs on the stock ground. Page gutters are 24px (`p-6`) with a `max-w-4xl` container; the coupon-head band runs full-bleed via a negative margin so the navy touches both screen edges. Spacing rhythm sits on a 4px grid with 16px field gaps and 20px card padding; every touch target holds 44px minimum.

Desktop (≥768px): a fixed 256px navy rail (`.on-navy` + `.glass`) carries navigation, the centre chip, and sign-out; content scrolls beside it. Mobile: a draggable navy floating pill (collapsed: drag grip + red NEW ENTRY stamp + ☰) opens the nav panel; the SyncIndicator docks inside the shared coupon head at `sm`+ (one indicator per screen; the shell floats no pill), and page actions sit in a toolbar row under the band, never in the band row that carries the headline.

The entry stub is a boarding pass at ≥1024px: `lg:grid-cols-5` with fields left (3 columns) and the fare-box breakdown, perforation, and STAMP & FILE right (2 columns); single column below.

## Elevation & Depth

Depth is material and tonal, not glow. Region colour (navy band over stock ground) and the paper lift do all the work. `.glass` carries one quiet two-layer shadow — a 1px contact line plus a wide low navy-tinted falloff (`0 1px 2px rgba(13,27,61,0.05), 0 12px 28px -16px rgba(13,27,61,0.14)`; black-equivalent in dark). No other shadows are sanctioned; there is no blur anywhere, and buttons express state with a 1px translateY lift/press, never elevation.

## Shapes

The form language is ticket geometry at a gentle radius. One radius token, `--radius: 10px` ("stub corners"), governs cards, buttons and inputs; inner panels and alert banners use 12px; chips and method toggles are full pills. The signature cut is the notched tab-cap: a `clip-path: polygon(0 0, 100% 0, 100% 100%, 14px 100%, 0 calc(100% - 9px))` that angles the tab's lower-left corner. The tear-off perforation (`.perf`) is a 2px dashed hairline terminated by 16px punched circles filled with the ground colour, sitting at the card edges. Hairline borders (`--pearl-border` at 16% alpha) divide fields and rows; no hard offset shadows, no chamfered corners in shipped work (chamfers remain reserved headroom).

## Components

### Buttons
- **Shape:** stub corners (10px); the mobile pill's stamp action is fully round.
- **Primary — the stamp** (`.btn-stamp`): solid jet red `#D7262D`, white narrow-caps label (+0.12em tracking), 10px 18px padding, 44px min height. Hover deepens to `#B81E24`; press nudges down 1px; lift up 1px on hover, 120ms `cubic-bezier(0.2, 0.8, 0.2, 1)`. Disabled is the ink-starved stamp pad (see Primary colour).
- **Stub button** (`.btn-glass` base): solid coupon white, hairline border, navy label (`.btn-label`, 650 weight; carbon in dark). Same metrics and motion as the stamp.
- **Semantic fills** (`.btn--commission/-vat/-bkash/-visa/-mastercard`): solid data-series colour, white text (night-ink text in dark); used where the button speaks for a payment method.
- Sign-out and destructive text actions ride red text accents (`text-red-600`) with a 10% red hover wash, never a red fill.

### Chips
- **Method toggles:** full pills, 12px vertical × 12px horizontal padding, 0.75rem 500. Selected: carrier navy fill, white text. Unselected: white at 40% over the stub, hairline border, ink text, white at 70% on hover.
- **Status/identity chips** (Chip component): pill with 1px border in the role colour — default is surface fill with muted border; variants use the data-series wash background with its ink and border.

### Cards / Containers
- **Corner Style:** 10px stub radius.
- **Background:** coupon white (dark: coupon navy `#141D36`); `.glass-subtle` variant washes white at 62% for nested panels.
- **Shadow Strategy:** the single paper lift from Elevation & Depth; nothing else.
- **Border:** hairline pearl border (16% alpha ink).
- **Internal Padding:** 20px standard, 24px for the entry stub form.

### Inputs / Fields
- **Style:** hairline border (`black/10` light, `white/10` dark), white at 50% fill over the stub, 8px radius, 0.875rem; numeric and reference fields set in mono (uppercase enforced for transaction refs).
- **Focus:** 2px outline — carrier navy in light, carbon in dark, 2px offset — via the global `:focus-visible`.
- **Money input:** the gross figure is the hero — text-2xl Archivo 700 in carbon mono, and its `0.00` placeholder reads at full carbon ink so the empty state still speaks money.
- **Errors:** inline 0.75rem red text under the field; field-level `aria-invalid` + `aria-describedby` wired.

### Navigation
- **Desktop rail:** 256px navy region via `.glass .on-navy`; app title in Archivo 700, links at 0.875rem with a 10% white hover wash, red NEW ENTRY stamp pinned on top, centre chip and sign-out docked at the foot. Capability-gated, never role-string-gated.
- **Mobile:** draggable navy pill (`.on-navy`, fully round) with the red stamp action and ☰; the expanded panel is a navy round-cornered card with the same link treatment and 44px rows.
- **Coupon head:** every page opens with the navy band — `.coupon-tab` tab-cap (page name), title, sync indicator, Online/Offline chip, carbon mono serial preview, and the red date flag (day-of-month hero at text-lg between 10px month and year).

### Signature Component — the fare-box receipt (`ReceiptBreakdown`)
The live calculation renders as a coupon fare box: tab-caps header over a hairline rule, mono rows pairing sans labels with tabular amounts (deduction rows colour-keyed to their data-series ink), a **dashed** divider — the receipt's own mini-perforation — and NET AFTER DEDUCTIONS in tab-caps navy against the carbon mono total at text-base bold. Customer-borne charges show without a minus and carry the "(Customer-paid — not deducted)" annotation; this honesty is part of the component, not copy decoration.

## Do's and Don'ts

### Do:
- **Do** wrap any navy region in `.on-navy` so ink tokens flip automatically; never hand-pick light text colours per child.
- **Do** set every amount, serial and numeric figure in `.carbon-nums` (tabular mono, carbon in light / carbon-night lavender in dark).
- **Do** use `.tab-caps` (Archivo Narrow 700 uppercase, +0.08em) for field labels and table heads.
- **Do** separate action zones from the stub with `.perf` perforations.
- **Do** keep 44px touch targets, AA contrast in both themes, and the reduced-motion/transparency/contrast media contracts on every new surface.
- **Do** keep the red primary to one action per screen; use stub buttons and semantic fills for everything else.
- **Do** keep UI strings in the i18n message catalog (`src/lib/i18n/messages.ts`).

### Don't:
- **Don't** apply backdrop blur or translucency to primary surfaces — stubs are paper (`.glass` is now a solid material despite its name).
- **Don't** use jet red as decoration, for selection states, or for more than the primary action, the date flag, and alert/void accents.
- **Don't** re-import pearl/jade or frosted-glass values into the legacy token names (`--pearl-*`, `.glass`); the names are load-bearing for consumers, the old values are gone.
- **Don't** reference Geist/Geist Mono (files remain in `static/fonts/` unreferenced; new faces must come from the self-hosted world stack).
- **Don't** invent serial digits or fixture amounts — serials preview as `E-{CODE}-{YYYYMM}-······` until the server allocates, and paper-ledger fixtures are quoted exactly.
- **Don't** convert entered figures to sans type or proportional digits; money's voice is fixed.
- **Don't** rebuild the navy shell by hand-tinting each element — without `.on-navy` the token scope breaks for every child.
