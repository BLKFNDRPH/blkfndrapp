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
 * Get the IPFS gateway URL for a CID
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
