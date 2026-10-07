# Evolve Tennis Inventory — design guide

The rules for every HTML design made for this project. It is distilled from the
reference files in `design/reference/`:

- `Evolve Inventory.dc.html` — the approved prototype of the whole app (all screens,
  dialogs, sample data and logic). **This is the source of truth.** When this guide and
  the prototype disagree, the prototype wins.
- `_ds/sportcraft-design-system-…/` — the SportCraft design system the prototype is
  built on (tokens, component bundle, `readme.md` with the full brand rules).
- `support.js` — the runtime that renders `.dc.html` files. Don't edit it.
- `thumbnail.webp` — screenshot of the prototype.

Evolve Tennis is a Singapore-based **distributor** of MSV tennis strings plus grips and
accessories. It buys from suppliers (MSV GmbH, Formosa Grip Works) and sells to regional
distributors, Singapore clubs and walk-in/online retail. The app is an internal stock
and sales tool, used by a small team.

---

## 1. Evolve-specific overrides (differences from SportCraft)

The design system was written for "SportCraft". Evolve uses its palette, spacing,
radii, shadows and components, with these deliberate changes:

| Topic | SportCraft default | Evolve uses |
| --- | --- | --- |
| Font | Space Grotesk / Archivo / IBM Plex Mono | **Manrope everywhere** (400/600/700) for display, body and "mono" roles. Numbers use `font-variant-numeric: tabular-nums` on `body`. |
| Mono micro-labels | IBM Plex Mono, 0.085em tracking | Manrope 600, 10.5–11.5px, uppercase, `letter-spacing: 0.06em`, colour `#79838B` |
| Buttons | weight from DS | all buttons `font-weight: 600` |
| Brand name | "SportCraft" | wordmark set in type: **Evolve Tennis** + small `STOCK` tag (optic `#D6F25B` text, `#3E8E73` 1px border, 3px radius). Collapsed: **ET** |
| Currency | — | **Singapore dollars**, written `S$1,234.56` (`en-SG` locale). Whole-dollar `S$1,235` for KPIs/totals in summaries. Labels say `SGD`. |
| Dates | — | `en-GB` short: `7 Oct` or `7 Oct 26` |

Load the font with:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap">
```

## 2. Colour tokens

Use these hex values (from `tokens/colors.css`). Define them as CSS custom properties on
`:root` in standalone pages.

- **Court green (structural):** 900 `#07231C` · 800 `#0B3227` · 700 `#0F4436` · 600 `#12573F` · 500 `#166B52` · 400 `#3E8E73` · 300 `#6FA793` · 200 `#AFCCC0` · 100 `#DCEAE3` · 050 `#EFF6F2`
- **Optic yellow-green (accent, once per view max):** 600 `#A8C22F` · 500 `#C2DC42` · 400 `#D6F25B` · 200 `#E9F8AE` · 100 `#F4FBD9`
- **Clay (warm secondary, used for money owed):** 700 `#8E3F22` · 600 `#B3542F` · 500 `#C86A41` · 300 `#E0A184` · 100 `#F6E2D7`
- **Ink (cool neutrals):** 900 `#101418` · 800 `#1B2126` · 700 `#2A3138` · 600 `#434C54` · 500 `#5A646D` · 400 `#79838B` · 300 `#98A1A8` · 200 `#C7CDD1` · 100 `#E3E7E9` · 050 `#F0F2F3`
- **Paper (grounds):** 000 `#FFFFFF` · 050 `#FAF9F6` (page) · 100 `#F3F1EC` · 200 `#E9E6DF`
- **Signals:** success `#157F52` / bg `#E2F1E9` · warning `#9A6B0C` / bg `#FAEED2` · danger `#B0342A` / bg `#F8E3E0` · info `#2C5BA8` / bg `#E4EBF7`

How Evolve applies them:

- Page `#FAF9F6`; cards `#FFFFFF`; top bar `#FFFFFF` with `#E3E7E9` bottom border.
- Sidebar `#0B3227`. Nav item idle text `#AFCCC0`, active background `#12573F` + white text. Group labels `#6FA793`. Nav count pill: `#D6F25B` bg, `#0B3227` text.
- Primary action = court-700 button. Positive movement (stock in, margin) `#12573F`.
- Stock status: **In stock** → success tone, text `#101418` · **Low** → warning, `#9A6B0C` · **Out** → danger, `#B0342A`.
- Unpaid / awaiting payment figures → clay `#B3542F`. Payment badges: Paid = success, Unpaid = warning.
- Charts: bars `#12573F` (current, incomplete month `#AFCCC0`); revenue background bar `#DCEAE3` with profit overlay `#12573F`; progress/share bars `#3E8E73` on `#F0F2F3` track, 4–6px tall, pill radius.
- Colour swatches for string colours: Black `#1B2126`, White `#FFFFFF`, Silver `#C7CDD1`, Natural `#E9E0C9`, Neon Yellow `#D6F25B`, Neon Green `#7BD96B` — 10px circle with `#C7CDD1` border.
- No gradients, no textures. At most paper + one court-green surface per screen.

