# Source Map — `THE WEBSITE.html`

One-time structural map of `../Gary's Website/THE WEBSITE.html` (9,503 lines). Every page-port prompt should reference this. Line ranges are inclusive.

Top-level shape:
- `<head>`: lines `3`–`5456` (the giant inline `<style>` block runs `34`–`5426`)
- `<body>`: lines `5457`–`9501`
- 3 `<script>` blocks total

---

## 1. Routes

The original is a **single-page app, hash-routed**. There is no `data-route` attribute — instead, every desktop route is a `<section class="page page-{slug}">` inside `<div class="pages" id="pages">`, and a JS router toggles a single `.active` class on the matching section in response to `location.hash` changes.

Mobile renders a parallel set of `<section class="mob-section" id="m-{slug}">` blocks inside a separate mobile shell. The same hash drives both via the JS router.

The router lives inside script block B (see §3); the `replaceState`-based `navigateTo()` and `hashchange` listener are at lines `7172` and `7214` respectively. Sidenav link list (canonical slug source) is at lines `5497`–`5507`.

### Desktop section blocks (`<section class="page page-…">`)

| Slug (`location.hash`) | Display label | Lines | Purpose |
|---|---|---|---|
| `#home` | Home | `5518`–`5533` | Wordmark + area-pill conveyor — the leaf-clicking playground |
| `#about` | About | `5536`–`5561` | Gary cut-out + about copy |
| `#services` | Services | `5564`–`5636` | Two service groups (lawn/pruning etc.) |
| `#latelier` | Vision & Quote | `5639`–`5700` | "L'Atelier" — vision form, photo upload, success receipt |
| `#contact` | Contact | `5703`–`5788` | Phone / email / Instagram + contact form |
| `#gardens` | Testimonial Gardens | `5791`–`5840` | Grid of road tiles (Castelnau, Lonsdale Road, …) |
| `#blog` | What's Growing | `5843`–`5858` | Post grid + lens-blur popup |
| `#podcast` | Podcast | `5861`–`5873` | Email-capture for the podcast |
| `#shop` | Gary's Kit Shop | `5876`–`6030` | Three views — landing / brand-detail / type-detail |
| `#case` | (sub-route, not in nav) | `6035`–`6080` | Case-study detail with before/after slider; opened from a `.gardens-tile` or `.map-case-box` |

### Mobile section blocks (`<section class="mob-…" id="m-…">`)

Each maps 1:1 onto a desktop slug (or a sub-state of one). The mobile router strips the `m-` prefix when reading the hash.

| Slug | Lines | Notes |
|---|---|---|
| `#m-home` (`mob-hero`) | `6246`–`6251` | |
| `#m-generator` | `6253`–`6282` | Mobile-only condensed version of `#latelier` |
| `#m-about` | `6284`–`6295` | |
| `#m-services` | `6297`–`6363` | Includes service-popup overlay markup |
| `#m-contact` | `6365`–`6397` | |
| `#m-gardens` | `6399`–`6447` | |
| `#m-blog` | `6449`–`6463` | |
| `#m-podcast` | `6465`–`6476` | |
| `#m-shop` | `6478`–`6612` | |

### Other shell / chrome markup (not a route, but ports with the layout)

| Block | Lines | Purpose |
|---|---|---|
| Hidden leaf-source `<img>` tags | `5463`–`5466` | Decode targets for the leaf canvas |
| `<canvas id="leafCanvas">` | `5471` (≈) | Leaf-physics layer |
| Custom cursor (`cursor-ring`, `cursor-dot`) | `5474`–`5475` | |
| `.viewport` / `.stage-shell` / `.stage` | `5480`–`5482` (open) | Fixed 1440×900 desktop canvas |
| Top-left wordmark logo | `5489`–`5491` | Above the sidenav |
| `<nav class="sidenav">` | `5497`–`5507` | Desktop primary nav (canonical slug list) |
| `.stage-footer` + `#pageIndicator` | `5509`–`5513` | Footer copyright + "01 / Home →" indicator |
| `<div class="pages" id="pages">` | `5515`–`6082` | Wrapper for all 10 desktop sections |
| `.loader` | `6085`–`6111` (≈) | Bulb-to-flower transition loader |
| Mobile menu toggle / backdrop / overlay | `6114`–`6244` (≈) | Hamburger + cream overlay menu + accordion |

### Discrepancies / dead references — flag for the porting work

- **`#map`** — the JS treats `#map` as a real route (`hashchange` handler at `7471`, `mapBack`/`resetMap` at `7468`) and there is a `.page-map .page-inner` rule at line `2361`, **but no `<section id="map">` exists in the markup**. `mapBack` is also `getElementById`-ed but never present. Conclusion: legacy / WIP — there is no working map page in the current DOM. The "map" experience has been folded into `#gardens` (a tile grid) and the case-study deep-link via `data-road`.
- The hash-router and the `.active`-class swap **will not survive the port** — Astro's file-routing replaces it. Each section becomes a route file.

