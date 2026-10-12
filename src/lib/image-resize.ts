import "server-only";

import sharp from "sharp";
import { getIPFSFetchUrls } from "@/lib/pinata-client";
import { createReadCache } from "@/lib/read-cache";
import type { ImageWidth } from "@/lib/project-image";

/**
 * Listing pictures, fetched from IPFS and resized on this server.
 *
 * An IPFS CID names its bytes, so a resized picture never goes stale: it is
 * kept here for a day (the browser keeps it for a year), and the work of
 * fetching and resizing a 3 MB original is done once per width rather than
 * once per visitor.
 */

/** Refuse originals larger than this; no camera photo needs more. */
const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;
/** And larger than this many pixels, which sharp would have to decode. */
const MAX_INPUT_PIXELS = 60_000_000;
const FETCH_TIMEOUT_MS = 20_000;

/** Resized pictures are larger than chain reads, so they get their own, smaller cache. */
const resized = createReadCache(300);
const allowed = createReadCache(1000);

const DAY_MS = 24 * 60 * 60 * 1000;

/** The original bytes from the first gateway that serves an image, or null. */
async function fetchOriginal(cid: string): Promise<Buffer | null> {
  for (const { url, headers } of getIPFSFetchUrls(cid)) {
    try {
      const res = await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) {
        console.warn(`[images] ${cid} is ${type || "untyped"}, not an image`);
        return null;
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > MAX_ORIGINAL_BYTES) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_ORIGINAL_BYTES) return null;
      return bytes;
    } catch (error) {
      console.warn(`[images] fetching ${cid} from ${new URL(url).host} failed:`, error);
    }
  }
  return null;
}

/** The picture `width` pixels wide (never wider than its original), as WebP. */
async function resize(cid: string, width: ImageWidth): Promise<Buffer | null> {
  const original = await fetchOriginal(cid);
  if (!original) return null;
  try {
    return await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate() // honour the camera's orientation before dropping its metadata
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
  } catch (error) {
    console.warn(`[images] resizing ${cid} failed:`, error);
    return null;
  }
}

/** The resized picture, from the cache when it has been made before. */
export function resizedImage(cid: string, width: ImageWidth): Promise<Buffer | null> {
  return resized.cachedRead(`${cid}:${width}`, DAY_MS, () => resize(cid, width));
}

/**
 * Whether the CID is a listing's picture, remembered for ten minutes once it
 * is. The check is what keeps the route from being an open IPFS resizer, not
 * a privacy gate: the picture is public on IPFS either way.
 */
export function isAllowedImage(cid: string, check: (cid: string) => Promise<boolean>) {
  return allowed.cachedRead(`${cid}`, 10 * 60 * 1000, async () => ((await check(cid)) ? true : null));
}