## 3. Type scale (Manrope)

| Use | Size / weight |
| --- | --- |
| Page title (top bar `h1`) | 20px / 700, tracking −0.012em, with uppercase eyebrow above |
| Detail heading (`h2`) | 24px / 700 |
| Card heading (`h3`) | 16px / 600 (product group header 17px) |
| KPI figure | 30px / 700, tracking −0.016em (secondary KPIs 24–26px; hero 40px) |
| Body / row primary text | 14.5px / 600 for names, 14px regular |
| Secondary meta | 12.5–13.5px, `#79838B` or `#5A646D` |
| Numeric cells | 13px, right-aligned, tabular |
| Column headers & micro-labels | 10.5px / 600 uppercase, 0.06em, `#79838B` |
| Form labels | 11px / 600 uppercase, 0.06em, `#5A646D` |

Body never smaller than 12px except micro-labels; headings never above 56px.

## 4. Layout

- **App shell:** sticky full-height sidebar 248px (collapses to 72px icon rail below 1100px wide), then main column.
- **Top bar:** sticky, min-height 64px, padding `10px 28px`; left = eyebrow + title, right = page actions. Global actions are always present: `Record purchase` (secondary, icon `package-plus`) and `Record sale` (primary, icon `receipt`). Products page adds `Add variant` (ghost, `plus`).
- **Content:** padding `28px 28px 64px`, max-width 1440px, vertical gap 20px.
- **KPI row:** `grid-template-columns: repeat(auto-fit, minmax(190–210px, 1fr))`, gap 16px.
- **Two-panel rows:** flex-wrap with `flex: 2 1 520px` / `flex: 1 1 320px`.
- **Data tables** are CSS grids, not `<table>`: header row on `#FAF9F6` with `#E3E7E9` bottom border; rows padding `11–12px 20px`, `#F0F2F3` top border, hover `#FAF9F6`; wrap in `overflow-x:auto` with a `min-width` (720–860px). Total rows close with a `1.5px #2A3138` top border.
- **Expandable rows** (purchases, sales): chevron-right / chevron-down; line items on `#FAF9F6` indented 58px.
- **Two-pane list/detail** (customers, suppliers): list max 420px with selected item marked by a 3px left border; detail card with a 1px-gap stat grid.
- Toasts bottom-right, 24px from edges, 380px wide.
- Must work at phone width (the sidebar collapses; tables scroll horizontally).

## 5. Components and patterns

- **Card:** white, `1px solid #E3E7E9`, radius 8px, shadow `0 1px 2px rgba(16,20,24,0.06)`, padding 20–24px. Card header: `16px 20px` padding, bottom hairline, `h3` left + micro-label right. Interactive cards hover to `0 2px 6px rgba(16,20,24,0.08)` and border `#C7CDD1` — no lift, no scale.
- **KPI card:** micro-label → big figure → 13.5px context line (`At cost · S$… at retail`, `+12% vs previous 30 days`).
- **Segmented tabs (filters):** container `#F3F1EC`, 1px `#E3E7E9` border, 6px radius, 3px padding; 30px buttons, 4px radius; active = white bg. A small count after each label in `#79838B`.
- **Buttons:** primary (court-700), secondary (white, outlined), ghost. Sizes md 38px, sm 30px. Radius 5px. Verb + object labels.
- **Badges:** small, radius 3px, tones `success | warning | danger | neutral | brand`, usually with a leading dot for status.
- **Inputs/selects:** 38px tall, `1px solid #C7CDD1`, radius 5px, white; suffixes for units (`mm`, `SGD`, `units`). Focus: `box-shadow: 0 0 0 2px #FAF9F6, 0 0 0 4px #C2DC42` — never browser blue.
- **Dialogs:** title + one-line description that states the consequence ("Stock goes up as soon as you save."). Line-item editor grid: Variant · Qty · Unit price/cost · Line total · remove ×. Footer: running summary left (`−12 units · total S$…`), Cancel (ghost) + Save (primary, `check` icon) right. Width 640–760px.
- **Icons:** Lucide (`https://unpkg.com/lucide@0.544.0/dist/umd/lucide.min.js`), stroke 1.75, `currentColor`, 16–18px. Functional only. Icons in use: `layout-dashboard`, `package`, `boxes`, `truck`, `receipt`, `users`, `factory`, `chart-column`, `package-plus`, `plus`, `check`, `x`, `search`, `chevron-right`, `chevron-down`.
- **Empty states:** state the fact — "No variants match those filters.", "All invoices are paid.", "Every variant is above its reorder level."
- **Footnotes** explaining a calculation: 13px `#79838B` paragraph under the table.
- Motion: 120–240ms, `cubic-bezier(0.2,0.6,0.2,1)`. Colour/opacity/height only.

