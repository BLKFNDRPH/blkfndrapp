# Performance

How fast the app is, measured the same way every time, and what has been done about it.

## Measuring

```bash
npm run perf:baseline                                  # the live site, every default page
npm run perf:baseline -- --url http://localhost:3000   # a local production build
npm run perf:baseline -- --pages /,/projects --runs 3 --form mobile
```

`scripts/perf-baseline.mjs` runs Lighthouse (pinned, through `npx`, so it is not an app dependency) against each page:

- on **desktop** (Lighthouse's desktop preset) and on **throttled mobile** (Lighthouse's default: a mid-range phone on simulated slow 4G with a 4× CPU slowdown);
- **5 runs** each by default, reporting the **median** of every metric;
- performance score, FCP, LCP, Total Blocking Time, CLS, Speed Index, server response time, request count, **Soroban RPC requests** and bytes transferred.

It writes `perf-reports/<timestamp>/summary.md`, `summary.json` and every raw report (git-ignored). Summaries worth keeping go in [`docs/performance/`](performance/).

Notes:

- It drives the Chrome installed on the machine (or `CHROME_PATH`). Run it on a quiet machine and connection; other load shows up as blocking time.
- A run Lighthouse could not complete is left out of the medians and shown as not counted.
- Lab runs have no INP, which needs real interaction; Total Blocking Time is the lab stand-in.
- From Git Bash, set `MSYS_NO_PATHCONV=1` before passing `--pages`, or the shell rewrites `/` into a Windows path.

## History

QA's audit of 4 October 2026 (QA-RPT-BLKFNDR-2026-10-04-PERF) found the browser calling the public Soroban RPC directly, with CORS preflights, and asked for a repeatable baseline (PERF-01 to PERF-04). Everything below was done on 12 October 2026.

| Change | Effect |
|---|---|
| #154 — platform settings read on demand; no second simulation per contract read | RPC calls on load: home 14 → 0, project page 18 → 2 |
| #155 — chain reads through same-origin, cached routes; server-only `SOROBAN_RPC_URL` | project page and its Stages tab 0 RPC calls from the browser; no preflights |
| #156 — listing pictures resized by `/api/images/[cid]`; this baseline script | home page 14.9 MB → about 1.5 MB ([local A/B](performance/2026-10-12-resized-pictures-local.md)) |
| #157 — no full-screen overlay while the session is checked; in-flow route loading screen; wallet panel (and the Stellar SDK) loaded on demand in the header; wordmark animation only while the pointer moves; fonts self-hosted with `next/font` | mobile home page score 36 → 56 (local A/B) |
| #158 — the Stellar SDK loaded on the project page only when someone acts; stakeholder balance through `/api/projects/[id]/stake` | mobile project page score 38 → 54 (local A/B) |

### Before and after, on the live site

Both measured against https://testnetv2.blkfndr.com with `npm run perf:baseline` (Lighthouse 13.5.0, median of 5 runs per row): **before** after #154 and #155 had been deployed ([baseline-2026-10-12-live.md](performance/baseline-2026-10-12-live.md)), **after** with #156–#158 deployed ([2026-10-12-live-after-158.md](performance/2026-10-12-live-after-158.md)).

**Throttled mobile**

| Page | Score | LCP | Total Blocking Time | First Contentful Paint | Bytes |
|---|---|---|---|---|---|
| `/` | 35 → **48** | 9,553 → **7,535 ms** | 1,547 → **735 ms** | 4,437 → **3,491 ms** | 14,852 → **1,058 KB** |
| `/projects` | 42 → **57** | 9,486 → **7,952 ms** | 788 → **289 ms** | 4,675 → **4,267 ms** | 1,223* → 1,450 KB |
| `/projects/11` | 30 → **50** | 10,366 → **7,642 ms** | 1,338 → **440 ms** | 4,085 → **3,573 ms** | 1,228* → **843 KB** |
| `/projects/11?tab=stages` | 35 → **62** | 10,334 → **6,933 ms** | 1,399 → **442 ms** | 4,161 → **2,287 ms** | 1,227 → **774 KB** |

**Desktop**

| Page | Score | LCP | Total Blocking Time | Bytes |
|---|---|---|---|---|
| `/` | 79 → **95** | 1,888 → **1,353 ms** | 235 → **9 ms** | 14,852 → **1,048 KB** |
| `/projects` | 41 → **74** | 7,099 → **2,426 ms** | 263 → **50 ms** | 18,294 → **1,445 KB** |
| `/projects/11` | 75 → **92** | 2,409 → **1,751 ms** | 248 → **4 ms** | 1,226* → **844 KB** |
| `/projects/11?tab=stages` | 77 → **92** | 2,542 → **1,789 ms** | 221 → **7 ms** | 1,227 → **778 KB** |

\* In these "before" runs every listing picture failed: Pinata's public gateway answered 429, so the page showed placeholders and the byte count is low. The pictures load now (`/projects` on mobile carries 712 KB of them, resized), which is why its total went up.

No page calls the Soroban RPC from the browser, before or after.

### What the work found along the way

- **Every contract read was sent twice.** A binding call simulates when it is built (SDK 15, `options.simulate` defaults to true); calling `.simulate()` on it again repeated the request (#154).
- **The public IPFS gateway rate-limits visitors.** In many runs `gateway.pinata.cloud` answered 429 and every picture failed. The resize route fetches through the dedicated gateway with its key, once per picture and width (#156). Lighthouse's own `total-byte-weight` also left large cross-origin pictures out of some runs, so the script sums the requests itself.
- **The first paint waited on the scripts.** A loading overlay that the server rendered covered every page until hydration and the session check had finished (#157).
- **The Stellar SDK was on every page**, through the header's wallet button and, on the project page, through the contract hook and the action panels (#157, #158). It now loads when someone opens a wallet or money action.

## Still open

- **Mobile LCP is still about 7–8 s** on throttled mobile, and First Contentful Paint 2.3–4.3 s. What is left on the home page is the app's own JavaScript and CSS before the first paint; the next step is a bundle analysis of the shared chunks.
- **Layout shift on `/projects`**: CLS 0.42 on desktop (0.35 before). Something on the project list moves after it first paints.
- **A picture's first request** after a deploy pays for fetching the original from IPFS (1–5 s); every later one is served from the server's cache or the browser's.
- **The admin console** still loads the Stellar SDK up front. It is admin-only, so it was left as it is.
