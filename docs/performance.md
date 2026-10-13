# Performance

How fast the app is, measured the same way every time, and what has been done about it.

## Measuring

```bash
npm run perf:baseline                                  # the live site, every default page
npm run perf:baseline -- --url http://localhost:3000   # a local production build
npm run perf:baseline -- --pages /,/projects --runs 3 --form mobile
npm run perf:baseline -- --form mobile --throttling devtools   # a phone, slowed for real
```

`scripts/perf-baseline.mjs` runs Lighthouse (pinned, through `npx`, so it is not an app dependency) against each page:

- on **desktop** (Lighthouse's desktop preset) and on **throttled mobile** (a mid-range phone on slow 4G with a 4× CPU slowdown);
- **5 runs** each by default, reporting the **median** of every metric;
- performance score, FCP, LCP, Total Blocking Time, CLS, Speed Index, server response time, request count, **Soroban RPC requests** and bytes transferred.

It writes `perf-reports/<timestamp>/summary.md`, `summary.json` and every raw report (git-ignored). Summaries worth keeping go in [`docs/performance/`](performance/). `--from <dir>` re-summarises raw reports without running again.

**Simulated or real throttling.** By default Lighthouse *simulates* the slow phone: it loads the page at full speed and estimates the throttled timings from that run. `--throttling devtools` slows the browser's CPU and network for real while the page loads. It takes longer, but it sees work that only happens when the CPU really is slow, which simulation cannot. In #168 the home page's LCP fell from 3.4 to 2.4 s with real throttling while simulation reported no change. Use real throttling to judge a change to how the page loads or renders; use the default for comparing with earlier runs.

Notes:

- It drives the Chrome installed on the machine (or `CHROME_PATH`). Run it on a quiet machine and connection; other load shows up as blocking time.
- A run Lighthouse could not complete is left out of the medians and shown as not counted. Chrome on Windows occasionally crashes a run (exit code 3221226505); re-run that row.
- Lab runs have no INP, which needs real interaction; Total Blocking Time is the lab stand-in.
- For an A/B of blocking time, alternate single runs of the two builds (`--runs 1`, taking turns) rather than running all of one build and then all of the other. The machine drifts: on 13 October the same `main` build measured 620 ms of TBT on the home page in one pass and 975 ms half an hour later.
- From Git Bash, set `MSYS_NO_PATHCONV=1` before passing `--pages`, or the shell rewrites `/` into a Windows path.

## History

QA's audit of 4 October 2026 (QA-RPT-BLKFNDR-2026-10-04-PERF) found the browser calling the public Soroban RPC directly, with CORS preflights, and asked for a repeatable baseline (PERF-01 to PERF-04). Everything below was done on 12 October 2026. The effects are from local A/B runs against the `main` of the day.

| Change | Effect |
|---|---|
| #154 — platform settings read on demand; no second simulation per contract read | RPC calls on load: home 14 → 0, project page 18 → 2 |
| #155 — chain reads through same-origin, cached routes; server-only `SOROBAN_RPC_URL` | project page and its Stages tab 0 RPC calls from the browser; no preflights |
| #156 — listing pictures resized by `/api/images/[cid]`; this baseline script | home page 14.9 MB → about 1.5 MB ([local A/B](performance/2026-10-12-resized-pictures-local.md)) |
| #157 — no full-screen overlay while the session is checked; in-flow route loading screen; wallet panel (and the Stellar SDK) loaded on demand in the header; wordmark animation only while the pointer moves; fonts self-hosted with `next/font` | mobile home page score 36 → 56 |
| #158 — the Stellar SDK loaded on the project page only when someone acts; stakeholder balance through `/api/projects/[id]/stake` | mobile project page score 38 → 54 |
| #160 — `/projects` rendered on the server as it ends up (search and categories read by the server page); route loading screen a screen tall | desktop `/projects` CLS 0.430 → 0.012 |
| #161 — the project page's skeleton a screen tall | mobile project page CLS 0.163 → 0.000 |
| #162 — the project page rendered on the server with the indexed project; live vault figures still read in the browser | mobile project page score 61 → 65; its main picture is in the first HTML |
| #163 (closed) — `experimental.inlineCss` | first paint 0.3–0.6 s sooner on mobile, LCP unchanged; not worth 32 KB more HTML per page |
| #168 — no root `loading.tsx`, so each page's content is rendered in place rather than revealed late from a hidden streaming segment; hero animations held until the page has settled; `--throttling devtools` | home LCP 3.4 → 2.4 s with real throttling |
| #170 — `/projects` reads the project list on the server; the first row's pictures load eagerly at high priority | `/projects` LCP 8.6 → 2.9 s with real throttling |

### Before and after, on the live site

All measured against https://testnetv2.blkfndr.com with `npm run perf:baseline` (Lighthouse 13.5.0, median of 5 runs per row):

- **12 Oct, before:** after #154 and #155 had been deployed ([baseline-2026-10-12-live.md](performance/baseline-2026-10-12-live.md)).
- **12 Oct, after:** with #156–#158 deployed ([2026-10-12-live-after-158.md](performance/2026-10-12-live-after-158.md)).
- **13 Oct:** with #160–#170 deployed ([2026-10-13-live.md](performance/2026-10-13-live.md)).

**Throttled mobile (simulated)**

| Page | Score | LCP | Total Blocking Time | First Contentful Paint |
|---|---|---|---|---|
| `/` | 35 → 48 → **59** | 9,553 → 7,535 → 7,565 ms | 1,547 → 735 → **341 ms** | 4,437 → 3,491 → 3,698 ms |
| `/projects` | 42 → 57 → **82** | 9,486 → 7,952 → **4,154 ms** | 788 → 289 → **176 ms** | 4,675 → 4,267 → **1,304 ms** |
| `/projects/11` | 30 → 50 → **76** | 10,366 → 7,642 → **6,011 ms** | 1,338 → 440 → **148 ms** | 4,085 → 3,573 → **1,361 ms** |
| `/projects/11?tab=stages` | 35 → 62 → **68** | 10,334 → 6,933 → 7,006 ms | 1,399 → 442 → **329 ms** | 4,161 → 2,287 → **1,365 ms** |

The home page's simulated LCP stays about 7.5 s. That is the simulation, not the page: with real throttling (below) it is 3.6 s, the same as its first paint.

**Desktop**

| Page | Score | LCP | Total Blocking Time | Bytes |
|---|---|---|---|---|
| `/` | 79 → 95 → **97** | 1,888 → 1,353 → **1,222 ms** | 235 → 9 → **0 ms** | 14,852 → 1,048 → **1,027 KB** |
| `/projects` | 41 → 74 → **94** | 7,099 → 2,426 → **1,618 ms** | 263 → 50 → **3 ms** | 18,294 → 1,445 → 1,456 KB |
| `/projects/11` | 75 → 92 → **96** | 2,409 → 1,751 → **1,322 ms** | 248 → 4 → 4 ms | 1,226* → 844 → **827 KB** |
| `/projects/11?tab=stages` | 77 → 92 → **94** | 2,542 → 1,789 → **1,587 ms** | 221 → 7 → 25 ms | 1,227 → 778 → **755 KB** |

\* In these "before" runs every listing picture failed: Pinata's public gateway answered 429, so the page showed placeholders and the byte count is low.

No page calls the Soroban RPC from the browser, at any point after #155.

**Throttled mobile, real throttling** ([2026-10-13-live-devtools.md](performance/2026-10-13-live-devtools.md)). The first live run in this mode, so there is no earlier live figure to compare; the local A/Bs in #168 and #170 are the before.

| Page | Score | LCP | First Contentful Paint | Total Blocking Time |
|---|---|---|---|---|
| `/` | 56 | 3,603 ms | 3,603 ms | 1,492 ms |
| `/projects` | 59 | 3,669 ms | 3,599 ms | 1,264 ms |
| `/projects/11` | 56 | 4,157 ms | 3,090 ms | 1,139 ms |
| `/projects/11?tab=stages` | 53 | 5,808 ms | 3,202 ms | 791 ms |

### What the work found along the way

- **Every contract read was sent twice.** A binding call simulates when it is built (SDK 15, `options.simulate` defaults to true); calling `.simulate()` on it again repeated the request (#154).
- **The public IPFS gateway rate-limits visitors.** In many runs `gateway.pinata.cloud` answered 429 and every picture failed. The resize route fetches through the dedicated gateway with its key, once per picture and width (#156). Lighthouse's own `total-byte-weight` also left large cross-origin pictures out of some runs, so the script sums the requests itself.
- **The first paint waited on the scripts.** A loading overlay that the server rendered covered every page until hydration and the session check had finished (#157).
- **The Stellar SDK was on every page**, through the header's wallet button and, on the project page, through the contract hook and the action panels (#157, #158). It now loads when someone opens a wallet or money action.
- **A root `loading.tsx` delays every page on a slow phone.** With it, Next sends the fallback first and the page's content in a hidden streaming segment, which React 19.2 reveals on a later animation frame; with the main thread busy running scripts, that frame came about two seconds late. Simulated throttling cannot see this, because it estimates from a fast run where the frame comes at once (#168).
- **Lazy pictures in the first row hold back LCP.** The first card's picture is usually the largest paint on a list page; loading it lazily, after a client-side fetch, put `/projects`' LCP near 8.6 s (#170).
- **High-priority pictures compete with the stylesheets.** React preloads every non-lazy `<img>` from the `<head>`, at the image's own `fetchPriority`. With the whole first row at high priority, a phone's two off-screen card pictures (about 175 KB) could take the bandwidth the render-blocking CSS needed. In some runs the first paint then came at about 3.1 s instead of 2.4 s. Only the first card is high priority now; the rest of the first row loads eagerly at normal priority. Measured over 10 interleaved runs with real throttling, `/projects` on a phone went from LCP 3,006 → 2,415 ms and score 67.5 → 72.5, and every run got the fast first paint (2.34–2.50 s, against 2.41–3.23 s before). Desktop stayed at 100 (#179). This was also the race #178's runs had surfaced. Measured again on top of #178, LCP went 2,633 → 2,453 ms and every first paint was 2.38–2.56 s. TBT read higher, though, 714 → 887 ms, so the score went 75 → 73.5. The change runs no script. TBT counts long tasks after the first paint, and an earlier paint puts more of the page's start-up inside that window.

## Still open

- **The server's first byte on database-backed pages** is 0.4–0.6 s on live (it was about 0.1 s): `/projects` and the project page now read their data before they send anything, instead of sending a fallback first (#168, #170). The content arrives sooner overall, but a cache or a faster path to Supabase would take most of this off the first paint.
- **The Stages tab on a phone**: LCP 5.8 s with real throttling, and it loads 478 KB of pictures (the builders' proof images) that the other tabs do not. CLS 0.064 there too.
- **Total Blocking Time with real throttling** is 0.5–1.5 s on every page. Profiling (4× CPU, source-mapped) puts it in two places: evaluating the shared chunks (Next and React are about 430 KB of the 1.1 MB of script on every page) and React hydrating the provider tree, header and page. On the home page, the carousel's start-up (about 140 ms) and the wordmark's first layout of its variable font (about 240 ms) add to it. Tried on 13 October, each measured with an interleaved A/B (below):
  - The theme switch in the menu loads when the menu opens (#176): 27 KB less compressed script on every page, TBT unchanged.
  - The home page as a server component, with the featured carousel as its own client component: 34 KB less script, but TBT about 300 ms *worse*, because the carousel then mounts in the same task as the data arriving. Dropped.
  - `<Suspense>` around the header, the page and the footer, so that each hydrates in its own task: TBT unchanged, and CLS 0.002 → 0.37. Dropped.

  - The shared layout, measured part by part (#178). A lab build left out one part at a time, chosen by a cookie, and an interleaved harness measured blocking time on `/projects` (4× CPU, Lighthouse's mobile network, 6 rounds):

    | Left out | Blocking time |
    |---|---|
    | nothing | 496 ms |
    | the header | 334 ms |
    | the page's own content | 291 ms |
    | footer, banner or toaster | 422–467 ms (within noise) |
    | everything but the providers | 124 ms |

    The header is 101 of the page's 1,924 React fibers, so its cost was not its size. It rendered an empty bar on the server and built itself after mounting, and it re-rendered whenever the project list, the wallet's stakes or the platform settings arrived. #178 renders it on the server (phone or desktop navigation is CSS at 950px) and moves the menu's project, stake and admin rows into the open menu. It also replaces the search box's framer-motion fade with CSS, asks CoinGecko for the XLM price only once someone searches, and makes the footer a server component. On the same harness, leaving out the header now saves about 60 ms instead of 160. In Lighthouse: 38 KB less compressed script on the home and project pages, and TBT 1,239 → 1,155 ms on `/` and 905 → 838 ms on `/projects/11`. `/projects`' TBT was unchanged (796 vs 785 ms).

  What is left is each page's own content and the framework starting up. On `/projects` the page's client components (the list, its filters and the cards) are the larger share.
- **A picture's first request** after a deploy pays for fetching the original from IPFS (1–5 s); every later one is served from the server's cache or the browser's.
- **The admin console** still loads the Stellar SDK up front. It is admin-only, so it was left as it is.
