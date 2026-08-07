import { NextResponse } from "next/server";
import { getCaller } from "@/lib/supabase/auth";
import { getOwnProfile } from "@/lib/data/profiles";

export const dynamic = "force-dynamic";

/**
 * The client's view of who it is.
 *
 * Backed by Supabase Auth rather than the hand-rolled JWT this used to serve.
 * Note what is absent: no raw provider token. The previous version embedded the
 * Google ID token in the session and handed it back here, putting a live
 * credential one XSS away from exfiltration.
 */
export async function GET() {
  const caller = await getCaller();
  if (!caller) return NextResponse.json({});

  try {
    const profile = await getOwnProfile();
    return NextResponse.json({
      user: {
        uid: caller.userId,
        email: caller.email,
        name: profile?.display_name ?? "Anonymous",
        creatorAvatar: profile?.avatar_url ?? "",
        role: caller.isAdmin ? "admin" : "user",
        wallet: profile?.wallet_status ?? "disconnected",
        stellarPublicKey: profile?.stellar_public_key ?? "",
      },
    });
  } catch (error) {
    console.error("session:", error);
    return NextResponse.json({});
  }
}
