# Lighthouse baseline: http://localhost:3102

2026-10-12 08:11 UTC · lighthouse@13.5.0 · median of 3 runs per row.
Mobile: simulated slow 4G, 4x CPU slowdown. Desktop: Lighthouse desktop preset.

## Desktop

| Metric | `/` | `/projects` |
|---|---|---|
| Performance score | 86 | 67 |
| First Contentful Paint | 847 ms | 805 ms |
| Largest Contentful Paint | 1,586 ms | 2,160 ms |
| Total Blocking Time | 217 ms | 136 ms |
| Cumulative Layout Shift | 0.002 | 0.420 |
| Speed Index | 1,249 ms | 956 ms |
| Server response (TTFB) | 23 ms | 12 ms |
| Requests | 66 | 92 |
| Soroban RPC requests | 0 | 0 |
| Bytes transferred | 1,553 KB | 1,938 KB |
| of which pictures | 294 KB | 692 KB |
| Runs completed | 3/3 | 3/3 |

## Mobile (throttled)

| Metric | `/` | `/projects` |
|---|---|---|
| Performance score | 38 | 48 |
| First Contentful Paint | 3,936 ms | 4,084 ms |
| Largest Contentful Paint | 10,086 ms | 10,781 ms |
| Total Blocking Time | 1,456 ms | 604 ms |
| Cumulative Layout Shift | 0.000 | 0.000 |
| Speed Index | 5,420 ms | 5,300 ms |
| Server response (TTFB) | 13 ms | 9 ms |
| Requests | 64 | 71 |
| Soroban RPC requests | 0 | 0 |
| Bytes transferred | 1,562 KB | 1,944 KB |
| of which pictures | 303 KB | 711 KB |
| Runs completed | 3/3 | 3/3 |
