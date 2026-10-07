import type { Metadata } from "next";
import { UnsubscribeCard } from "./UnsubscribeCard";
import { isEmailSwitch } from "@/lib/email/categories";

export const metadata: Metadata = {
  title: "Email settings · BLKFNDR",
  robots: { index: false },
};

/**
 * Where "Stop these emails" in an email leads. It asks first, with a button,
 * rather than unsubscribing on arrival: mail scanners open every link in an
 * email, and must not turn anyone's emails off by doing so.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[]; c?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.t === "string" ? params.t : "";
  const category = typeof params.c === "string" && isEmailSwitch(params.c) ? params.c : null;

  return (
    <div className="container mx-auto max-w-lg px-4 py-16">
      <UnsubscribeCard token={token} category={category} />
    </div>
  );
}
