# CLAUDE.md

Instructions for building the Hours PWA. Read README.md first for full architecture and data model.

## What to build

A single-page PWA that displays local business hours. Vanilla HTML/CSS/JS — no frameworks, no build step, no npm dependencies on the frontend. The app must work as a standalone home-screen app on iPhone.

## Implementation priorities

1. **Speed above all else.** The localStorage read → render path should feel instant. No loading spinners, no skeleton screens. If localStorage has data, paint it immediately.
2. **Information density.** This is a utility, not a showcase. Small text, tight rows, no wasted space. Think of it as a personal reference card, not a consumer app.
3. **Tap-to-expand, not swipe.** Tapping a row expands it in place to show the full weekly schedule, upcoming overrides, and contact links — instant, no animation. (An earlier version of this spec called for a swipe-to-reveal-tomorrow gesture; that was never built. Don't resurrect it without checking with the user first — this was a deliberate simplification, not an oversight.)

## Frontend details

### HTML structure

Single `index.html` with:
- A fixed top bar with filter pills generated dynamically from whatever categories exist in the current business list, plus a Clear button and an Edit button
- A scrollable list below it
- No hamburger menus, no navbars, no footers

### Each list row

Two lines per business, tightly packed:

```
Business Name
Open · Closes 9:00 PM
```

or

```
Business Name
Closed · Opens 9:00 AM tomorrow
```

or

```
Business Name
Closed today
```

Status computation rules:
- Compare current device time against today's hours (check overrides first, then fall back to regular hours)
- If currently within open hours → "Open · Closes {close time}"
- If closed now but opens later today → "Closed · Opens {open time} today"
- If closed for the rest of today → "Closed · Opens {open time} {day}" where {day} is "tomorrow" or the next open day name
- If a business has no hours data at all → "Hours unavailable"
- Use 12-hour format with AM/PM, no leading zeros. Drop ":00" when minutes are zero (show "9 AM" not "9:00 AM").

Color coding:
- "Open" text is green
- "Closed" text is a muted red/warm gray — not alarming, just informational

### Tap-to-expand interaction

Tapping a row toggles it between collapsed and expanded — instant, no transition. Expanded, it reveals:
- The full weekly schedule, with consecutive days sharing identical hours grouped (e.g. "Mon–Fri")
- Any upcoming date-specific overrides (holidays, modified hours)
- Phone and maps links, if available

Tapping the row again (or anywhere outside a link within it) collapses it back.

### Filters

Filter pills styled as small pills/chips at the top, generated dynamically from whatever categories are present in the current business list — not a fixed set. When active, a pill gets a filled background; inactive pills are outlined/muted.

- Tapping an inactive filter activates it and hides non-matching businesses
- Filters are single-select: activating one deactivates whatever was previously active
- Tapping the active filter deactivates it (shows everything)
- The Clear button deactivates the active filter and shows everything
- Clear button is only visible when a filter is active
- Filter transitions should not be animated — just instant show/hide

### Offline behavior

The service worker should cache-first the app shell (`index.html`, `style.css`, `app.js`, `sw.js`). `/api/*` requests must always pass straight through to the network, never cached — they're the (authenticated, dynamic) Edit-mode calls. The app's actual data lives in localStorage, not a cached file, so it works fully offline with whatever was last saved there.

### PWA manifest

```json
{
  "name": "Hours",
  "short_name": "Hours",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff"
}
```

Use `display: standalone` so it looks like a native app (no Safari chrome). Provide a simple favicon/icon — a minimal clock or just the letter "H" is fine. Generate as 192x192 and 512x512 PNGs.

### CSS approach

- System font stack: `-apple-system, BlinkMacSystemFont, sans-serif` — this is a utility app for iPhone, not a design statement. System fonts load instantly and feel native.
- Base font size: 14px for business names, 12px for hours/status
- Row padding: 10px vertical, 16px horizontal
- No borders between rows — use subtle background alternation or a thin 1px separator, whatever produces higher density
- The entire viewport should be usable. No max-width container. The list goes edge-to-edge.
- Support dark mode via `prefers-color-scheme` media query
- Safe area insets for iPhone notch: `env(safe-area-inset-top)` etc.
- No scrollbars visible (use `-webkit-scrollbar: none` plus `scrollbar-width: none`)
- Prevent overscroll bounce on the filter bar (it should stay fixed)

### Data loading (app.js)

Each device owns its own business list in localStorage — there's no shipped seed file and no shared source of truth. See README's "Personal list & Edit mode" and "Frontend behavior" sections for the full model; summary:

```
On page load:
  1. const cached = localStorage.getItem('hours_data')
  2. if (cached) → parse and render immediately, then silently check staleness
     (if 'hours_updated' is >7 days old, POST tracked placeIds to the
     Edit-mode API proxy's /api/details, merge hours/phone/address into
     the existing list, never touching name/category)
  3. else (true first run, nothing in localStorage yet) → render an empty
     state: "No businesses yet. Tap Edit to search for and add some." No
     network call.
```

Do not show any loading state if cached data exists. The user should never perceive a loading moment on a warm launch. The staleness check and any Edit-mode network activity must never block or show a loading/error state either — fail silently and keep showing cached data.

### Timestamp display

Show a small, muted "Updated {relative time}" at the very bottom of the list. Example: "Updated 3 hours ago" or "Updated yesterday". This helps the user know if their data might be stale. Use the `hours_updated` localStorage timestamp for this.

## Edit mode

An Edit button in the top bar lets the user search Google Places (by device location, zip code, and/or free text) and add/remove businesses from their own device's list — see README's "Personal list & Edit mode" section for the full architecture (the stateless `scripts/api-server.js` proxy, geolocation-biased search, category auto-suggestion, the shared-secret caveat, the 7-day refresh cadence). Don't duplicate that spec here; keep this file and README in sync if either changes.

The hours-parsing logic (`parseRegularHours`, `parseOverrides`) lives in `scripts/lib/hours-parser.js` — shared by anything that calls Google Places Details, don't reimplement it inline.

## Things to avoid

- No frameworks (React, Vue, Svelte, etc.)
- No build tools (Webpack, Vite, etc.)
- No CSS frameworks (Tailwind, Bootstrap)
- No icon libraries — use no icons at all. Text only.
- No skeleton loaders or loading spinners
- No modals, drawers, or overlays
- No maps
- No analytics or tracking
- No "last updated 5 minutes ago" toast notifications — the timestamp at the bottom is sufficient
- No animations anywhere — filter show/hide and row tap-to-expand are both instant.
