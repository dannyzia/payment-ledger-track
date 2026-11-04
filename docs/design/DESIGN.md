---
name: Calm Financial Clarity
colors:
  surface: '#f8faf8'
  surface-dim: '#d9dad8'
  surface-bright: '#f8faf8'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f2'
  surface-container: '#edeeec'
  surface-container-high: '#e7e9e6'
  surface-container-highest: '#e1e3e1'
  on-surface: '#191c1b'
  on-surface-variant: '#3f4945'
  inverse-surface: '#2e3130'
  inverse-on-surface: '#f0f1ef'
  outline: '#6f7975'
  outline-variant: '#bec9c4'
  surface-tint: '#0a6b59'
  primary: '#005142'
  on-primary: '#ffffff'
  primary-container: '#0b6b59'
  on-primary-container: '#97e8d2'
  inverse-primary: '#85d6bf'
  secondary: '#8c4f00'
  on-secondary: '#ffffff'
  secondary-container: '#fead5d'
  on-secondary-container: '#744000'
  tertiary: '#00429e'
  on-tertiary: '#ffffff'
  tertiary-container: '#235abe'
  on-tertiary-container: '#ccd9ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#a1f2db'
  primary-fixed-dim: '#85d6bf'
  on-primary-fixed: '#002019'
  on-primary-fixed-variant: '#005142'
  secondary-fixed: '#ffdcc0'
  secondary-fixed-dim: '#ffb875'
  on-secondary-fixed: '#2d1600'
  on-secondary-fixed-variant: '#6b3b00'
  tertiary-fixed: '#d9e2ff'
  tertiary-fixed-dim: '#b0c6ff'
  on-tertiary-fixed: '#001945'
  on-tertiary-fixed-variant: '#00419d'
  background: '#f8faf8'
  on-background: '#191c1b'
  surface-variant: '#e1e3e1'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 2.75rem
    fontWeight: '600'
    lineHeight: 3.25rem
    letterSpacing: -0.03em
  display-lg-mobile:
    fontFamily: Geist
    fontSize: 2rem
    fontWeight: '600'
    lineHeight: 2.5rem
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 1.75rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 1.375rem
    fontWeight: '500'
    lineHeight: 1.875rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Geist
    fontSize: 1.125rem
    fontWeight: '500'
    lineHeight: 1.625rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.5rem
    letterSpacing: -0.005em
  body-md:
    fontFamily: Geist
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.375rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Geist
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.125rem
    letterSpacing: 0.01em
  mono-tabular-lg:
    fontFamily: JetBrains Mono
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
    letterSpacing: -0.02em
  mono-tabular-md:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: -0.01em
  mono-tabular-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
    letterSpacing: 0em
  label-caps:
    fontFamily: Geist
    fontSize: 0.6875rem
    fontWeight: '600'
    lineHeight: 0.875rem
    letterSpacing: 0.06em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.25rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-tablet: 2rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.875rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system is engineered for high-precision, low-cognitive-load financial management. It centers on calm clarity, replacing fintech anxiety and hyper-saturated novelty with editorial serenity, structural restraint, and absolute legibility.

### Target Audience & Emotional Intent
Built for operators, treasury managers, enterprise finance teams, and multi-rail merchants navigating complex cross-border and regional payment flows (including South Asian payment networks). The interface evokes unhurried confidence, mathematical rigor, and architectural stillness.

### Design Movement: Luminous Editorial Minimalism
The aesthetic pairs warm tactile minimalism with functional translucent chrome:
- **Base Canvas:** Pearl-white warm foundation (`#F6F5F1`) enhanced by micro-fine organic grain (1.5% monochromatic noise overlay) and faint, diffuse peripheral glows in muted lilac and soft blush at canvas extremes.
- **Glass Chrome Boundary:** Frosted glass is applied strictly to floating actions, flyout menus, contextual sheets, and persistent sidebar navigation bars. Glass is explicitly forbidden on large data tables, data rows, or ledger grids to avoid visual vibration.
- **Data Grounding:** Solid, crisp white content surfaces create stark architectural separation against the warm canvas, allowing critical financial metrics to stand out without competing for attention.

## Colors

The palette establishes an unshakeable hierarchy grounded in dark botanical mineral tones and natural earth pigments, rejecting synthetic neons and corporate indigo defaults.

