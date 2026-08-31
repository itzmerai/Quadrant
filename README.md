# Quadrant

Draw a named box on the map. Get every small medical practice inside it, with a
phone number and the name of the person who answers.

Built for medical virtual assistants doing cold outreach to US practices.

---

## Running it

```bash
npm install

npm run dev        # browser at localhost:5173 — works fully, no Rust needed
npm run desktop    # the real Tauri app (first Rust build takes a few minutes)
npm run typecheck
```

Headless, no UI — useful for testing the engine:

```bash
npm run scan -- --bbox 33.55,-111.95,33.60,-111.88 \
                --name "Scottsdale Dentists" \
                --specialties dental \
                --out leads.csv
```

Run it with no arguments to list the available specialty keys.

---

## How it works

```
draw a named box (4 coords)
  -> ZIP centroids inside the box      bundled offline, no network call
  -> NPPES query per ZIP               free, no API key, ~100% phone coverage
  -> filter to VA-target practices     drops hospitals, DME, assisted living
  -> score for call order              practice age, record freshness, fit
  -> saved under the box name
  -> export CSV
```

### Why NPPES

The CMS National Plan & Provider Enumeration System is the US registry of every
licensed provider and practice. Free, no key, no signup, and published as public
data.

It is also the only source tested that carries a **named decision-maker with a
direct phone line** on every practice record. Measured against the alternatives:

| Source | Scope | Any contact channel |
|---|---|---|
| **NPPES** | Scottsdale AZ dentists | **100%** |
| OpenStreetMap | Phoenix/Scottsdale, 548 POIs | 29.9% |
| OpenStreetMap | Metro Manila, 2,904 POIs | 13.7% |

Those numbers are why Google Places, HERE, TomTom and Foursquare are all absent
from the design. The core path needs no API key at all.

`enumeration_date` is the second reason: a recently enumerated practice is a new
clinic that has not hired admin staff yet, which is the warmest call a VA can make.
Leads are sorted with that weighted in.

---

## Layout

```
packages/core/     headless engine — no UI imports, runs in Node or the browser
  data/            42,354 bundled ZIP centroids
  src/providers/   one RegistryProvider per country
  src/store/       one folder per named box
apps/ui/           React + Vite + Leaflet
apps/desktop/      Tauri v2 shell
```

`packages/core` deliberately imports nothing from the UI, so the same engine
backs the CLI, the app, and anything else later.

### The CORS detail

NPPES sends no CORS headers, so a browser cannot call it directly.

- **Desktop**: `@tauri-apps/plugin-http` issues requests from Rust, where CORS
  does not apply. This is the main reason Quadrant is a desktop app.
- **Browser dev**: the Vite proxies in `apps/ui/vite.config.ts` stand in.

`apps/ui/src/lib/runtime.ts` picks between them at startup.

---

## Where data lives

One folder per named box, so it is browsable and obvious:

```
<app data>/territories/
  scottsdale-dentists/
    territory.json    name, bbox, specialties, timestamps
    leads.json        leads, with call status and notes
```

In browser dev the same structure is kept in `localStorage`.

Rescanning a box **merges** rather than overwrites: registry fields refresh while
call status, notes and enrichment are preserved.

---

## Known limits

- **Email coverage is weak (15–30%).** NPPES carries no email and no website, so
  email comes from crawling sites discovered via OpenStreetMap, and only ~30% of
  practices have a matchable site. Phone-first is the intended workflow.
- **Registry records go stale.** Some phone numbers route to billing services.
  `last_updated` feeds the score so stale records sink.
- **US only, for now.** No other country has an equivalent open registry. The
  `RegistryProvider` interface exists so others can be added with an honest
  coverage badge rather than a silent downgrade.
- **ZIP resolution is centroid-based.** A ZIP straddling the box edge is included
  only if its centre falls inside, so edge practices can be missed by a block.
- **Timezones derive from state + longitude**, not true timezone polygons.
  Correct for the vast majority of ZIPs, wrong near a few internal boundaries.

---

## Compliance

NPPES is CMS public data intended for public use. OpenStreetMap is ODbL, so
attribution is required — the `source` field on every lead carries it.

For US B2B cold calling: honor the National DNC list where a number is a personal
line, identify yourself, and honor opt-outs immediately. `do-not-contact` is a
first-class call status, not an afterthought.
