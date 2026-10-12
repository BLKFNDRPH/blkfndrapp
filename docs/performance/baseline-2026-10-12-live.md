# Lighthouse baseline: https://testnetv2.blkfndr.com

2026-10-12 08:11 UTC · lighthouse@13.5.0 · median of 5 runs per row.
Mobile: simulated slow 4G, 4x CPU slowdown. Desktop: Lighthouse desktop preset.

## Desktop

| Metric | `/` | `/projects` | `/projects/11` | `/projects/11?tab=stages` |
|---|---|---|---|---|
| Performance score | 79 | 41 | 75 | 77 |
| First Contentful Paint | 1,070 ms | 1,024 ms | 939 ms | 958 ms |
| Largest Contentful Paint | 1,888 ms | 7,099 ms | 2,409 ms | 2,542 ms |
| Total Blocking Time | 235 ms | 263 ms | 248 ms | 221 ms |
| Cumulative Layout Shift | 0.003 | 0.346 | 0.020 | 0.030 |
| Speed Index | 1,609 ms | 1,929 ms | 1,116 ms | 1,430 ms |
| Server response (TTFB) | 113 ms | 114 ms | 131 ms | 101 ms |
| Requests | 72 | 92 | 55 | 57 |
| Soroban RPC requests | 0 | 0 | 0 | 0 |
| Bytes transferred | 14,852 KB | 18,294 KB | 1,226 KB | 1,227 KB |
| of which pictures | 13,644 KB | 17,100 KB | 1 KB | 1 KB |
| Runs completed | 5/5 | 5/5 | 5/5 | 5/5 |

## Mobile (throttled)

| Metric | `/` | `/projects` | `/projects/11` | `/projects/11?tab=stages` |
|---|---|---|---|---|
| Performance score | 35 | 42 | 30 | 35 |
| First Contentful Paint | 4,437 ms | 4,675 ms | 4,085 ms | 4,161 ms |
| Largest Contentful Paint | 9,553 ms | 9,486 ms | 10,366 ms | 10,334 ms |
| Total Blocking Time | 1,547 ms | 788 ms | 1,338 ms | 1,399 ms |
| Cumulative Layout Shift | 0.000 | 0.000 | 0.164 | 0.086 |
| Speed Index | 6,168 ms | 6,111 ms | 5,959 ms | 5,912 ms |
| Server response (TTFB) | 118 ms | 107 ms | 124 ms | 119 ms |
| Requests | 72 | 81 | 56 | 57 |
| Soroban RPC requests | 0 | 0 | 0 | 0 |
| Bytes transferred | 14,852 KB | 1,223 KB | 1,228 KB | 1,227 KB |
| of which pictures | 13,644 KB | 50 KB | 3 KB | 1 KB |
| Runs completed | 5/5 | 5/5 | 5/5 | 5/5 |