---

## 2. CSS — per-route line ranges

The single inline `<style>` runs `34`–`5426`. Tokens + reset (`35`–`101`) are excluded — already in `src/styles/global.css`.

### Shared / chrome (apply across all or most routes)

| Block | Lines | Notes |
|---|---|---|
| Fixed canvas / stage (`.viewport`, `.stage`, `.stage-shell`) | `103`–`110` | |
| Persistent UI: logo, sidenav, begin button | `111`–`225` | Desktop nav chrome |
| Page indicator (`#pageIndicator`) | `226`–`268` | |
| Page system (`.pages`, `.page`, `.page-inner` base, `.fade-in` base) | `269`–`339` | The base `.page` rules every route inherits |
| Sidenav menu rule + display-heading flourish | `579`–`674` | Used by sidenav and headings — multi-route |
| `prefers-reduced-motion` (global) | `1746`–`2006` | Wraps many per-component rules |
| Bulb-loader cascade (`.loader`, layer flash) | `2660`–`2691` | Loader for every nav transition |
| Atmospheric paper layers + global polish | `5081`–`5374` | Type smoothing, selection, in-prose link underline, fade-in animation, atmospheric overlays |
| Universal reduced-motion safety net | `5375`–`5400` | |

### Desktop per-route blocks

| Route | Lines | Notes |
|---|---|---|
| `#home` | `340`–`462` | `.page-home` overrides + `.wordmark` + `.conveyor` belt |
| `#about` | `464`–`578` | `.page-about` + about-text + Gary cut-out |
| `#services` | `676`–`896` | `.page-services` + service-card grid + numbered steps |
| `#latelier` | `898`–`1172` | Typewriter cursor, Mac file-button, `.lat-form`, `.form-success` confirmation |
| `#contact` | `1174`–`1380` | Lead quote, `.contact-form`, trusted-by mark strip |
| `#shop` | `1382`–`1745` | Three views: `.shop-landing`, `.shop-brand`, type-detail; brand chips, maker doors, breathing animation |
| `#blog` | `1895`–`2006` (rules cluster around `.page-blog`) | Post grid; the `.blog-popup` lens-blur is in the mobile section (`4290`–`4405`) — applies on desktop too via shared selectors |
| `#podcast` | `2007`–`2064` | `.page-podcast` + Apple-style email capture |
| `#case` | `2065`–`2328` | `.page-case` + before/after slider (`.ba-frame`, `.ba-handle`, train-jolt animation) |
| `#map` *(dead — see §1)* | `2329`–`2587` | `.page-map`, overview canvas + numbered SVG hit overlay + map-case grid |
| `#gardens` | `2588`–`2659` | `.page-gardens` + tile grid |

> **Multi-route flag.** The `.page-inner` scrollbar rules (`::-webkit-scrollbar*`) repeat for `#blog`, `#shop`, `#gardens` (lines `1380`–`1381`, `1902`–`1903`, `2598`–`2599`). The `.fade-in` animation (lines `5081`+) drives stagger for every page. The `.case-text a` underline rule shares with `.about-text a` and `.post-excerpt a`.

### Mobile (everything inside `@media (max-width: 900px)…`)

The desktop breakpoint at line `2692` opens an enormous mobile block that runs to the end. Within it:

| Block | Lines |
|---|---|
| Mobile hero / `#m-home` content (wordmark + content blocks below) | `2700`–`2825` |
| Mobile contact block on home | `2826`–`2857` |
| Mobile services list on home | `2858`–`2887` |
| Mobile photo→render steps on home | `2888`–`2943` |
| Mobile footer | `2944`–`2955` |
| Hamburger toggle + cream overlay menu | `2956`–`3168` |
| Apple Watch / extra-small viewports | `3169`–`3228` |
| Accordion menu (expanded panels) | `3229`–`3349` |
| Mobile page sections base | `3350`–`3408` |
| `#m-contact` editorial directory | `3409`–`3540` |
| Mobile back chevron + brand mark | `3541`–`3593` |
| `#m-shop` (landing → brand → type) | `3594`–`3963` |
| `#m-blog` (post cards) | `3964`–`4031` |
| `#m-podcast` (headline + email box) | `4032`–`4107` |
| Mobile page visibility (active-only) | `4108`–`4117` |
| `#m-contact` flex distribution + reduced-motion + max-width:900 wrappers | `4118`–`4289` |
| Blog popup (centered modal + cursor-tracked lens) | `4290`–`4405` |
| Mobile loader (Apple-style ring + bulb flipbook) | `4406`–`4537` |
| `#m-services` (2-up grid + popup) | `4538`–`4642` |
| `#m-map` *(dead per §1)* (full-screen pinch-zoom + pan) | `4643`–`4853` |
| `#m-gardens` (vertical scrollable list) | `4854`–`4909` |
| `#m-generator` (1·2·3 photo upload form) | `4910`–`5034` |
| `#m-latelier` Vision & Quote | `5035`–`5080` |

