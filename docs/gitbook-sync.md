# GitBook Sync

## Goal

GitHub markdown is the canonical technical documentation. GitBook, when connected, is a searchable reading view of the same files — never a second source.

## Sync Model

- Source repository: [`BLKFNDRPH/blkfndrapp`](https://github.com/BLKFNDRPH/blkfndrapp)
- Branch: `main`
- Content root: `docs/`
- Sidebar definition: [docs/SUMMARY.md](SUMMARY.md)
- Direction: GitHub → GitBook. GitBook edits, if two-way sync is enabled, must land as commits on `main` through the same review as any other change.

`README.md` and `progress.md` sit at the repository root and are linked from `SUMMARY.md` with `../` paths.

## GitBook Setup Steps

1. In GitBook, create or open the blkfndr space.
2. Integrations → GitHub Sync → connect GitHub.
3. Select repository `BLKFNDRPH/blkfndrapp`, branch `main`.
4. Set the project directory to `docs/`.
5. Confirm the sidebar matches `docs/SUMMARY.md`.

## Validation Checklist

- A markdown file added on `main` appears in GitBook after the next sync.
- The GitBook sidebar matches `docs/SUMMARY.md` in order and nesting.
- Links between pages, and `../` links to the root files, resolve in GitBook's preview.

## Operational Rules

- Documentation changes go through pull requests like code.
- Every page in `docs/` is listed in `docs/SUMMARY.md`; add, remove or rename the entry in the same PR as the page.
- A PR that changes behaviour updates the docs it affects in the same PR, and `progress.md` when it changes what is live, pending or open.

## Troubleshooting

### Sync not updating

- Check the integration still has access to `BLKFNDRPH/blkfndrapp`.
- Check the branch is still `main`.
- Check no branch protection rule blocks GitBook's sync commits, if two-way sync is on.

### Sidebar incorrect

- Check `docs/SUMMARY.md` contains only valid relative links.
- Check new pages are listed there.

### Merge conflicts

- Resolve them on GitHub first, then re-trigger the sync from GitBook.
