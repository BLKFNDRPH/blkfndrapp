import { NextRequest, NextResponse } from "next/server";
import { isImageWidth, parseCid } from "@/lib/project-image";
import { isAllowedImage, resizedImage } from "@/lib/image-resize";
import { isListingImage } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A listing's picture, resized: `/api/images/<cid>?w=640`.
 *
 * Only pictures some listing uses are served, at only the widths in
 * IMAGE_WIDTHS, so this cannot be used to resize arbitrary IPFS content. The
 * answer for a CID never changes, so browsers may keep it for a year.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ cid: string }> }) {
  const { cid: raw } = await context.params;
  const cid = parseCid(raw);
  const width = Number(req.nextUrl.searchParams.get("w"));
  if (!cid || cid !== raw || !isImageWidth(width)) {
    return NextResponse.json({ error: "Not a picture this site serves" }, { status: 400 });
  }

  try {
    if (!(await isAllowedImage(cid, isListingImage))) {
      return NextResponse.json({ error: "Not a picture this site serves" }, { status: 404 });
    }
    const image = await resizedImage(cid, width);
    if (!image) {
      return NextResponse.json({ error: "The picture could not be read" }, { status: 502 });
    }
    return new NextResponse(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(image.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(`Error serving picture ${cid}:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
