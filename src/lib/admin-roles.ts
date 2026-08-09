/**
 * Admin roles — the shared vocabulary, safe on both sides of the wire.
 *
 * These live here rather than in lib/data/admins.ts because that module is
 * "server-only": importing it into a client component throws at build. The role
 * names and their labels are needed in both the add dialog (client) and the data
 * layer (server), so they belong in a module neither side is forbidden to touch.
 *
 * The list is the single source of truth for the enum. The database has its own
 * admin_role type with the same members; a Zod schema in the data layer validates
 * against this array, so the two cannot drift without a test noticing.
 */

export const ADMIN_ROLES = [
  "owner",
  "kyc_manager",
  "project_approver",
  "accountant",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/** How each role reads on screen, and what it is for. */
export const ROLE_LABELS: Record<AdminRole, { label: string; blurb: string }> = {
  owner: {
    label: "Owner",
    blurb: "Holds a share and a vote. Adding one dilutes every other owner.",
  },
  kyc_manager: {
    label: "KYC Support Manager",
    blurb: "Reviews and decides identity verification. No share, no vote.",
  },
  project_approver: {
    label: "Project Approver",
    blurb: "Approves listings and flags ones that need an owner vote.",
  },
  accountant: {
    label: "Accountant",
    blurb: "Reads the vault, transactions and reports. Changes nothing.",
  },
};