> **Note.** Boundaries inside the mobile `@media` block are derived from the section-comment headers — they're tight but not bit-perfect. When porting a route, read from one comment header to the next and verify.

---

## 3. JavaScript — `<script>` blocks

| # | Lines | Summary | Deferred? |
|---|---|---|---|
| A | `5441`–`5454` | Leaf-image preloader: builds `window.__leafReady` Promise.all over the four leaf PNGs so the canvas script can paint immediately on first frame. | **Deferred** — bundle with leaf canvas sprint |
| B | `6632`–`8111` | Main interactive script. Section comments (script-relative line in parens, absolute in column 1): `6636` ASSET LOADING (data-URI placeholders for `__LOGO__`/`__GARY__`/`__MAP__`); `6656` MOBILE page-swap router; `7037` STAGE SCALING (1440×900 fit); `7053` CONVEYOR areas-Gary-works; `7082` PAGE ROUTER + bulb loading screen; `7272` L'ATELIER form (typewriter cursor + Mac file button + crossfade); `7388` MAP page (clickable circles → case grid); `7525` CASE STUDY before/after slider with train-jolt; `7642` SERVICES expandable cards; `7664` iOS-style notification popup for What's Growing; `7836` Email-capture forms (Podcast); `7857` SHOP three views; `8048` CUSTOM CURSOR (moss dot + lerping ring). | **Mixed.** **Deferred:** hash router `7082`+, replaceState `navigateTo` `7172`, `hashchange` `7214`, mobile router `6656`+, bulb-loader transition (lives inside the router). **Replaced by Astro file-routing.** **Port-with-page (later sprints):** L'Atelier form, case-study slider, services accordion, blog popup, email-capture, shop view machinery, custom cursor. |
| C | `8159`–`9499` | Leaf canvas: wind cone, ambient breeze, cursor leaf-blower, leaf physics, mobile sensory layer (shake / pull-to-refresh / haptics) at sub-section comment line `9368`. | **Deferred** — leaf-canvas sprint |

> **Two scripts referenced as `getElementById` but with no matching DOM element:** `mapBack`, `mobLoader`. The first ties to the dead `#map` route (§1). The second resolves to the mobile loader element which exists inside the loader markup (line ≈ `6085`) — verify on port.

---

## 4. Assets — manifest for the image batch

Every local asset reference. External (Google Fonts, `tel:`, `mailto:`, `instagram.com`) and `data:image/...` inline URIs are excluded. Logical asset → list of lines where it appears.

| Asset | Lines |
|---|---|
| `ampersand.png` (favicon, apple-touch-icon, inline `&` glyph in titles) | `13`, `23`, `5524`, `5567`, `5616`, `5623`, `5933`, `6045`, `6530` |
| `manifest.json` | `24` |
| `BULB TO FLOWER.png` | `33` (preload), `6087`, `6088`, `6089`, `6090` (loader frames) |
| `BULB TO FLOWER transparent.png` | `4521` (CSS `url()` in mobile loader) |
| `leaf 1.png` | `5431` (preload), `5463` (`#leafSrc1`) |
| `leaf 2.png` | `5432` (preload), `5464` (`#leafSrc2`) |
| `leaf 4.png` | `5433` (preload), `5465` (`#leafSrc4`) |
| `Screenshot 2026-05-02 at 14.49.32 copy.png` | `5434` (preload), `5466` (`#leafSrcF`) |
| `logo-wordmark.png` | `5490` (top-left logo), `5521` (home wordmark `<img>`), `6108` (loader logo), `6248` (mobile hero logo) |
| `before.jpg` (case study) | `6059` |
| `after.jpg` (case study) | `6061` |
| `logos/felco.png` | `5950`, `6541` |
| `logos/stihl.png` | `5958`, `6548` |
| `logos/niwaki.png` | `5966`, `6555` |
| `logos/wolfgarten.png` | `5974`, `6562` |
| `logos/aspley.png` | `5982`, `6569` |
| `logos/sylvagrow.png` | `5990`, `6576` |

### Placeholders resolved at runtime by JS (script B, `ASSETS` object — embedded data URIs, not separate files)

| Placeholder | Resolved at | Real source |
|---|---|---|
| `__LOGO__` | line `6646` | `ASSETS.logo` (inline base64) |
| `__GARY__` | line `6647` | `ASSETS.gary` (inline base64; also fed to `--gary-shape` CSS var at `6650`) |
| `__MAP__` | line `6648` | `ASSETS.map` (inline base64; tied to the dead `#map` route) |

> **For the image-port batch:** the embedded `ASSETS.*` data URIs in script B (lines `6638`–`6655`) are heavyweight. When extracting, treat each as an asset to drop into `public/` and reference normally — don't carry the base64 across.
