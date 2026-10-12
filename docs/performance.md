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

QA's audit of 4 October 2026 (QA-RPT-BLKFNDR-2026-10-04-PERF) found the browser calling the public Soroban RPC directly, with CORS preflights, and asked for a repeatable baseline (PERF-01 to PERF-04).

| Change | Effect |
|---|---|
| #154 — platform settings read on demand; no second simulation per contract read | RPC calls on load: home 14 → 0, project page 18 → 2 |
| #155 — chain reads through same-origin, cached routes; server-only `SOROBAN_RPC_URL` | project page and its Stages tab 0 RPC calls from the browser; no preflights |
| this change — listing pictures resized by `/api/images/[cid]` | see below |

### Live baseline, 12 October 2026

After #154 and #155 were deployed: [baseline-2026-10-12-live.md](performance/baseline-2026-10-12-live.md). In short:

- No page calls the Soroban RPC from the browser any more.
- Pictures dominated the weight: the home page transferred **14.9 MB**, `/projects` **18.3 MB** on desktop, almost all of it listing photos served from IPFS at upload size (2–3.5 MB each).
- On throttled mobile every page's LCP was **9.5–10.4 s** and Total Blocking Time **0.8–1.5 s**.

### Resized listing pictures

`/api/images/[cid]?w=320|640|1080|1600` serves each listing picture resized, as WebP, from the server's cache after the first request; cards ask for the width they are shown at and load lazily. Measured on a local production build of the change ([2026-10-12-resized-pictures-local.md](performance/2026-10-12-resized-pictures-local.md)) against the live baseline:

| Page (median) | Pictures before (live) | Pictures after (local) | Page total before → after |
|---|---|---|---|
| `/`, desktop | 13,644 KB | 294 KB | 14,852 → 1,553 KB |
| `/`, mobile | 13,644 KB | 303 KB | 14,852 → 1,562 KB |
| `/projects`, desktop | 17,100 KB | 692 KB | 18,294 → 1,938 KB |

Two things the comparison showed:

- **The public IPFS gateway rate-limits visitors.** In many runs `gateway.pinata.cloud` answered 429 and every picture failed, so the page showed placeholders: a local build of `main` lost them in 11 of 12 runs, and the live mobile `/projects` runs lost all 18. Those runs are left out of the "before" column. The resize route fetches through the dedicated gateway with its key, once per picture and width, so visitors no longer meet that limit.
- **Mobile LCP did not move** (about 10 s before and after). On throttled mobile the largest paint waits on JavaScript and fonts, not on the pictures, which now load lazily below it. Desktop LCP on `/projects` was 7.1 s live and 2.2 s locally, but the local server sits next to the browser, so that difference is not all the pictures' doing; re-run the baseline against the live site once this is deployed.

## Still open

- **JavaScript on mobile.** First Contentful Paint is about 4 s and Total Blocking Time 0.8–1.5 s on throttled mobile, independent of pictures. The next step is a bundle analysis of the home and project pages.
- **Layout shift on `/projects`** (CLS 0.35 on desktop).
- **A picture's first request** after a deploy pays for fetching the original from IPFS (1–5 s); every later one is served from the server's cache or the browser's.
