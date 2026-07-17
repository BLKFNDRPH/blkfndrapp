import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import AuthChallenge from "@/lib/models/AuthChallenge";
import User from "@/lib/models/User";
import { getSession } from "@/lib/auth/session";
import { Keypair } from "@stellar/stellar-sdk";
import crypto from "crypto";
import { checkIsAdminOnChain } from "@/lib/stellar";


export async function POST(req: NextRequest) {
  try {
    const { publicKey, signature, nonce } = await req.json();

    if (!publicKey || !signature || !nonce) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    // Google Login must be primary. Users must be logged in with Google to link a wallet.
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Must be logged in with Google to connect a wallet." },
        { status: 401 },
      );
    }
    const currentUid = session.user.uid;

    await connectToDatabase();

    const challenge = await AuthChallenge.findOne({ publicKey, nonce });
    if (!challenge) {
      return NextResponse.json(
        { error: "Invalid or expired challenge" },
        { status: 401 },
      );
    }

    try {
      const keypair = Keypair.fromPublicKey(publicKey);

      let sigBuffer: Buffer;
      if (Array.isArray(signature)) {
        sigBuffer = Buffer.from(signature);
      } else if (typeof signature === "string") {
        sigBuffer = Buffer.from(signature, "base64");
      } else {
        throw new Error("Invalid signature format received");
      }

      const SIGN_MESSAGE_PREFIX = "Stellar Signed Message:\n";
      const canonicalPayload = SIGN_MESSAGE_PREFIX + nonce;
      const messageHash = crypto
        .createHash("sha256")
        .update(canonicalPayload, "utf8")
        .digest();

      const isValid = keypair.verify(messageHash, sigBuffer);

      if (!isValid) {
        console.log(
          "[Freighter Auth Verify] isValid returned false for signature",
        );
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 },
        );
      }
    } catch (verifyError) {
      console.error("[Freighter Auth] Verification error:", verifyError);
      return NextResponse.json(
        { error: "Signature verification failed" },
        { status: 401 },
      );
    }

    await AuthChallenge.deleteOne({ _id: challenge._id });

    // Check if another user has already linked this wallet to prevent duplicates
    const existingWalletOwner = await User.findOne({ stellarPublicKey: publicKey });
    if (existingWalletOwner && existingWalletOwner.uid !== currentUid) {
      return NextResponse.json(
        { error: "This wallet is already linked to another account." },
        { status: 400 },
      );
    }

    // Check if the linked wallet is an admin on-chain
    const isOnChainAdmin = await checkIsAdminOnChain(publicKey);

    // Link the Freighter wallet to the logged-in Google account
    const user = await User.findOneAndUpdate(
      { uid: currentUid },
      {
        $set: {
          stellarPublicKey: publicKey,
          wallet: "connected",
          ...(isOnChainAdmin ? { role: "admin" } : {}),
        },
      },
      { new: true },
    );


    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("[Freighter Auth] Verify error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
