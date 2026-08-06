export class PinataClient {
  /**
   * Upload a file to Pinata via the server-side API route
   * @param file - The file to upload
   * @returns The IPFS CID of the uploaded file
   */
  async uploadFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);

    let response: Response;
    try {
      response = await fetch("/api/upload-image", {
        method: "POST",
        body: formData,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Network error while uploading to /api/upload-image";
      throw new Error(`Image upload request failed: ${message}`);
    }

    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const err = await response.json();
        throw new Error(err.error || "Upload failed");
      }

      const text = await response.text();
      throw new Error(text || `Upload failed with status ${response.status}`);
    }

    const { cid } = await response.json();
    return cid;
  }
}

/**
 * Initialize and return a Pinata client
 */
export function getPinataClient(): PinataClient {
  return new PinataClient();
}

/**
 * Resolve a CID to a gateway URL that is safe for the *server* to fetch.
 *
 * Unlike getIPFSGatewayUrl below, this never honours an absolute URL. The
 * values passed here come from on-chain event payloads that any project
 * creator can set, so accepting "http://169.254.169.254/..." would turn the
 * indexer into a server-side request forgery gadget whose response body gets
 * written into the public project listing.
 *
 * Returns null if the value is not a plausible bare CID.
 */
export function getIPFSFetchUrl(cid: string): string | null {
  if (!cid) return null;

  let value = cid.trim();
  if (value.startsWith("ipfs://")) {
    value = value.slice("ipfs://".length);
  }
  value = value.replace(/^\/+/, "").split(/[/?#]/)[0];

  // CIDv0 (Qm..., base58) or CIDv1 (base32, starts with b). Restricting the
  // character set also guarantees no path traversal or host injection.
  const isCidV0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value);
  const isCidV1 = /^b[a-z2-7]{50,}$/.test(value);
  if (!isCidV0 && !isCidV1) return null;

  return `https://${resolveGatewayHost()}/ipfs/${value}`;
}

/**
 * Gateway hostname for server-side fetches.
 *
 * A dedicated Pinata gateway should be configured via PINATA_GATEWAY_URL — the
 * shared public one rate-limits aggressively, which shows up as an indexer that
 * silently stops enriching projects with their metadata.
 *
 * Only the hostname is taken, so a misconfigured value carrying a path or query
 * cannot redirect the fetch somewhere else.
 */
function resolveGatewayHost(): string {
  const configured = process.env.PINATA_GATEWAY_URL?.trim();
  if (!configured) return "gateway.pinata.cloud";

  try {
    const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
    return new URL(withProtocol).hostname || "gateway.pinata.cloud";
  } catch {
    return "gateway.pinata.cloud";
  }
}

/**
 * Get the IPFS gateway URL for a CID, for rendering in the browser.
 * Passes absolute URLs through unchanged to support legacy stored records.
 * Do not use this to build a URL the server will fetch — see getIPFSFetchUrl.
 */
export function getIPFSGatewayUrl(cid: string): string {
  const value = cid.trim();
  if (!value) {
    return "";
  }

  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("blob:")
  ) {
    return value;
  }

  if (value.startsWith("ipfs://")) {
    return getIPFSGatewayUrl(value.replace(/^ipfs:\/\//i, ""));
  }

  return `https://gateway.pinata.cloud/ipfs/${value}`;
}