### Primary & Functional Accents
- **Primary Brand Accent (Dark Jade):** `#0B6B59` — anchors committed transactions, active master controls, primary navigational markers, and balanced states.
- **VAT / Pending (Earthy Ochre):** `#8C4F00` — denotes statutory withholding, VAT allocations, and non-blocking pending ledger entries.
- **Visa Network (Royal Blue):** `#1A54B8` — designates Visa card rails and settlement batches.
- **Mastercard Network (Rust Orange):** `#9E3600` — marks Mastercard routing and interchange adjustments.
- **Mobile Financial Services (bKash Magenta):** `#B80053` — designates bKash rails, wallet disbursements, and regional integrations.
- **System Destructive / Error (Crimson Red):** `#C42B2B` — flags reconciliation failures, chargebacks, and security anomalies.

### Background, Neutrals & Surface Tiers
- **Canvas Base:** `#F6F5F1` (Pearl-white warm canvas).
- **Corner Glow Bleeds:** Radial gradient blurs at viewport vertices using Lilac (`#E8E5EE`, 18% opacity, 240px blur) and Warm Blush (`#F5E8E4`, 14% opacity, 240px blur).
- **Solid Data Surfaces:** `#FFFFFF` (Pure solid white for data density and ledger cards).
- **Frosted Glass Surface Base:** `rgba(255, 255, 255, 0.72)` supported by `backdrop-filter: blur(16px) saturate(140%)`.
- **Text & Contrast Ramps:**
  - High-Emphasis Ink: `#1C1F1E` (Warm carbon neutral, 4.5+:1 to 14:1 contrast).
  - Medium-Emphasis Ink: `#535A57` (Subdued metadata, labels, and table headers).
  - Low-Emphasis Ink: `#8A938F` (De-emphasized timestamps, inactive rules).
  - Structural Hairlines: `rgba(28, 31, 30, 0.08)` on solid layers; `rgba(255, 255, 255, 0.45)` highlight borders on frosted glass.

## Typography

The type system creates clear separation between narrative hierarchy and programmatic financial execution.

### Font Pairings & Roles
- **Primary UI & Headings:** Geist handles all contextual UI copy, page headers, narrative overviews, and system dialogs. Rendered with tight letter tracking to emphasize precision.
- **Tabular Numerals & Ledger Identifiers:** JetBrains Mono serves as the monospaced tabular engine. It enforces fixed-width columnar integrity for currency values, ledger hashes, tax codes, transaction UUIDs, and timestamps.
- **Numerical Formatting Standards:** All values require explicit `font-feature-settings: "tnum" 1, "zero" 1`. South Asian regional numbering formatting is strictly parsed and displayed at the token level (e.g., `৳1,23,456.00` rather than Western standard millions) to prevent visual parsing errors in local reconciliation.

## Layout & Spacing

This design system uses a structured 12-column responsive fluid grid anchored by strict bounding restraints for expansive multi-monitor setups.

### Breakpoints & Grid Composition
- **Mobile (< 768px):** 4 columns, `margin: 1rem`, `gutter: 1rem`. Bottom navigation replaces side nav; all high-density ledger rows collapse to stacked transactional cards.
- **Tablet (768px – 1199px):** 8 columns, `margin: 2rem`, `gutter: 1.25rem`. Frosted glass navigation operates as an expandable rail (`64px` collapsed width).
- **Desktop (≥ 1200px):** 12 columns, `margin: 2.5rem`, `gutter: 1.5rem`, max content container `1440px`. Frosted glass sidebar is pinned at `260px` fixed width.

### Vertical Rhythm & Layout Rules
- All touch targets strictly observe a minimum dimension of `44px x 44px`.
- Dense data tables maintain a fixed cell padding of `0.75rem` vertical and `1rem` horizontal, preserving vertical data alignment without crowding row lines.

## Elevation & Depth

Depth is defined through physical materiality: pure solid data planes grounded on warm textured canvas, contrasted with floating ambient frosted chrome.

### Surface Tiers & Treatment
- **Tier 0 (Base Canvas):** `#F6F5F1` with an SVG-generated micro-noise filter (`feTurbulence`, 1.5% opacity, mix-blend-mode overlay). Completely flat, anchor level.
- **Tier 1 (Solid Data & Ledger Cards):** Pure white (`#FFFFFF`) surfaces. Depth is established through an ultra-diffuse ambient shadow combined with a subtle structural rim:
  - `box-shadow: 0 1px 2px rgba(28, 31, 30, 0.03), 0 8px 24px -4px rgba(28, 31, 30, 0.05);`
  - `border: 1px solid rgba(28, 31, 30, 0.05);`
