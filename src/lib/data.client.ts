/**
 * Client-safe data fetching utilities.
 * These call API routes with fetch(), so client components never import the
 * server-only data layer in src/lib/data/.
 */

import type { User, Project } from "./types";

/**
 * The address lookups return profile rows (display_name, avatar_url), not
 * Users. Reading `.name` off the raw row was always undefined, so every creator
 * and backer was shown as their bare wallet address.
 */
function profileToUser(row: any): User | null {
  if (!row || typeof row !== "object" || !row.id) return null;
  const avatar = row.avatar_url ?? "";
  return {
    uid: row.id,
    name: row.display_name ?? "",
    email: "",
    avatarUrl: avatar,
    creatorAvatar: avatar,
    role: "user",
    wallet: row.wallet_status === "connected" ? "connected" : "disconnected",
    stellarPublicKey: row.stellar_public_key ?? undefined,
  };
}

/**
 * Look up the platform user linked to a Stellar wallet address.
 * Safe to call from client components.
 */
export const getUserByCreatorId = async (
  address: string,
): Promise<User | null> => {
  if (!address) return null;
  try {
    const res = await fetch(
      `/api/user-by-address?address=${encodeURIComponent(address)}`,
    );
    if (!res.ok) return null;
    return profileToUser(await res.json());
  } catch (err) {
    console.error("getUserByCreatorId fetch error:", err);
    return null;
  }
};

/**
 * Fetch a project by its on-chain object ID.
 * Falls back to the project list for numeric Stellar ids.
 * Safe to call from client components.
 */
export const getProjectById = async (
  id: string,
): Promise<Project | undefined> => {
  if (!id) return undefined;

  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    if (res.ok) return await res.json();

    const listRes = await fetch("/api/projects");
    if (!listRes.ok) return undefined;

    const projects = (await listRes.json()) as Project[];
    return projects.find((project) => project.id === id);
  } catch (err) {
    console.error("getProjectById fetch error:", err);
    return undefined;
  }
};

export const getUsersByAddresses = async (
  addresses: string[],
): Promise<Record<string, User>> => {
  if (!addresses.length) return {};
  try {
    const res = await fetch("/api/user-by-addresses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses }),
    });
    if (!res.ok) return {};
    const rows: Record<string, unknown> = await res.json();
    const out: Record<string, User> = {};
    for (const [address, row] of Object.entries(rows)) {
      const user = profileToUser(row);
      if (user) out[address] = user;
    }
    return out;
  } catch (err) {
    console.error("getUsersByAddresses fetch error:", err);
    return {};
  }
};
