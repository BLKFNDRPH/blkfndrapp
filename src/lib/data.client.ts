/**
 * Client-safe data fetching utilities.
 * These use fetch() to call API routes instead of importing Mongoose directly.
 * Import these in client components instead of lib/data.ts
 */

import type { User, Project } from "./types";

/**
 * Look up a user by their wallet address or uid.
 * Safe to call from client components.
 *
 * field options:
 *   "stellarPublicKey"   — Stellar wallet public key (default)
 *   "uid"                — NextAuth session uid
 */
export const getUserByCreatorId = async (
  address: string,
  field:
    | "stellarPublicKey"
    | "uid" = "stellarPublicKey",
): Promise<User | null> => {
  if (!address) return null;
  try {
    const res = await fetch(
      `/api/user-by-address?address=${encodeURIComponent(address)}&field=${field}`,
    );
    if (!res.ok) return null;
    return await res.json();
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
    return await res.json();
  } catch (err) {
    console.error("getUsersByAddresses fetch error:", err);
    return {};
  }
};
