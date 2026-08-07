import { getCaller } from "@/lib/supabase/auth";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminSignIn } from "@/components/admin/AdminSignIn";

/**
 * Admin entry.
 *
 * Authorization is a Supabase session whose role is admin — email and password
 * or Google, the same as anywhere else in the app. It used to be "does this
 * browser have a Freighter wallet on the on-chain roster", which conflated two
 * different things: who you are, and what you can sign.
 *
 * Those are genuinely separate. Most of this dashboard reads and writes
 * Postgres — the KYC review queue, categories, project moderation — and none of
 * it needs a key. The parts that do touch a contract need a wallet no matter
 * who you are signed in as, because the contract checks the signature and
 * nothing this application believes can substitute for one. So the wallet moves
 * inside, next to the actions that actually require it.
 *
 * Checked on the server so the page is never sent to a non-admin. That is not
 * the security boundary — requireAdmin() and RLS are, and they run again on
 * every request the dashboard makes. This only avoids shipping a UI to someone
 * who cannot use it.
 */
export default async function AdminPage() {
  const caller = await getCaller();

  if (!caller) {
    return <AdminSignIn state="signed-out" />;
  }

  if (!caller.isAdmin) {
    return <AdminSignIn state="not-admin" email={caller.email} />;
  }

  return (
    <div className="container mx-auto py-8">
      <AdminDashboard />
    </div>
  );
}
