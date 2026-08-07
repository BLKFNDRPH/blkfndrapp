import { NextRequest, NextResponse } from "next/server";
import { PinataSDK } from "pinata";
import { requireCaller, AuthError } from "@/lib/supabase/auth";

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
      let req = (pinata.upload as any).public.file(file);
      if (pinataGroupId) {
        console.log("[pinata] attaching group:", pinataGroupId);
        req = req.group(pinataGroupId);
      }
      uploaded = await req;
    } else if (hasDirectFile) {
      console.log("[pinata] using legacy upload.file()");
      let req = (pinata.upload as any).file(file);
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