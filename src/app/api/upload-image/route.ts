import { NextRequest, NextResponse } from "next/server";
import { PinataSDK } from "pinata";
import { requireCaller, AuthError } from "@/lib/supabase/auth";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * This route is named for images but the listing form also pins the project
 * metadata JSON through it, so JSON has to be allowed or creating a project
 * fails outright at the last step.
 */
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "application/json",
]);

/**
 * Identify an image from its leading bytes.
 *
 * The Content-Type on an upload is supplied by the client and means nothing on
 * its own, so the declared type is treated as a hint and the actual bytes decide.
 *
 * SVG is deliberately the awkward case: it is markup, not a bitmap, so it has no
 * magic number and can carry script. It is accepted because logos are commonly
 * SVG, but only when it parses as XML/SVG, and it is served from the IPFS gateway
 * on a different origin rather than from this app's — an inline SVG served
 * same-origin would be an XSS vector.
 */
function sniffImageType(bytes: Uint8Array): string | null {
  const startsWith = (...sig: number[]) =>
    sig.every((b, i) => bytes[i] === b);

  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  // RIFF....WEBP
  if (startsWith(0x52, 0x49, 0x46, 0x46) && [8, 9, 10, 11].every((i, k) => bytes[i] === [0x57, 0x45, 0x42, 0x50][k]))
    return "image/webp";

  const head = new TextDecoder()
    .decode(bytes.subarray(0, 512))
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) return "image/svg+xml";

  return null;
}

function normalizePinataGateway(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    return url.hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
  }
}

export async function POST(request: NextRequest) {
  console.log("=== /api/upload-image POST called ===");

  try {
    await requireCaller();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 1. Env var check ──────────────────────────────────────────────────────
  // Server-only vars: a NEXT_PUBLIC_ fallback would ship the JWT to every browser.
  const pinataJwt = process.env.PINATA_JWT;
  const pinataGatewayRaw = process.env.PINATA_GATEWAY_URL;
  const pinataGroupId = process.env.PINATA_GROUP_BLKDFNDR;

  console.log("[env] PINATA_JWT present:", !!pinataJwt);
  console.log("[env] PINATA_GATEWAY_URL raw:", pinataGatewayRaw ?? "not set");
  console.log("[env] PINATA_GROUP_BLKDFNDR:", pinataGroupId ?? "not set");

  if (!pinataJwt) {
    console.error("[error] PINATA_JWT is missing — aborting");
    return NextResponse.json(
      { error: "Server misconfiguration: PINATA_JWT is not set." },
      { status: 500 }
    );
  }

  // ── 2. Parse form data ────────────────────────────────────────────────────
  let file: File | null = null;
  try {
    const formData = await request.formData();
    file = formData.get("file") as File | null;
    console.log("[formData] file present:", !!file);
    if (file) {
      console.log("[formData] file name:", file.name);
      console.log("[formData] file size:", file.size, "bytes");
      console.log("[formData] file type:", file.type);
    }
  } catch (err) {
    console.error("[error] Failed to parse formData:", err);
    return NextResponse.json({ error: "Failed to parse form data" }, { status: 400 });
  }

  if (!file) {
    console.error("[error] No file field in formData");
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size === 0) {
    console.error("[error] File is empty (0 bytes)");
    return NextResponse.json({ error: "Empty file provided" }, { status: 400 });
  }

  // This endpoint pins to a paid Pinata account, and anything pinned is public
  // and effectively permanent. Requiring a session bounds who can call it, but
  // not what they can store: without the checks below any signed-in user could
  // park arbitrary files of any size and type on the platform's account.
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Image must be ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB or smaller.` },
      { status: 413 },
    );
  }

  // `file.type` is whatever the browser claimed, so it is checked first as a
  // cheap reject and then confirmed against the actual bytes below.
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "File must be a PNG, JPEG, WebP, GIF, SVG or JSON document." },
      { status: 415 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  let sniffed: string | null;
  if (file.type === "application/json") {
    // Must actually parse, so this cannot be used to pin arbitrary bytes under
    // a JSON label.
    try {
      JSON.parse(new TextDecoder().decode(bytes));
      sniffed = "application/json";
    } catch {
      return NextResponse.json(
        { error: "That file is not valid JSON." },
        { status: 415 },
      );
    }
  } else {
    sniffed = sniffImageType(bytes);
    if (!sniffed) {
      return NextResponse.json(
        { error: "That file is not a recognisable image." },
        { status: 415 },
      );
    }
  }

  // Rebuilt from the bytes actually inspected, rather than handing the original
  // object on to be read a second time. Two reasons: nothing downstream can
  // receive content this route did not check, and the type sent to Pinata is the
  // one sniffed from the bytes instead of the one the browser claimed.
  const verified = new File([bytes], file.name || "upload", { type: sniffed });

  // ── 3. Init Pinata SDK ────────────────────────────────────────────────────
  const pinataGateway = normalizePinataGateway(pinataGatewayRaw);
  console.log("[pinata] normalized gateway:", pinataGateway ?? "none (will use default)");

  let pinata: PinataSDK;
  try {
    pinata = new PinataSDK({
      pinataJwt,
      ...(pinataGateway ? { pinataGateway } : {}),
    });
    console.log("[pinata] SDK initialized successfully");
  } catch (err) {
    console.error("[error] PinataSDK constructor threw:", err);
    return NextResponse.json({ error: "Failed to initialize Pinata SDK" }, { status: 500 });
  }

  // ── 4. Detect SDK upload API shape ───────────────────────────────────────
  console.log("[pinata] upload object keys:", Object.keys(pinata.upload));
  const hasPublicNamespace = "public" in pinata.upload;
  const hasDirectFile = "file" in pinata.upload;
  console.log("[pinata] upload.public exists:", hasPublicNamespace);
  console.log("[pinata] upload.file exists (legacy):", hasDirectFile);

  // ── 5. Upload ─────────────────────────────────────────────────────────────
  let uploaded: any;
  try {
    console.log("[pinata] starting upload...");

    if (hasPublicNamespace) {
      console.log("[pinata] using upload.public.file()");
      let req = (pinata.upload as any).public.file(verified);
      if (pinataGroupId) {
        console.log("[pinata] attaching group:", pinataGroupId);
        req = req.group(pinataGroupId);
      }
      uploaded = await req;
    } else if (hasDirectFile) {
      console.log("[pinata] using legacy upload.file()");
      let req = (pinata.upload as any).file(verified);
      if (pinataGroupId) {
        console.log("[pinata] attaching group:", pinataGroupId);
        req = req.group(pinataGroupId);
      }
      uploaded = await req;
    } else {
      console.error("[error] No known upload method found on SDK. Keys:", Object.keys(pinata.upload));
      return NextResponse.json(
        { error: "Pinata SDK version mismatch — no upload method found" },
        { status: 500 }
      );
    }

    console.log("[pinata] upload response:", JSON.stringify(uploaded, null, 2));
  } catch (err: any) {
    console.error("[error] Pinata upload failed:", err?.message || String(err));
    return NextResponse.json(
      { error: "Image upload failed." },
      { status: 500 }
    );
  }

  // ── 6. Extract CID ────────────────────────────────────────────────────────
  const cid = uploaded?.cid ?? uploaded?.IpfsHash ?? uploaded?.ipfsHash;
  console.log("[pinata] extracted CID:", cid);

  if (!cid) {
    console.error("[error] No CID in upload response. Full response:", uploaded);
    return NextResponse.json({ error: "Upload succeeded but no CID returned" }, { status: 500 });
  }

  console.log("=== upload-image SUCCESS, cid:", cid, "===");
  return NextResponse.json({ cid });
}