## 6. Navigation (information architecture)

| Group | Page | Icon | Badge count |
| --- | --- | --- | --- |
| Overview | Dashboard | `layout-dashboard` | — |
| Inventory | Products & variants | `package` | — |
| | Stock levels | `boxes` | low + out variants |
| Transactions | Purchases | `truck` | — |
| | Sales | `receipt` | unpaid invoices |
| Contacts | Customers & distributors | `users` | — |
| | Suppliers | `factory` | — |
| Insights | Reports | `chart-column` | — |

Dashboard has three layout options in the prototype: **Overview** (default), **Stock-first**, **Sales-first**.

## 7. Domain model and sample data

- **Product** — name, short code, category (`String` · `Grip` · `Accessory`), kind (Co-polyester, Multifilament, Overgrip, Replacement grip, Dampener).
  Products: Focus Hex Soft (FHS), Focus Hex (FH), Co-Focus (CF), Hepta-Twist (HT), Swift (SW, multifilament), Pro Overgrip (OG), Tour Replacement Grip (RG), Vibration Dampener (DA).
- **Variant** — one sellable combination: gauge (mm, e.g. `1.25`), colour, pack (`12m set` · `200m reel` · `3-pack` · `1 pc`), unit **cost**, **distributor** price, **retail** price, **reorder at** threshold, opening stock.
  SKU = `CODE-GAUGE-COLOURINITIALS-PACK`, e.g. `FHS-115-B-S` (S = set, R = reel, P = piece/pack).
  Spec line: `1.25mm · Black · 200m reel`.
- **Stock** — on hand = opening + purchased − sold. Status: Out (≤ 0), Low (≤ reorder level), In stock.
- **Purchase** — `PO-1001…`, supplier, date received, lines (variant, qty, unit cost). Raises stock.
- **Sale / invoice** — `INV-2001…`, customer, date, price list (**Distributor** prices for distributors, **Retail** for clubs and walk-in), lines, Paid/Unpaid. Lowers stock; warn when a line exceeds stock or pushes a variant below its reorder level.
- **Customers** — type `Distributor` (Racquet Lab KL · Malaysia, Bangkok Pro Racquet · Thailand, Jakarta Tennis Supply · Indonesia, Manila Stringing Co. · Philippines), `Club` (Kallang Tennis Hub, Tanglin Tennis Academy · Singapore), `Retail` (Walk-in & online · Singapore).
- **Suppliers** — MSV GmbH (Germany, strings, 6–8 weeks lead), Formosa Grip Works (Taiwan, grips and accessories, 3–4 weeks).
- **Metrics** — inventory value at cost and at retail, revenue, gross profit, margin (`(rev − cost) / rev`), units in/out, orders, average order, awaiting payment. Periods: last 30 / 90 days, YTD; "vs previous 30 days" deltas.
- Prototype "today" is `2026-10-07`; data persists in `localStorage` key `evolve-inventory-v4` with a "Reset sample data" link in the sidebar footer.

## 8. Voice and copy

- Plain, specific, slightly dry. Numbers over adjectives. Units always explicit.
- Sentence case for headings, buttons, labels. Uppercase only for micro-labels.
- No exclamation marks, no emoji, no "Submit"/"Learn more"/"Get started".
- Buttons: verb + object — *Record sale*, *Record purchase*, *Add variant*, *Save purchase*, *Mark paid*, *Reorder*, *Add line*.
- Metadata separated with a mid-dot: `INV-2043 · 3 Oct · S$1,240`.
- Toasts: title = what happened (`INV-2044 saved`), message = the consequence (`Stock down 36 units. 2 variants are now below reorder level.`).
- Minus sign is `−` (U+2212), multiplication `×`.

## 9. Building a new HTML design

1. Read this guide; open `design/reference/Evolve Inventory.dc.html` for the exact markup of any screen you are extending.
2. Default output is a **single self-contained `.html` file**: put the colour tokens in `:root`, load Manrope from Google Fonts and Lucide from unpkg, keep CSS/JS inline. Don't reference `_ds/` relative paths unless the file is saved inside `design/reference/` alongside them.
3. Reuse the app shell (sidebar + top bar) for any in-app screen so it fits the prototype.
4. Use realistic data from section 7 — real product names, SKUs, S$ prices, customers — never lorem ipsum.
5. Include empty, low-stock and unpaid states where relevant.
6. Check it at ~375px and ~1440px widths.
7. Put new designs in `design/` (e.g. `design/stock-take.html`).
