# Self-hosted fonts

PRD §14 requires the UI fonts to be self-hosted, not fetched from a CDN at runtime. These
files are served from `/fonts/*` and declared in `src/app.css`.

| File | Family | Subset | Source | Fetched | Licence |
|---|---|---|---|---|---|
| `Geist-Regular.woff2` | Geist (variable, wght 100–900) | latin | https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwcGFU.woff2 | 2026-11-07 | SIL Open Font License 1.1 |
| `GeistMono-Regular.woff2` | Geist Mono (variable, wght 100–900) | latin | https://fonts.gstatic.com/s/geistmono/v6/or3nQ6H-1_WfwkMZI_qYFrcdmg.woff2 | 2026-11-07 | SIL Open Font License 1.1 |
| `NotoSansBengali-Regular.woff2` | Noto Sans Bengali (variable, wght 100–900) | bengali | https://fonts.gstatic.com/s/notosansbengali/v33/Cn-fJsCGWQxOjaGwMQ6fIiMywrNJIky6nvd8BjzVMvJx2mc4I3mYvNY.woff2 | 2026-11-07 | SIL Open Font License 1.1 |

URLs were resolved from Google Fonts' `css2` endpoints (`family=Geist:wght@100..900`,
`family=Geist+Mono:wght@100..900`, `family=Noto+Sans+Bengali:wght@100..900`) with a
Chromium user agent so that woff2 rather than TTF was served.

Why these subsets: every string in the app is Latin except Bengali customer text and the
Taka sign `৳` (U+09F3), which the Bengali subset carries. `Geist` and `Geist Mono` have no
Bengali glyphs, so `--font-sans` falls through to Noto Sans Bengali for them.

Replacing a file: keep the filename and the `@font-face` weight range in `src/app.css`
(`100 900`) in step with the file — a static single-weight file declared as variable makes
the browser synthesise weights. Verify with `document.fonts.check('16px Geist')` and by
watching the console for `Failed to decode downloaded font` / OTS errors, which is what the
31-byte placeholder files in this directory used to produce (CLT-R-014).
