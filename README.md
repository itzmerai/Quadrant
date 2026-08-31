<p align="center">
  <img src="apps/desktop/icons/icon.png" alt="" width="104" height="104" />
</p>

<h1 align="center">Quadrant</h1>

<p align="center">
  <strong>Draw a box on the map. Get every small medical practice inside it —<br />
  with a phone number, and the name of the person who answers.</strong>
</p>

<p align="center">
  <a href="https://itzmerai.github.io/Quadrant/">Website</a> ·
  <a href="https://itzmerai.github.io/Quadrant/download/">Download for Windows</a> ·
  <a href="https://itzmerai.github.io/Quadrant/guide/">Guide</a>
</p>

<p align="center">
  <img alt="Licence: MIT" src="https://img.shields.io/badge/licence-MIT-blue" />
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows%2010%2F11-informational" />
  <img alt="No API key required" src="https://img.shields.io/badge/API%20key-not%20required-brightgreen" />
  <img alt="Runs locally" src="https://img.shields.io/badge/data-stays%20on%20your%20machine-brightgreen" />
</p>

---

## What Quadrant is

A desktop lead-generation tool for **medical virtual assistants doing cold
outreach to US practices**.

You draw a rectangle over a city on a map and name it. Quadrant works out which
ZIP codes that rectangle covers, queries the US federal provider registry for
each one, throws away the practices you would never pitch, and hands back a
**call sheet sorted into the order you should dial it**.

Every row carries a phone number and, on most records, the name and title of the
practice's authorized official — the person to ask for instead of "whoever
handles your scheduling". It shows the clock *at the practice* so you are not
dialling a closed office from another timezone, and it tracks where you got to
with each one.

It is free, MIT-licensed, and runs entirely on your machine. No account, no API
key, no subscription. Your leads never leave your computer.

### Who it is for

Aspiring or working medical VAs who need a list of practices to call and do not
have a budget for a lead database. It targets the practices small enough to
still answer their own phone and busy enough to outsource scheduling, intake and
billing — dentists, chiropractors, physical therapy, family medicine, mental
health, optometry, podiatry and seven more specialties.

It is explicitly **not** a scraper for hospitals or health systems. Those get
filtered out, because they have procurement departments rather than a doctor who
picks up.

### What a session looks like

1. **Draw a box** over a US city and name it — *Scottsdale Dentists*, *Tampa
   Chiropractors*. The box owns its own leads, statuses and notes.
2. **Tick the specialties** you want. Seven are pre-ticked by default; fourteen
   are available.
3. **Find leads.** A few neighbourhood blocks returns in about five seconds. A
   whole metro area took three minutes and returned 762 practices.
4. **Work the call sheet** top to bottom. Set a status on each row as you go.
5. **Optionally hunt emails** as a second pass, and **export to CSV** whenever
   you want the list somewhere else.
6. **Rescan weeks later.** New practices get added and stale details refresh,
   while your statuses and notes survive untouched.

There is an [interactive demo on the website](https://itzmerai.github.io/Quadrant/)
— you can drag a box across a real map and watch the call sheet re-filter — and
a [full walkthrough in the guide](https://itzmerai.github.io/Quadrant/guide/).

### What you get on every lead

| Field | Notes |
|---|---|
| Practice name, specialty | Grouped into a specialty key for filtering |
| **Phone** | ~100% coverage. The main deliverable. |
| **Ask for** | Authorized official's name and title, from the registry record |
| Direct phone | When the record carries one separate from the main line |
| Address, city, state, ZIP, coordinates | |
| **Their local time** | Derived timezone, with an open-now filter |
| Website, email | Enrichment pass, not registry data — see limits below |
| Registered / last updated | Practice age and record freshness |
| **Score, with reasons** | Call order, and the signals behind it |
| Call status, note, last called | Yours, preserved across rescans |
| Shared-phone group | Other practices registered at the same number |

Scoring is deliberately explainable — each lead lists the actual signals that
moved it, so you can disagree with the ranking rather than trust it blindly.

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

## The site

The marketing site is a separate Astro workspace in `site/`, with its own
lockfile so its dependencies never reach the app's tree. It imports the app's
design tokens from `apps/ui/src/styles/tokens.css` rather than copying them, so
the interface shown on the page cannot drift from the one the app renders.

```bash
cd site && npm install
npm run dev      # local preview
npm test         # release-metadata and demo-selection tests
npm run build    # static output in site/dist
```

Two workflows deploy it. `pages.yml` publishes the site on a push touching
`site/`; `release.yml` builds the Windows installer on a `v*` tag. They are
deliberately independent — a typo fix needs no release, and a failed installer
build blocks no copy change.

The download page reads the latest release's version, date and checksum at build
time, so **run the Pages workflow manually after publishing a release** to pick
them up. Until a release exists the page says so plainly rather than linking a
file that is not there.

---

## Layout

```
packages/core/     headless engine — no UI imports, runs in Node or the browser
  data/            42,354 bundled ZIP centroids
  src/providers/   one RegistryProvider per country
  src/store/       one folder per named box
apps/ui/           React + Vite + Leaflet
apps/desktop/      Tauri v2 shell
site/              Astro marketing site (separate workspace)
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
- **Not audited, not signed.** Early software written by one person. The
  installer is unsigned, so Windows SmartScreen will warn about it; the download
  page publishes a checksum so you can verify the file instead of trusting it.

---

## Compliance

NPPES is CMS public data intended for public use. OpenStreetMap is ODbL, so
attribution is required — the `source` field on every lead carries it.

For US B2B cold calling: honor the National DNC list where a number is a personal
line, identify yourself, and honor opt-outs immediately. `do-not-contact` is a
first-class call status, not an afterthought.

None of this is legal advice. If you are calling at volume, check the current
rules for the states you are calling into.

---

## Licence

MIT. See [LICENSE](LICENSE).
