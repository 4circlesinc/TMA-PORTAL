# TM ANTOINE Advisory Design System — tma-portal

**Single source of truth** for all developers, AI coding agents, and contributors working on this project.

This repository already contains the design language, assets, components, layouts, and documentation required to build and scale the application. **Reuse and extend what exists. Do not reinvent.**

> **Mandatory — read before any code change**  
> **Always read this entire file (`DESIGN_SYSTEM.md`) before writing or modifying code** — including AI agents and automated tools. Search the codebase and component registry first. **Do not recreate** components, CSS classes, buttons, toggles, toasts, or layout patterns that already exist. If something similar is documented here or in `design/common-components.json`, **reuse it**.

---

## Authoritative Sources

| Source | Path | Role |
|--------|------|------|
| Figma file | [Portal-Design](https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design) (`58ZXC7sZYQsbenzf0foWCH`) | Visual spec |
| tma-portal | [tma-portal](#) | Component usage |
| Figma hub | `design/figma.json` | Node IDs, URLs, MCP entry points |
| Design tokens (JSON) | `design/tokens.json` | Canonical token values |
| Design tokens (CSS) | `public/css/tokens.css` | Runtime CSS variables |
| Theme (semantic) | `public/css/theme.css` | Component-scoped aliases |
| Component registry | `design/common-components.json` | Implemented Blade/JS components |
| Per-component specs | `design/*.json` (76 files) | Variants, sizes, Figma node IDs |

**Load order for any page:**

```
tokens.css → theme.css → component CSS → (optional) page CSS
```

---

## Development Rules

### Rule 1 — Reuse Before Creating

Always search the existing codebase before creating anything new. If a component, style, icon, layout, pattern, utility, token, asset, or design element already exists, **reuse it**.

Search locations (in order):

1. `design/common-components.json` — registered components
2. `design/{slug}.json` — component preset
3. `public/js/{component}.js` — render/mount API
4. `public/css/{component}.css` — styles
5. `public/demo/` — working examples
6. `resources/views/components/` — Blade components
7. `app/Support/` — PHP data helpers

### Rule 2 — No New Styling Systems

Do **not** create new color palettes, spacing systems, typography systems, button styles, card styles, table styles, icon styles, or design patterns. Use tokens and existing component CSS only.

### Rule 3 — Follow the Existing Design System

Every screen, page, feature, and component must match the established TM ANTOINE Advisory design system. No visual deviations unless explicitly approved.

### Rule 4 — Functionality First

When implementing new requirements: focus on functionality; reuse existing UI components, styling, layouts, and assets. Extend the system — do not reinvent it.

### Rule 5 — No Duplicate Components

Never create a new component if a similar or identical one exists. Extend or compose existing primitives (`Text`, `Frame`, `Group`, `Button`, `Input`, etc.).

### Rule 6 — Preserve Brand Consistency

Maintain consistency with brand identity, colors, typography, icons, illustrations, logos, and design language.

### Rule 7 — Document Everything

Update this file whenever new approved components or patterns are added.

### Rule 8 — Hover States Are Restricted (read before adding any `:hover`)

Hover affordances are **only** allowed on the elements that have a documented Hover state in the Component State matrix (`interactive-guidance-component-state.js`): **buttons, text buttons, icon buttons, tabs, tags, text links, popover/menu items, table titles, breadcrumb segments, avatars, and the scrollbar**. The documented hover treatment is a **subtle `var(--color-hover)` (rgba(0,0,0,0.04)) background overlay only**.

**Prohibited — never add these on hover:**

- ❌ Elevation / lift on cards, metric cards, panels, or any container (`transform: translateY(...)`, `scale(...)`).
- ❌ Added `box-shadow` / glow on hover for cards, panels, charts, or containers.
- ❌ Dimming, scaling, recoloring, or animating chart bars, donut segments, or lines on hover.

**Cards** (`design/card.json` → states `default / hover / selected / no-interaction`): the hover state is a background change only — **never** elevation or shadow.

**Charts/graphs:** the *only* hover affordance is the **value tooltip** (reuse the TMA Tooltip component — `components.css` + `tooltip.js`). Do not alter the bar/segment/line itself on hover.

If a design appears to need a new hover behavior, it must be added to the Component State matrix and approved before use.

### Rule 9 — Responsive layout, cards, and text

These rules apply to **every page and view** in the application shell — main content, sidebars, panels, stat cards, tables, and compact list areas.

**Spacing inside surfaces**

- Content inside rounded cards and panels must **never sit flush against the edges**. Use consistent inner padding or inset so labels, values, chips, and decorative elements stay clear of corners and borders.
- There must always be a **minimum gap between adjacent content** (e.g. a label and a trailing graphic). Nothing should visually touch or overlap.

**Fluid scaling**

- As the window or container narrows, **type and card content scale down proportionally** — prefer `clamp()`, container queries (`container-type: inline-size`), and existing token steps over fixed pixel sizes or hard breakpoint jumps.
- Cards should **keep their intended shape** (padding, hierarchy, row layout) while shrinking; only at a minimum width should layout change.

**Card grids and rows**

- **Keep cards side by side as long as possible.** Use flexible grids (`auto-fit` / `minmax`) so multiple cards share a row until they hit a minimum readable width, then wrap or stack at the next breakpoint.
- Do not collapse to a single column earlier than necessary.

**What to show in full vs. truncate**

| Area | Rule |
|------|------|
| **Main content** (metrics, tables, primary panels) | Important values and labels stay **fully visible**. Numbers and key copy must not ellipsis (e.g. `93.8%` must never read as `93....`). Prefer horizontal scroll on wide tables over cutting columns or chips. |
| **Secondary copy in the same row** | Supporting text (trends, subtitles, meta) **yields space first**; only that secondary line may ellipsis when space is tight. |
| **Compact / narrow regions** (notification lists, activity feeds, contact rows) | Single-line rows are OK; long text may use ellipsis. Keep related items on one line where the design shows title + timestamp inline. |

**Scroll and footer (mobile)**

- On small viewports, the **page footer belongs to the content** — it scrolls with the page, not pinned to the viewport bottom. Fixed chrome (e.g. bottom tab bar) stays fixed; everything else in the main column scrolls as one flow.
- Full-page flows that manage their own scroll (e.g. settings) may keep internal sticky footer behavior.

**Tables (≤767px)**

- Keep the **table row layout** (headers and columns unchanged). Wrap wide tables in a horizontal scroll container so labels and values stay fully visible rather than reflowing into cards or stacked fields.

**Implementation**

- Reuse spacing tokens from `tokens.css` / `theme.css`. Where the app shell defines shared inset/gap variables, use those rather than one-off values.
- Reference implementations: `public/css/dashboard.css`, `public/css/card.css` — patterns there should be copied to new pages, not re-invented.

---

## Required Workflow (Before Writing Code)

> **Stop:** Re-read the mandatory notice at the top of this file. Every task starts here — not with new markup or CSS.

1. **Read `DESIGN_SYSTEM.md`** (this file) and check `design/figma.json` for the relevant Figma node.
2. Search `design/common-components.json`, `public/demo/`, and existing page modules (`public/js/{page}.js`) for reusable pieces.
3. Identify reusable components, tokens, and assets — **extend; do not duplicate**.
4. Check `public/demo/` for a working reference.
5. Implement using existing CSS/JS/Blade patterns only.
6. Add or update the matching `design/{slug}.json` entry when introducing an approved component.
7. Update this document if a new approved pattern is introduced.

---

## Architecture

### Repository Layout

```
Portal/
├── design/                  # JSON specs, tokens, Figma node IDs (76 files)
├── public/
│   ├── css/                 # Component + page styles (37 files)
│   ├── js/                  # Component renderers + page boards (72 files)
│   ├── demo/                # Static HTML demos (78 pages)
│   └── images/              # Icons, charts, avatars, illustrations, emoji
├── app/Support/             # PHP catalog helpers (20 classes)
├── resources/views/
│   ├── components/          # Blade components (<x-tab-group />, etc.)
│   └── partials/            # CSS/JS bundle includes
└── scripts/                 # Asset build scripts (cursors, etc.)
```

### Dual Implementation Stack

| Layer | Technology | When to use |
|-------|------------|-------------|
| **Static demos** | HTML + vanilla JS + CSS | Documentation, guidance boards, Figma-faithful previews |
| **Laravel target** | Blade + `app/Support/*` | Production pages (include `partials/components`) |

Both layers share the same tokens, assets, and `design/*.json` presets.

### JavaScript API Conventions

Global namespace: `window.TMA{ComponentName}`

| Pattern | Methods | Example |
|---------|---------|---------|
| Render string | `render*(opts)` | `TMAButton.renderButton({ variant, size })` |
| Mount page | `mount*(root)` | `TMAInteractiveGuidancePage.mountInteractiveGuidancePage(el)` |
| Mount docs | `mountDocumentation(opts)` | `TMATextDoc.mountDocumentation({ examplesEl })` |
| Mount instances | `mountInstances(el)` | `TMAFrameInstances.mountInstances(el)` |
| Mount guidance | `mountGuidance(container)` | `TMAFormsGuidance.mountGuidance(slot)` |
| Interactive | `mountInteractive(root, opts)` | `TMAInput.mountInteractive(board)` |
| Icon registry | `TMA*Icons.svg(key, cls, w, h)` | Inline SVG from `*-icons.js` modules |

### CSS Class Prefixes

| Prefix | Purpose |
|--------|---------|
| `tma-*` | Component instances (`.tma-button`, `.tma-tab-group`, `.tma-overview`) |
| `ig-*` | Interactive guidance doc cards (`.ig-doc`, `.ig-board-card`) |
| `ds-*` | Design system overview board (`.ds-cover-tma`, `.ds-board-card`) |
| `dr-*` | Design resources sections |
| `tma-cs-*` | Component state matrix (interactive guidance) |

### Board Layout Pattern

Large Figma canvases use absolute-positioned panels inside a scrollable wrapper:

```html
<div class="ig-demo__board-wrap">
  <div class="ig-demo__board" style="width:17981px;height:14515px">
    <div class="ig-board-card" style="left:1600px;top:4787px;width:2036px;height:5334px">
      <div class="ig-board-card__slot"><!-- panel content --></div>
    </div>
  </div>
</div>
```

Panel positions and sizes come from `design/{page}.json` (e.g. `interactive-guidance.json`, `design-system.json`).

---

## Design Tokens

**Source files:** `design/tokens.json` → `public/css/tokens.css` → `public/css/theme.css`

### Colors

> **Rule — the primary accent color is the TMA branding blue.**
> `--color-primary` (`#03a5e9`) and `--color-primary-dark` (`#136da0`, sampled from the TMA logo) are the brand blues. Every primary accent — links, badges, highlights, progress fills, **selected table rows**, **selection toolbars**, **checkbox `accent-color`**, focus rings, upload overlay tints — must render the brand blue, never purple/indigo. Use `--color-accent` (alias of `--color-primary-dark`) and `--color-accent-bg` / `--color-accent-bg-hover` for selection tints. `--color-indigo` and `--color-purple` are **remapped to `var(--color-primary-dark)`** so legacy consumers pick this up automatically; do not reintroduce `#adadfb` or `#9747ff` for UI accents. Violet (`--color-violet`, `--chart-purple`) remains only for chart series, status chips, and categorical tones — not for primary interaction states.

| Token | Value | Usage |
|-------|-------|-------|
| `--color-black` | `#000000` | Primary text, filled buttons |
| `--color-white` | `#ffffff` | Surfaces on dark, filled button text |
| `--color-primary` | `#03a5e9` | **TMA brand blue** (bright) — tints, emphasis, links |
| `--color-primary-dark` | `#136da0` | **TMA brand blue** (deep) — the primary accent |
| `--color-accent` | `var(--color-primary-dark)` | Selection actions, checked controls, focus |
| `--color-accent-bg` | `color-mix(… primary-dark 8%)` | Selected row background |
| `--color-accent-bg-hover` | `color-mix(… primary-dark 12%)` | Selected row hover |
| `--color-indigo` | `var(--color-primary-dark)` | Legacy alias — links, highlights (remapped) |
| `--color-purple` | `var(--color-primary-dark)` | Legacy alias — do **not** use for chart data |
| `--color-violet` | `#b899eb` | Chips, progress, **chart series only** |
| `--color-blue` | `#7dbbff` | Secondary blue, badges |
| `--color-mint` | `#6be6d3` | Chart accent |
| `--color-cyan` | `#a0bce8` | Chart accent |
| `--color-green` | `#71dd8c` | Success |
| `--color-pink` | `#ff90e8` | Accent |
| `--color-orange` | `#ffb55b` | Warning, numbers |
| `--color-yellow` | `#ffcc00` | Accent |
| `--color-red` | `#ff4747` | Error / danger |
| `--color-bg-page` | `#f5f5f7` | Page shell |
| `--color-bg-card` | `#f9f9fa` | Cards, inner panels |
| `--color-bg-tag` | `#e6f1fd` | Tag default fill |
| `--color-hover` | `rgba(0,0,0,0.04)` | Hover overlay |
| `--color-text-secondary` | `rgba(0,0,0,0.40)` | Muted text |
| `--color-text-placeholder` | `rgba(0,0,0,0.20)` | Placeholders |
| `--color-border-soft` | `rgba(0,0,0,0.10)` | Dividers |

Chart palette: `--chart-cyan` through `--chart-red` (10 colors). Dark dashboard scenes use `#333` background with white text (see `interactive-guidance-layout.css`).

### Typography

| Token | Size / Line-height | Weight |
|-------|-------------------|--------|
| `--text-size-12` / `--text-lh-12` | 12 / 16 | 400 |
| `--text-size-14` / `--text-lh-14` | 14 / 20 | 400, 600 |
| `--text-size-16` / `--text-lh-16` | 16 / 24 | 400 |
| `--text-size-18` / `--text-lh-18` | 18 / 28 | 400 |
| `--text-size-24` / `--text-lh-24` | 24 / 32 | 600 |
| `--text-size-48` / `--text-lh-48` | 48 / 56 | 400, 600 |
| `--text-size-64` / `--text-lh-64` | 64 / 72 | 600 |

- **Font:** Inter (`--font-family`)
- **Features:** `"ss01" 1, "cv01" 1` (`--font-features`)
- **Weights:** 400 regular, 600 semibold, 700 bold

### Spacing

`--space-2` (2px) through `--space-80` (80px). Common gaps: 4, 8, 12, 16, 20, 24, 28, 48, 80.

Dashboard layout gutters: **212px** sidebar, **280px** rightbar, **28px** content gap.

### Border Radius

`--radius-4` through `--radius-48`, plus `--radius-pill` (80px). Cards: 16–20px. Doc shells: 48px. Buttons: 12–20px by size.

### Effects

| Token | Value |
|-------|-------|
| `--shadow-pill` | `0 2px 4px rgba(0,0,0,0.10)` |
| `--shadow-popup` | `0 8px 28px rgba(0,0,0,0.10)` |
| `--shadow-glass-1` | `0 4px 16px rgba(0,0,0,0.04)` + blur 16px |
| `--shadow-glass-2` | `0 8px 28px rgba(0,0,0,0.10)` + blur 40px |
| `--blur-40` | `blur(40px)` — inputs, toasts, popups |

### Layout

| Token | Value |
|-------|-------|
| `--layout-scene-w` | 1440px |
| `--layout-scene-h` | 1024px |
| `--layout-mobile-w` | 393px |
| `--layout-content-max` | 1200px |

### Utility Classes (`theme.css`)

| Class | Purpose |
|-------|---------|
| `.tma-heading-gradient` | Gradient text for nav rail labels |
| `.tma-glass` | Frosted glass surface |
| `.tma-glass--tooltip` | Tooltip glass variant |

---

## Theme Configuration

`public/css/theme.css` maps tokens to component slots:

- `--btn-*` — Button sizes, radii, colors
- `--card-*` — Card background, chip colors
- `--input-*` — Input border, radius, placeholder
- `--tag-*` — Tag fill, close opacity
- `--tab-*` — Tab track, pill, segmented
- `--tooltip-*` — Tooltip sizing, arrow
- `--table-*` — Row hover, cell padding
- `--search-*` — Global search popup
- `--toast-*` — Toast blur, shadow
- `--badge-*` — Status colors
- `--chart-1` … `--chart-10` — Chart series
- `--pagination-*`, `--filter-*`, `--popover-*`

Override at page or section scope by redefining these variables — never hardcode hex values in new CSS.

---

## UI Components

All registered components live in `design/common-components.json`. Each has a `design/{slug}.json` preset with Figma node IDs, variants, and file paths.

### Primitives & Layout

| Component | Slug | CSS | JS | Demo | Variants |
|-----------|------|-----|----|----|----------|
| Text | `text` | `text.css` | `text.js`, `text-doc.js`, `text-instances.js` | `text-documentation.html`, `text-instances.html` | single, stack, inline, link, count |
| Frame | `frame` | `frame.css` | `frame-doc.js`, `frame-instances.js` | `frame-documentation.html`, `frame-instances.html` | message, settings, task, calendar, product |
| Group | `group` | `group.css` | `group-doc.js`, `group-instances.js` | `group-documentation.html`, `group-instances.html` | navigation, icon-text, segmented, pagination |
| Line | `line` | `line.css` | `line.js` | `line-documentation.html` | horizontal, pill, vertical |
| Strip | `strip` | `strip.css` | `strip.js` | `strip-documentation.html` | horizontal, progress, strength, bar |

### Actions

| Component | Slug | CSS | JS | Demo | Variants |
|-----------|------|-----|----|----|----------|
| Button | `button` | `button.css` | `button.js`, `button-doc.js`, `button-instances.js` | `button.html`, `button-documentation.html` | borderless, grey, outline, filled × sm/md/lg/xl |
| Button Group | `button-group` | `button-group.css` | `button-group-doc.js` | `button-group-documentation.html` | pagination, icon-toolbar, auth, navigation, social |

### Forms & Inputs

| Component | Slug | CSS | JS | Demo | Variants |
|-----------|------|-----|----|----|----------|
| Input | `input` | `input.css` | `input.js`, `forms-guidance.js`, `form-instances.js` | `forms.html`, `forms-guidance.html`, `form-instances.html` | 1-row, 2-row, textarea, select, command, tags |
| DatePicker | `date-picker` | `date-picker.css` | `date-picker.js`, `date-picker-guidance.js` | `date-picker-guidance.html`, `date-picker-form.html` | date-only, date-time, range, range-time |
| Tag | `tag` | `tag.css` | `tag.js` | `tag-documentation.html` | default, leftArrow, rightArrow |

### Feedback & Overlays

| Component | Slug | CSS | JS | Demo | Variants |
|-----------|------|-----|----|----|----------|
| Badge | `badge` | `badge.css` | `badge.js` | `badge.html`, `badge-documentation.html` | dot, number-indigo, number-red |
| Toast | `toast` | `toast.css` | `toast.js` | `toast-guidance.html` | successful/failure × big/small |
| Tooltip | `tooltip` | `components.css` | `tooltip.js` | `tooltip.html` | compact, button, multiline, rich, data |
| Popover | `popover` | `popover.css` | `popover.js`, `popover-guidance.js` | `popover-guidance.html`, `select-dropdown-demo.html` | options 1–8 (menus, property panels) |

**Alerts:** Use Toast (`toast.js`) for transient feedback. No separate alert component — reuse toast variants.

**Modals:** Table Add Data (`table-add-data.js`) implements modal pattern. Reuse its structure for new modals.

**Dropdowns:** Popover (`popover.js`) handles select dropdowns and context menus. See `select-dropdown-demo.html`.

### Navigation

| Component | Slug | CSS | JS | Demo | Variants |
|-----------|------|-----|----|----|----------|
| Tab Group | `tab-segmented` | `components.css` | `tab-group.js` | `tab-segmented.html` | underline, pill, segmented, solid, filled, icon |
| Global Search | `global-search` | `global-search.css` | `global-search.js` | `search-guidance.html` | compact, large, results, live |

### Data Display

| Component | Slug | CSS | JS / Blade | Demo |
|-----------|------|-----|------------|------|
| Card | `card` | `card.css` | `card.js` | `card-documentation.html`, `card-instances.html` |
| Table Title | `table-title` | `components.css` | `<x-table-title />` | `table-title.html` |
| Function Bar | `function-bar` | `function-bar.css` | `<x-function-bar />` | `function-bar.html` |
| Pagination | `pagination` | `pagination.css` | `<x-pagination />` | `pagination.html` |
| Filter and Sort | `filter-and-sort` | `filter-and-sort.css` | `<x-filter-and-sort />` | `filter-and-sort.html` |
| Status Badge | `status-badge` | `status-badge.css` | `<x-status-badge />` | `status-badge.html` |
| Table A | `table-a` | `table-a.css` | `<x-table-a />` | `table-a.html` |
| Table B | `table-b` | `table-b.css` | `table-b.js`, `<x-table-b />` | `table-b.html`, `table-b-guidance.html` |
| Table B Sessions | `table-b-sessions` | `table-b-sessions.css` | `table-b.js` | (embedded in guidance) |
| Table C | `table-c` | `table-c.css` | `table-c.js`, `<x-table-c />` | `table-c.html` |
| Table Search | `table-search` | `table-search.css` | `table-search.js` | `table-search-guidance.html` |
| Table Add Data | `table-add-data` | `table-add-data.css` | `table-add-data.js` | `table-add-data-guidance.html` |
| Table Filter Sort | `table-filter-sort` | `table-filter-sort.css` | `table-filter-sort.js` | `table-filter-sort-guidance.html` |

Shared table primitives: `public/css/table.css`

### Charts

**Catalog:** `design/charts.json` + 26 individual presets (`vertical-01` … `donut-05`, `chart-motion-01` … `03`, etc.)

| Asset | Path |
|-------|------|
| CSS | `public/css/charts.css` |
| JS | `public/js/chart-motion.js`, `public/js/tma-charts.js` |
| SVG exports | `public/images/charts/` (26 files) |
| Blade | `<x-chart />`, `<x-chart-vertical-01 />`, etc. (26 variants) |
| Demo hub | `public/demo/charts.html` |

Chart colors: `--chart-cyan`, `--chart-mint`, `--chart-blue`, `--chart-purple`, `--chart-green`, etc.

### Avatars & User Chips

| Asset | Path |
|-------|------|
| Catalog | `design/avatars.json`, `design/avatar-names.json` |
| Usage guide | `design/avatar-usage.md` |
| PNGs | `public/images/avatars/` (24 avatars, e.g. `AvatarByewind.png`) |
| Blade | `<x-avatar />`, `<x-user-chip />` |
| PHP helper | `app/Support/Avatars.php` |
| Demo | `public/demo/avatars.html` |

---

## Shared Layouts

### Dashboard Layout (Three / Two / One Column)

| Variant | Sidebar | Main | Rightbar | Spec |
|---------|---------|------|----------|------|
| Three columns | 212px | flex | 280px | `interactive-guidance-layout.js` |
| Two columns | 212px | full width | hidden | `.ig-layout__scene--two` |
| One column | hidden | full width | hidden | `.ig-layout__scene--one` |

**Renderer:** `TMAGlobalSearch.renderOverview({ theme: 'dark', variant: 'layout' })`  
**CSS:** `public/css/interactive-guidance-layout.css`, `public/css/global-search.css`  
**Demo:** `public/demo/interactive-guidance.html` (Dashboard row → Layout panel)

Dashboard scene includes: header bar, sidebar nav, metric cards, charts, notifications, activities, contacts.

### Navigation Patterns

| Pattern | Implementation |
|---------|----------------|
| Sidebar nav | `tma-overview__sidebar` — brand, favorites, dashboard groups |
| Header bar | Breadcrumb + icon group + search pill + actions |
| Rightbar | Notifications, Activities, Contacts panels |
| Doc hero/footer | `TMAInteractiveGuidanceDoc.renderDocHero/Footer()` |
| Nav rails | `.ig-nav` gradient labels (Shared / Dashboard / Table) |
| Tab navigation | `TMATabGroup` / `<x-tab-group variant="underline\|pill\|segmented" />` |
| Breadcrumb | `.ig-header__breadcrumb`, `.tma-overview__breadcrumb` |

### Documentation Shell (`.ig-doc`)

Used across interactive guidance panels:

```
.ig-doc → .ig-doc__hero → .ig-doc__section → .ig-doc__heading → .ig-doc__body → .ig-doc__footer
```

Builder: `public/js/interactive-guidance-doc.js`

### Responsive Behavior

- Board canvases scroll horizontally on desktop; stack into responsive nav on narrow viewports.
- Dashboard breakpoints documented in Layout panel (one column under ~1200px content width).
- Component demos use `max-width` + `overflow: auto` on board wrappers.
- Tabs and button groups use `flex-wrap` for narrow containers.

---

## Assets

### Icons

| Set | Count | Path | Catalog |
|-----|-------|------|---------|
| TMA custom | ~110 | `public/images/icons/tma/` | `design/icons-tma.json` |
| Phosphor Regular | ~1248 | `public/images/icons/phosphor/` | `design/icons-phosphor.json` |
| Brand logos | 23 | `public/images/icons/brands/` | Filenames listed below |
| Social (footer) | 7 | `public/images/icons/tma/*Social.svg` | Used in `ig-doc__footer` |

#### Mandatory rule — use local asset files only

**Never invent, redraw, or hand-code SVG for brand logos or icons when a file already exists in this repo.**

| Asset type | Required approach | Forbidden |
|------------|-------------------|-----------|
| **Brand / product logos** (SnowUI, Copilot, Figma, Slack, …) | `<img src="images/icons/brands/{Name}40.svg">` or `TMACard.brandLogoSrc('SnowLogo')` | Inline SVG in `*-icons.js`, placeholder shapes, emoji, or “similar-looking” glyphs |
| **UI icons** (Folder, User, List, Arrow, …) | `<img src="images/icons/phosphor/{Name}.svg">` or `<img src="images/icons/tma/{Name}.svg">` | New inline paths in JS unless no file exists |
| **TMA app logo** (sidebar) | `public/js/tma-logo.js` → `TMALogo.renderTMALogo()` + PNGs in `public/images/brand/tma/` | Random “TMA” lettermarks |

**Before adding any icon or logo:**

1. List `public/images/icons/brands/`, `phosphor/`, or `tma/` and pick an **exact filename**.
2. Grep the codebase for existing usage (`iconPath:`, `brandLogoSrc`, `images/icons/`).
3. Match demo data in `public/js/frame-instances.js` and `card-instances.js` (e.g. `logoIcon: 'Copilot'` → `Copilot40.svg`).

**Brand logo files** (`public/images/icons/brands/`):

`Behance40`, `ChatGPT40`, `ChatGPT24`, `Claude24`, `Copilot40`, `DeepSeek24`, `Dribbble40`, `Dropbox40`, `Figma40`, `Github40`, `Gumroad40`, `LemonSqueezy40`, `Loop40`, `Messenger40`, `Ollama24`, `PayPal40`, `Perplexity24`, `PriorityMedium40`, `Slack40`, `Slack24`, `SnowLogo40`, `XLogo24`, `Youtube24`

**Aliases:** `Medium` / `Medium40` → `PriorityMedium40` (see `BRAND_LOGO_ALIASES` in `public/js/card.js`).

**Card / Projects pattern:**

```js
// Progress card brand logo — always via TMACard (loads local SVG file)
TMACard.renderProgressCard({ logoIcon: 'Figma', ... });

// List row logo
TMACard.brandLogoSrc('Github'); // → images/icons/brands/Github40.svg
```

**Icon JS registries** (`*-icons.js`): legacy inline SVG for demos and a few UI glyphs (e.g. chip status dot). **Do not** add brand logos to these registries. Prefer file-based `<img>` for anything that exists under `public/images/icons/`.

#### Mandatory rule — no SnowUI branding in the live application

**The tma-portal application (`public/index.html` and its view modules) must never display SnowUI product branding.**

| Forbidden in the app | Required instead |
|----------------------|------------------|
| Text **"SnowUI"** (titles, breadcrumbs, project names, copy) | Neutral names — e.g. **"Overview"**, **"Advisory Portal"**, **"Project Overview"** |
| **`SnowLogo40.svg`** / **`SnowLogo`** in nav, hero cards, or project cards | Phosphor UI icons in sidebar nav; other brand logos from `icons/brands/` for third-party project cards (Figma, Slack, …) |
| SnowUI wordmarks or sidebar footer logos | **TMA** identity only — `TMALogo.renderTMALogo()` + `images/brand/tma/` |

**Overview hero card (`/overview`):** metrics row only (Status, Total Tasks, Due Date, Budget Spent) + avatar group — **no** project title row and **no** logo above the metrics.

**Breadcrumb for project Overview:** `Dashboard / Overview` — not `… / SnowUI`.

Component demos under `public/demo/` and Figma-derived frame docs may still reference SnowUI assets for catalog purposes; the **live app shell and its views do not**.

**Set selection:** TMA icons for TMA-specific glyphs (Sidebar, Rightbar, Checkbox, Search-16). Phosphor for general UI (User, Bell, Folder, Star).

### Brand Logos (app identity)

| Asset | Path | JS helper |
|-------|------|-----------|
| Horizontal logo | `public/images/brand/tma/tma-logo-horizontal.png` | Sidebar expanded, headers |
| Logo mark | `public/images/brand/tma/tma-logo-mark.png` | Sidebar collapsed, favicon |
| Favicon | `public/images/brand/tma/favicon.png` | Browser tab icon |
| Renderer | `public/js/tma-logo.js` | `TMALogo.renderTMALogo()` |
| Cover logo 120px | `TMALogo.renderCoverLogo120()` | Design system cover card |

### Illustrations

28 illustrations + 3 line drawings in `public/images/illustrations/`. Catalog: `design/illustrations.json`. Figma frame: `30485:160085`.

### Emojis

22 Fluent Emoji SVGs in `public/images/emoji/`. Catalog: `design/emoji.json`. Figma frame: `30485:158234`.

### Cursors

21 custom cursors. Catalog: `design/cursors.json`. CSS: `public/css/cursors.css` (generated by `scripts/build_cursor_catalog.py`). PNGs: `public/images/cursors/`.

### Charts

26 chart SVGs in `public/images/charts/`. See Charts section above.

---

## Interaction Patterns

| Pattern | Where documented | Key behavior |
|---------|------------------|--------------|
| Component states | `interactive-guidance-component-state.js` | Default, Hover, Disabled, Focus, Error, Active matrices |
| Form validation | `forms-guidance.js` | Error pushes content down; messages below field |
| Popover menus | `popover-guidance.js` | Property vs basic interaction groups |
| Table row selection | `table-c.js` | Checkbox, hover, selected-start/end |
| Table list/grid toggle | `table-view-toggle.js` + `dashboard.css` | Shared header toggle for all `data-table-view` pages; register per page |
| Table add data modal | `table-add-data.js` | × auto-saves draft; Cancel clears; Save stages |
| Global search | `global-search.js` | `/` opens; highlight matches; recent/visited/contacts |
| Toast auto-dismiss | `toast.js` | Scene overlay on dashboard; timed visibility |
| Date picker | `date-picker-guidance.js` | Range, time, preset chips |
| Tab keyboard | `tab-group.js` | Arrow keys switch tabs |
| Scrollbar | Component state panel | Hidden by default; appears on hover scroll |

---

## Laravel / Blade Layer

### Setup

```blade
@include('partials.components')   {{-- tabs, tooltips, tables --}}
@include('partials.charts')       {{-- chart components --}}
@include('partials.cursors')     {{-- cursor CSS vars --}}
```

### Blade Components (`resources/views/components/`)

`<x-tab-group />`, `<x-tooltip />`, `<x-table-a />`, `<x-table-b />`, `<x-table-c />`, `<x-pagination />`, `<x-filter-and-sort />`, `<x-function-bar />`, `<x-status-badge />`, `<x-avatar />`, `<x-user-chip />`, `<x-chart-* />` (26 chart variants)

### PHP Support Classes (`app/Support/`)

Each loads its `design/{slug}.json` and exposes `catalog()`, preset data, and asset URLs: `TabGroup`, `TableA`–`TableC`, `TableSearch`, `TableAddData`, `TableFilterSort`, `Pagination`, `FilterAndSort`, `FunctionBar`, `StatusBadge`, `Tooltip`, `GlobalSearch`, `Charts`, `ChartMotion`, `ChartGraphic`, `Avatars`, `Cursors`.

---

## Page Catalogs & Guidance Boards

### Design System Overview

- **Demo:** `public/demo/design-system.html`
- **Spec:** `design/design-system.json` (Figma `15098:130290`)
- **JS:** `design-system-page.js`

### Components Catalog

- **Demo:** `public/demo/components.html`
- **Spec:** `design/components.json` (Figma `33320:6937`)

### Interactive Guidance (master board)

- **Demo:** `public/demo/interactive-guidance.html`
- **Spec:** `design/interactive-guidance.json` (Figma `12779:273712`)
- **Rows:** Shared, Dashboard, Table
- **Dashboard panels:** Layout, Block, Sidebar, Rightbar, Header

### Application — Default Dashboard (Overview)

- **App entry:** `public/index.html` (the application home, not a demo)
- **Spec:** `design/dashboard.json` (Figma [`32546:96118`](https://www.figma.com/design/58ZXC7sZYQsbenzf0foWCH/Portal-Design?node-id=32546-96118))
- **CSS:** `public/css/dashboard.css` (prefix `tma-dash-*`, overview block `tma-dash__overview-*`)
- **JS:** `public/js/dashboard.js` — `window.TMADashboard.mount(root)`; `public/js/overview.js` — `window.TMAOverview.mount(container)`
- **Layout:** three columns — 212px sidebar / flex main / 280px rightbar, 28px content gap
- **Sections (Overview, Figma `32546:96118`):** underline tab bar + actions, project hero (status strip / tasks / due date / budget / avatars — **no SnowUI title or logo**), What's on the road timeline, Latest Files, Project Spendings table, footer, rightbar (Notifications / Activities / Contacts)
- **Icons:** local files only — `icons/phosphor/FilePdf.svg`, `FileJpg.svg`, `FileXls.svg`, `Plus.svg`, `DownloadSimple.svg`, `ChartPieSlice.svg` (Overview nav), `icons/tma/ThreeDots-16.svg`
- **Interactions:** nav active-state + breadcrumb/title sync, expandable page groups, Favorites/Recently toggle, sidebar collapses to a **72px icon-only rail** on desktop / rightbar drawer on mobile, light/dark theme, `/` command palette — state persisted in `localStorage`
- **Views:** the app shell hosts multiple views (`.tma-dash__view[data-view]`). **Dashboard** (`dashboard`, Figma `32546:96097`) — metric cards, donut, tasks table, bar chart at `/`. **Overview** (`overview`, Figma `32546:96118`) — project detail at `/overview`. Also: `projects`, `clients`, `users`.
- **Responsive:** three columns → rightbar drawer ≤1024px → single column ≤1024px with **bottom TabBar + iOS-style "Home" menu** (Figma `32548:116275`: House / History / Bell / Gear / Avatar tabs, Favorites + Dashboards grouped cards) → phone tuning ≤560px

### Data table pages (Clients, Users, Projects, …)

All list/grid data pages share one shell pattern. **Do not** add a separate tab-group or custom toggle — reuse what Clients and Users already use.

| Piece | Location | Notes |
|-------|----------|-------|
| View container | `.tma-dash__view[data-view="…"]` | Add **`data-table-view`** so the header toggle shows |
| Grid variant (optional) | `data-table-grid="avatar"` on view | Users only — avatar mosaic grid instead of card grid |
| Page title row | `.tma-dash__main-head` in `index.html` | Title left; **`data-page-view-toggle`** right (shared, one instance) |
| List/grid toggle | `[data-page-view-toggle]` + `.tma-dash__view-toggle` | Icons: **`ListDashes`** (list), **`SquaresFour`** (grid). Active = `--color-overlay-4` fill, 16×16 icons — **not** the filled black pill from `tab-segmented` |
| Toggle controller | `public/js/table-view-toggle.js` | `window.TMATableViewToggle` |
| Page module | `public/js/{page}.js` | On mount, **`register(viewId, { getViewMode, setViewMode, render })`** |
| View modes | `'list'` \| `'grid'` | Persist in `localStorage` per page. Default: Clients/Users = `list`; Projects = `grid` |

**Register pattern (required for every data-table page):**

```javascript
window.TMATableViewToggle.register('projects', {
  getViewMode: function () { return state.viewMode; }, // 'list' | 'grid'
  setViewMode: function (mode) { state.viewMode = mode; saveViewMode(); },
  render: render,
});
```

After each `render()`, call `TMATableViewToggle.sync('projects')` so the header buttons match.

**Projects-specific:** card grid uses `TMACard.renderStatCard()` + `TMACard.renderProgressCard()` (`card.js`, `card.css`). Brand logos load from `public/images/icons/brands/` via `TMACard.brandLogoSrc()` — **not** `card-icons.js`. Demo references: `public/demo/card-documentation.html`, `card-instances.html`.

**Clients / Users:** toolbar (add, filter, sort, search), filter bar, table or grid body, pagination — see `clients.js`, `users.js`.

**Adding a new table page checklist:**

1. `[data-view="foo"]` + `data-table-view` on the view block in `index.html`
2. Nav item with `data-view="foo"` and route in `dashboard.js`
3. Page JS: mount, render, register with `TMATableViewToggle`
4. Do **not** duplicate `[data-page-view-toggle]` markup — it is shared in the main head
5. Do **not** use `PortalTabGroup` / `tma-tab-group--filled` for list/grid — that is for content tabs, not view mode

### Client portal pages (Dashboard home, Folders, Projects, Workflows, Templates, Signatures, Inbox, People, Account settings)

The app shell's primary navigation mirrors the client-portal feature set replicated from the ShareFile trial-environment brief (see `sharefile_replication_batch1–4.pdf`). All functionality is client-side, backed by a shared localStorage store.

| Piece | Location | Notes |
|-------|----------|-------|
| Shared data store | `public/js/portal-data.js` | `window.TMAPortalData` — seed data + persistence (`tma.portal.v1`); business constants: deleted-project retention **45 days**, File Box retention **180 days**, trial limits (3 employees, 5 signature requests) |
| View dispatcher + UI helpers | `public/js/portal-views.js` | `window.TMAPortalViews.register(view, mountFn)` + `window.TMAPortalUI` (buttons reuse the no-data CTA recipe, toggle reuses `tma-dash__settings-switch`, tabs reuse `tma-tab-group--underline`, modals reuse `tma-dash__settings-change-card` chrome, toasts via `TMAToast`) |
| Page modules | `public/js/portal-{home,projects,folders,work,people,admin}.js` | One module per area; mounted into `.tma-dash__view [data-portal-mount]` on `activate()`. (`portal-inbox.js` exists on disk but is not loaded — the sidebar uses the original Email client instead.) |
| Page CSS | `public/css/portal.css` | `tma-portal-*` classes; tokens/theme variables only — no new palettes |
| Routing | `dashboard.js` | Generic fallback: any sidebar leaf's `href` deep-links (e.g. `/projects/all`, `/people/employees`, `/account-settings`); no per-route hardcoding needed for portal views |

**Account settings (admin) area** uses a two-pane shell (`.tma-portal-admin`) with expandable secondary nav mirroring the brief: Admin Overview, Background Operations, Account and Reporting, Billing, Client hub management, Security (8 pages), Connectors, Connection Manager, Storage, Advanced Preferences (8 pages). Deep-open a page via `TMAPortalAdmin.setPage(id)` or `TMADashboard.navigate({ …, adminPage: id })`.

**Sidebar (current)** — two labeled groups like the classic shell:
- **Dashboards:** Dashboard, Overview (original project overview), Client hub (**original Clients pages** — `clients.js`, label kept "Client hub"), Email (original mail client, not the portal Inbox), Messages, Feed, Calendar, Users (original page)
- **Pages:** Folders, Projects, Workflows, Templates, Signatures, People, Account settings
- Bottom: **Classic design** link

There is no trial banner strip. The Dashboard view hides the main-head title row (the greeting is its header; Recent Files/Shortcuts panels stretch to equal height) and includes the Overview "What's on the road?" timeline via `TMAOverview.renderRoad()`. Remaining legacy views (My Projects, Account, Settings) are URL-reachable but not in the sidebar.

**Classic design** — the pre-replication shell is preserved at **`/classic`** (`public/classic/index.html`): original sidebar (Dashboards / Pages groups), metrics dashboard, and script set. It sets `window.TMA_CLASSIC = true`, which makes the shared `dashboard.js` skip URL sync (navigation stays at `/classic`), point the mobile header logo at `/classic`, and keep the classic dashboard's title row + Today selector. It links back to the new design ("New design" item); the new shell links to it ("Classic design" item).

### Calendar page

Frontend-only calendar at `/calendar` (`public/js/calendar.js`, mount target `[data-calendar]`). **Reuse existing Contacts / Pricing / Tab Group patterns — do not add parallel calendar-specific UI primitives.**

| Piece | Reuse (required) | Do **not** create |
|-------|------------------|-------------------|
| View switcher (Week / Month / Agenda) | `tma-tab-group tma-tab-group--segmented` + `PortalTabGroup` (`tab-group.js`) — same markup as `pricing.js` billing toggle | Custom `.tma-dash__calendar-view-toggle` / `-view-btn` |
| New event action | `tma-dash__contacts-add-btn` (Contacts sidebar add button) with toolbar width override | Custom `.tma-dash__calendar-new-btn` |
| Week grid | `TMASchedule.render()` (`schedule.js`) + `.tma-dash__contacts-schedule-*` / `.tma-dash__contacts-event-*` | Custom week grid or event card styles |
| Month grid | `TMADatePicker.buildCalendarGrid()` (`date-picker.js`) + calendar month cell classes in `dashboard.css` | Custom month picker from scratch |
| Schedule nav (prev / next / today) | `.tma-dash__contacts-schedule-nav`, `.tma-dash__contacts-icon-btn`, `.tma-dash__contacts-today-btn` | Custom nav buttons |
| Event form / panel fields | `.tma-dash__contacts-form-*`, `.tma-dash__contacts-icon-btn` | Custom form field wrappers |
| Transient feedback | `toast.js` + `toast.css` — `TMAToast.showFloatingToast()` | Custom `.tma-dash__calendar-toast` or ad-hoc toast markup |

**Scripts:** `date-picker.js`, `schedule.js`, `tab-group.js`, `calendar.js` (see `public/calendar/index.html` / app shell).

**Figma reference:** Contacts profile schedule — “His schedule” (`32546:96130` in Portal-Design).

**Responsive (Rule 9):** Week view uses `.tma-dash__contacts-schedule-scroll` for vertical + horizontal scroll on narrow viewports; do not clip columns — scroll instead.

---

### Full Demo Index (`public/demo/`)

| Category | Pages |
|----------|-------|
| Overview | `design-system.html`, `components.html`, `interactive-guidance.html`, `charts.html`, `icons.html`, `avatars.html`, `cursors.html` |

> **Note:** The Dashboard is the live application at `public/index.html` (not under `public/demo/`).
| Documentation + instances | `*-documentation.html` + `*-instances.html` pairs for Text, Frame, Group, Button, Card, Input |
| Guidance boards | `forms-guidance.html`, `popover-guidance.html`, `date-picker-guidance.html`, `search-guidance.html`, `toast-guidance.html`, `table-*-guidance.html` |
| Component demos | `button.html`, `tab-segmented.html`, `tooltip.html`, `badge.html`, `filter-and-sort.html`, `pagination.html`, etc. |
| Charts | `vertical-01.html` … `vertical-12.html`, `horizontal-01.html` … `04.html`, `donut-01.html` … `05.html`, `chart-motion-01.html` … `03.html`, `semicircle-chart.html`, `proportion-statistics.html` |

---

## Figma Reference

Node ID format in JSON: `"30484:299256"`. URL format: `node-id=30484-299256`.

Key entry points (full list in `design/figma.json`):

| Area | Node ID |
|------|---------|
| Design system page | `15098:130290` |
| Components catalog | `33320:6937` |
| Interactive guidance | `12779:273712` |
| Layout panel | `30484:299256` |
| Button set | `33311:3641` |
| Tab, Segmented | `28002:98904` |
| Popover canvas | `28002:96385` |
| Chart graphics | `30485:135130` |
| TMA icons | `32730:413847` |
| Phosphor icons | `32730:413932` |
| Avatars | `30485:156827` |
| Illustrations | `30485:160085` |
| Emoji | `30485:158234` |
| Cursors | `32261:178336` |

**Design-to-code workflow:** Use Figma MCP `get_design_context` with `fileKey: 58ZXC7sZYQsbenzf0foWCH`. Adapt React+Tailwind reference output to this project's vanilla JS + CSS + Blade conventions. Never install Tailwind.

### Settings popups (dashboard)

Figma **Settings** flows (Payment, Change email, 2-step verification, etc.) often show a full-page frame with `SettingsPopoverTitle` — large title plus back and close buttons **outside** the white card. In the live app, all settings modals share one chrome pattern:

| Rule | Implementation |
|------|----------------|
| **One dismiss control** | Top-right **close only** via `renderPopupClose()` → `.tma-dash__settings-change-close` |
| **No outer title row** | Do not render Figma's external title/back/close row; it bleeds over the settings panel behind the modal |
| **Title inside card** | Use `.tma-dash__settings-change-title` inside `.tma-dash__settings-change-card` |
| **Close padding** | Add the card modifier to the `--settings-close-reserve` group in `dashboard.css` so content clears the X |
| **Multi-step flows** | Step content lives inside the card; optional in-card text **Back** link (`data-payment-back`) — never a second chrome button beside close |

Reference: `public/js/settings.js` (`renderAddPaymentMethodPopup`, `renderChangeEmailPopup`, `renderTwoStepPopup`).

---

## Adding New Work — Checklist

- [ ] Searched `design/common-components.json` and `public/demo/` for existing component
- [ ] Reused `tokens.css` / `theme.css` variables (no new hex values)
- [ ] Reused existing icons from `public/images/icons/` (**brand logos → `icons/brands/` only; no inline SVG substitutes**)
- [ ] Matched class prefix convention (`tma-*`)
- [ ] Settings popups: close button only in chrome (`renderPopupClose`); title inside `.tma-dash__settings-change-card` (see **Settings popups** above)
- [ ] Added `design/{slug}.json` preset with Figma `nodeId`
- [ ] Registered in `design/common-components.json` if production component
- [ ] Created demo page in `public/demo/`
- [ ] Updated this `DESIGN_SYSTEM.md`

---

## Maintenance Log

| Date | Change |
|------|--------|
| 2026-06-14 | Initial comprehensive document created from codebase analysis |
| 2026-06-14 | Dashboard Layout panel: three/two/one column responsive scenes (`interactive-guidance-layout.js`) |
| 2026-06-14 | Default Dashboard page built from Figma `32546:96098` (`public/demo/dashboard.html`, `public/css/dashboard.css`, `design/dashboard.json`) — reuses tokens, icons, avatars; charts built in code |
| 2026-06-14 | Repaired malformed icon assets (unclosed `<g>`): `icons/tma/ArrowRise.svg`, `ArrowFall.svg`, `Rightbar.svg` — fixes broken rendering project-wide |
| 2026-06-14 | Promoted Dashboard from demo to application: moved to `public/index.html`, added interactive controller `public/js/dashboard.js` (nav, theme, search, drawers, persistence) + responsive off-canvas drawers; removed `public/demo/dashboard.html` |
| 2026-06-14 | Mobile: bottom TabBar + iOS-style "Home" menu from Figma `32548:116275`; repaired malformed emoji assets (unbalanced `<g>`): `emoji/RobotEmoji.svg`, `GrinningCat.svg`, `SmilingFaceHearts.svg` |
| 2026-06-14 | Chart hover tooltips: reused TMA tooltip component (`components.css` + `tooltip.js`) for bar values (Device + Marketing) — the only allowed chart hover affordance |
| 2026-06-14 | Added **Rule 8 — Hover States Are Restricted**. Removed prohibited hover effects (card lift/translate, panel shadow, bar dim); hover elevation on cards/panels/charts is not permitted |
| 2026-06-14 | **Icons/assets rule:** brand logos and UI icons must use files in `public/images/icons/` — never hand-coded inline SVG substitutes; `TMACard.brandLogoSrc()` + local `<img>` for Projects/cards; `DESIGN_SYSTEM.md` updated |
| 2026-06-14 | Collapsed sidebar now shows an icon-only rail (72px) instead of hiding; equal-height panel row + Tasks Overview pinned to its own full-width row |
| 2026-06-14 | Added **Clients** page (Figma `32546:96123` Order List): multi-view shell (`.tma-dash__view`), toolbar, selectable data table, pagination; new sidebar + mobile-menu nav item |
| 2026-06-15 | Added **Projects** page (Figma `32546:96122`): `TMACard` stat/progress cards, list/grid via shared `TMATableViewToggle` |
| 2026-06-15 | **Overview page** rebuilt to Figma `32546:96118`: tab bar, project hero (metrics + avatars only), timeline, files, spendings table; `public/js/overview.js` + `TMAOverview.mount()` |
| 2026-06-15 | **No SnowUI branding in live app** — removed SnowUI title/logo from Overview hero; breadcrumbs and Projects sample data updated; rule documented in `DESIGN_SYSTEM.md` |
| 2026-06-23 | **Settings popup chrome** — Payment (and all settings modals) use in-card title + single close button only; documented Figma vs app divergence for `SettingsPopoverTitle` frames |
| 2026-06-22 | **Rule 9 — Responsive layout, cards, and text** — general app-wide rules: surface inset, fluid scaling, card grids stay side-by-side until min breakpoint, main vs compact truncation, mobile footer scrolls with content |
| 2026-06-27 | **Calendar page reuse map** — documented required components (Tab Group segmented, Contacts schedule/add btn, `toast.js` floating toast); mandatory read-before-code notice for AI agents |
| 2026-07-06 | **Client portal replication** — sidebar rebuilt to the ShareFile-brief structure (Dashboard, Client hub, Folders, Projects, Workflows, Templates, Signatures, Inbox, People, Account settings); ~35 functional pages added via `portal-*.js` modules + `portal.css`; shared localStorage store (`portal-data.js`); generic leaf-href routing fallback in `dashboard.js`; trial banner; legacy views kept URL-reachable |
| 2026-07-06 | **Nav revision per client feedback** — removed the trial banner strip; portal Inbox replaced by the original **Email** client in the sidebar (`portal-inbox.js` unloaded); **Messages** and **Feed** restored as sidebar items |
| 2026-07-07 | **Classic design preserved** — previous shell restored at `/classic` (`public/classic/index.html`, `window.TMA_CLASSIC` mode in `dashboard.js`); two-way links between designs; removed redundant "Dashboard" title row on the new portal home |
| 2026-07-07 | **Primary accent = TMA brand blue** — `--color-indigo` remapped to `var(--color-primary-dark)` (`#136da0`); accent picker "indigo" swatch updated in `dashboard.js`; rule documented under Design Tokens › Colors. Purple/indigo must not be used for primary accents |
| 2026-07-07 | **Global accent sweep** — `--color-purple` remapped to brand blue; added `--color-accent`, `--color-accent-bg`, `--color-accent-bg-hover`; replaced hardcoded `#9747ff` in component CSS; portal selection toolbar + table checkboxes use brand blue |

---

*TM ANTOINE Advisory Design System — tma-portal. Figma file `58ZXC7sZYQsbenzf0foWCH`. Documentation at [tma-portal](#).*
