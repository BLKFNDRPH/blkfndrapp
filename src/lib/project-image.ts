/**
 * Project pictures at the size they are shown.
 *
 * Builders upload whatever their camera made, and the pictures were shown
 * straight from IPFS at that size: 2 to 3.5 MB each, twelve of them on the
 * home page, about 12 MB of its 14.8 MB, for cards a few hundred pixels wide.
 * /api/images/[cid] serves them resized to one of a few widths, as WebP, and
 * the helpers here build its addresses. A picture that is not on IPFS (a data
 * URI in a draft, a placeholder) is left as it is.
 *
 * Self-contained so node --test can load it, and safe in the browser.
 */

/** The widths the resize route serves. Anything else is refused. */
export const IMAGE_WIDTHS = [320, 640, 1080, 1600] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];

/**
 * The bare CID in a value, or null when it is not a plausible one.
 *
 * Accepts a bare CID, ipfs://CID, or any gateway address with /ipfs/CID in its
 * path. CIDv0 (Qm…, base58) or CIDv1 (base32, starting with b); restricting
 * the character set also rules out path traversal and host injection.
 */
export function parseCid(value: string | null | undefined): string | null {
  if (!value) return null;
  let rest = value.trim();
  const inPath = rest.match(/\/ipfs\/([^/?#]+)/);
  if (inPath) {
    rest = inPath[1];
  } else {
    if (rest.startsWith("ipfs://")) rest = rest.slice("ipfs://".length);
    rest = rest.replace(/^\/+/, "").split(/[/?#]/)[0];
  }
  const isCidV0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(rest);
  const isCidV1 = /^b[a-z2-7]{50,}$/.test(rest);
  return isCidV0 || isCidV1 ? rest : null;
}

/** Whether the resize route serves this width. */
export function isImageWidth(width: number): width is ImageWidth {
  return (IMAGE_WIDTHS as readonly number[]).includes(width);
}

/** The smallest served width at least `width` wide, or the largest. */
export function nearestImageWidth(width: number): ImageWidth {
  return IMAGE_WIDTHS.find((w) => w >= width) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1];
}

/**
 * A picture's address resized to about `width` pixels, or the address as it
 * was when the picture is not on IPFS.
 */
export function resizedImageUrl(src: string, width: number): string {
  const cid = parseCid(src);
  if (!cid || src.startsWith("data:") || src.startsWith("blob:")) return src;
  return `/api/images/${cid}?w=${nearestImageWidth(width)}`;
}

/** A srcset offering every served width, or undefined when the picture is not on IPFS. */
export function resizedSrcSet(src: string): string | undefined {
  const cid = parseCid(src);
  if (!cid || src.startsWith("data:") || src.startsWith("blob:")) return undefined;
  return IMAGE_WIDTHS.map((w) => `/api/images/${cid}?w=${w} ${w}w`).join(", ");
}