- **Tier 2 (Interactive Frosted Glass Chrome):** Reserved for floating control bars, action menus, slide-over sheets, and persistent navigation chrome.
  - Background: `rgba(255, 255, 255, 0.72)`.
  - Filter: `backdrop-filter: blur(16px) saturate(140%); -webkit-backdrop-filter: blur(16px) saturate(140%);`.
  - Border/Highlight: `border: 1px solid rgba(255, 255, 255, 0.65); box-shadow: 0 12px 32px -6px rgba(28, 31, 30, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.8);`.
  - Data tables, transaction list rows, and ledger entries must never use glassmorphism or background blurs.

## Shapes

The shape system balances soft approachable geometry with functional ledger ergonomics.

### Curvature Geometry
- **Primary Content & Data Cards:** Explicitly crafted at a continuous `18px` border radius (`rounded-[18px]`). This curvature softens dense analytical dashboards without cutting into column margins or numerical tables.
- **Pill UI Components (`rounded-full`):** Reserved for category chips, state tags, and floating glass control buttons.
- **Form Controls & Micro Inputs:** Set at `8px` (`0.5rem`) to retain structural crispness when nested inside `18px` parent containers.

## Components

### Buttons
- **Frosted Glass Pill Buttons:** Used for secondary triggers, canvas filter toggles, export actions, and toolbar groupings.
  - Shape: Fully rounded pill (`border-radius: 9999px`).
  - Surface: `rgba(255, 255, 255, 0.65)` backdrop with `blur(12px)`.
  - Border & Texture: An engraved/embossed rim using a dual-line effect: `border: 1px solid rgba(255, 255, 255, 0.75)`, paired with `box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.9), 0 2px 6px rgba(28, 31, 30, 0.04)`.
  - Height: `44px` minimum touch target.
  - Typography: Geist Medium, `0.875rem`.
- **Primary Brand Button:** Solid Dark Jade (`#0B6B59`) fill, white high-contrast text, subtle top inner specular highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.15)`), resting on `rounded-full`.

### Category & Status Chips
Pill-shaped badges (`rounded-full`, padding `0.25rem 0.625rem`) rendered in a clean, non-glass matte tint against solid card surfaces:
- **Commission / Settled:** `#0B6B59` text over `rgba(11, 107, 89, 0.08)` ground.
- **VAT Allocation / Pending:** `#8C4F00` text over `rgba(140, 79, 0, 0.08)` ground.
- **bKash Routing:** `#B80053` text over `rgba(184, 0, 83, 0.08)` ground.
- **Visa Channel:** `#1A54B8` text over `rgba(26, 84, 184, 0.08)` ground.
- **Mastercard Channel:** `#9E3600` text over `rgba(158, 54, 0, 0.08)` ground.
- **Alert / Discrepancy:** `#C42B2B` text over `rgba(196, 43, 43, 0.08)` ground.

### Data Cards & Ledger Tables
- **Cards:** Pure solid white (`#FFFFFF`) with uniform `18px` corners. Padded at `1.5rem` on desktop and `1.25rem` on mobile devices.
- **Table Rows:** Flat, crisp, non-glass layout. Alternating hovers use subtle Pearl neutral `#F6F5F1` at 50% opacity. Row dividers are fine structural hairlines (`rgba(28, 31, 30, 0.06)`).
- **Tabular Number Rows:** JetBrains Mono, right-aligned, using localized currency formatting (e.g., `৳1,23,456.00`). Status indicators sit left of monetary values.

### Form Inputs & Select Fields
- **Container:** Pure `#FFFFFF` surface, `8px` corner radius, `44px` minimum vertical height.
- **Border:** `1px solid rgba(28, 31, 30, 0.12)`.
- **Focus State:** Border shifts cleanly to Dark Jade (`#0B6B59`) with an outer focus halo of `0 0 0 3px rgba(11, 107, 89, 0.12)`. No fuzzy glow or colored blurs.

### Floating Action Chrome & Sheets
- **Contextual Drawers & Navigation:** Frosted glass backing (`rgba(255, 255, 255, 0.72)` with `16px` blur) floats smoothly over the base canvas.
- **Dividers within Chrome:** Subtle translucent separators (`rgba(28, 31, 30, 0.06)`) preserve layout structure without breaking the translucent glass effect.