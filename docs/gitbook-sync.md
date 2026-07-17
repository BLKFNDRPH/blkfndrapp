# GitBook Sync

## Goal

Maintain a single source of truth where GitHub markdown is the canonical technical documentation while GitBook provides a polished, searchable interface for stakeholders.

## Sync Model

- Source repository: `tmdc-it-solutions/blkfndr`
- Branch: `main`
- Content root: `docs/`
- Sidebar definition: `docs/SUMMARY.md`
- Direction: Bi-directional sync (GitHub <-> GitBook)

## GitBook Setup Steps

1. In GitBook, create or open the blkfndr space.
2. Go to Integrations and connect GitHub.
3. Select repository `tmdc-it-solutions/blkfndr`.
4. Configure branch as `main`.
5. Configure docs root as `docs/`.
6. Enable two-way sync so approved edits in GitBook commit back to GitHub.
7. Confirm `docs/SUMMARY.md` is used for navigation.

## Validation Checklist

- A new markdown file added in GitHub appears in GitBook within sync window.
- A content update in GitBook creates a commit in GitHub `main`.
- Sidebar in GitBook matches `docs/SUMMARY.md` order.
- Broken links are detected by GitBook page previews.

## Operational Rules

- Merge documentation changes through pull requests.
- Keep all technical specs in GitHub markdown (never only in GitBook UI).
- Update `docs/SUMMARY.md` whenever pages are added, removed, or renamed.
- Track feature-doc migration status in `docs/content-migration.md`.

## Troubleshooting

### Sync Not Updating

- Verify integration token still has repository access.
- Verify branch is still `main`.
- Verify no branch protection rule blocks GitBook sync commits.

### Sidebar Incorrect

- Confirm `docs/SUMMARY.md` has valid markdown links.
- Confirm newly added pages are listed in `docs/SUMMARY.md`.

### Merge Conflicts

- Resolve conflicts in GitHub first, then retrigger sync from GitBook.
