# Tusky to Pinata (completed migration)

> **Historical.** This migration is finished. It happened before this
> repository's history begins. Nothing in the app uses Tusky, and no Tusky
> package or variable remains. This page records what changed and describes
> how Pinata is used today. For deployment settings, see
> [deployment.md](deployment.md).

## What changed

| | Tusky (before) | Pinata (now) |
|---|---|---|
| Upload | Upload, get an `uploadId`, then poll until a `blobId` was ready | One request returns the IPFS CID |
| URL | `https://walrus.tusky.io/{blobId}` | `https://gateway.pinata.cloud/ipfs/{cid}` |
| Credentials | `NEXT_PUBLIC_TUSKY_VAULT_ID`, `NEXT_PUBLIC_TUSKY_API_KEY`, sent to the browser | A server-only Pinata JWT that never reaches the browser |
| Package | `@tusky-io/ts-sdk` (removed) | `pinata` |

The Tusky key was a `NEXT_PUBLIC_` variable, so it was inlined into the browser
bundle. The Pinata JWT is server-only. Never give a Pinata credential a
`NEXT_PUBLIC_` prefix: anyone could then pin to the platform's paid account.

## How Pinata is used today

### Uploads

The browser never talks to Pinata. `getPinataClient().uploadFile(file)` in
[src/lib/pinata-client.ts](../src/lib/pinata-client.ts) posts the file to
[/api/upload-image](../src/app/api/upload-image/route.ts) and gets back a CID.
Two places call it:

- [ListingForm.tsx](../src/components/create/ListingForm.tsx) pins the project
  image, then the project metadata as `metadata.json`. A retry of an unchanged
  draft reuses the earlier CIDs.
- [MilestoneProof.tsx](../src/components/project/MilestoneProof.tsx) pins a
  milestone proof photo.

The route:

- **Requires a signed-in session.** Otherwise it answers 401.
- **Reads the JWT from Supabase Vault** (`pinata_jwt`, set by an owner in the
  admin console under Settings), and falls back to the `PINATA_JWT` environment
  variable ([src/lib/secrets.ts](../src/lib/secrets.ts)). With neither, it
  answers 500.
- **Caps the size at 8 MB.** Larger files get 413.
- **Allows PNG, JPEG, WebP, GIF, SVG and JSON.** Anything else gets 415.
- **Checks the bytes, not the declared type.** Images are identified by their
  leading bytes, and SVG by a leading `<?xml` or `<svg`. JSON must parse. The
  file is rebuilt from the checked bytes, with the detected type, before upload.
- **Pins publicly**, into the Pinata group in `PINATA_GROUP_BLKDFNDR` when that
  is set.

The milestone proof form accepts only PNG, JPEG, WebP and GIF up to 8 MB. The
listing form's picker accepts any image, and the route enforces the list above.

### Display in the browser

`getIPFSGatewayUrl(cid)` builds `https://gateway.pinata.cloud/ipfs/<cid>`, the
shared public gateway. An `ipfs://` prefix is stripped. An absolute `http(s)`,
`data:` or `blob:` URL passes through unchanged, so a record that already stores
a full URL still renders. The project metadata stores its image as this full
URL.

### Reads on the server

The indexer fetches project metadata with `getIPFSFetchUrls(cid)` in
[src/lib/event-indexer.ts](../src/lib/event-indexer.ts):

- **Bare CIDs only.** A CIDv0 (`Qm…`) or base32 CIDv1 (`b…`). Any URL returns
  nothing. The value comes from an on-chain event that any builder controls,
  so honouring a URL would let a listing make the server fetch an arbitrary
  address.
- **Two gateways, in order.** First the host from `PINATA_GATEWAY_URL` (hostname
  only), then `gateway.pinata.cloud`. Each gets 8 seconds. A refusal is logged
  with its status and host, and the next gateway is tried. A reply over 256 KB
  is ignored.
- **Retries.** Each indexer run retries up to 5 projects still titled
  `Project #<id>`.

**Gateway key.** For this account's pins, the dedicated gateway answers
`401 ERR_ID:00024` unless the request carries its Gateway Key, which is separate
from the JWT. The server sends `PINATA_GATEWAY_KEY` as `x-pinata-gateway-token`
to the dedicated gateway only (#104), and does not follow redirects with it
attached. Without the key, every server read falls back to the shared gateway,
which rate-limits (429). See [deployment.md](deployment.md#runtime-server-only).

## Variables

| Variable | Kind | Use |
|---|---|---|
| `PINATA_JWT` | Runtime, secret | Pinning. Fallback when the Vault has no `pinata_jwt` |
| `PINATA_GATEWAY_URL` | Runtime | Dedicated gateway host for server reads |
| `PINATA_GATEWAY_KEY` | Runtime, secret | That gateway's Gateway Key, sent only to it |
| `PINATA_GROUP_BLKDFNDR` | Runtime | Group id for uploads. Optional |
