/**
 * Admin roles — the shared vocabulary, safe on both sides of the wire.
 *
 * These live here rather than in lib/data/admins.ts because that module is
 * "server-only": importing it into a client component throws at build. The role
 * names and their labels are needed in both the add dialog (client) and the data
 * layer (server), so they belong in a module neither side is forbidden to touch.
 *
 * ADMIN_ROLES lists every value the database's admin_role type holds, so the TS
 * type and the enum cannot drift. ASSIGNABLE_ROLES is the subset an operator
 * picks from when adding someone — "accountant" is kept for the type and any
 * historic rows, but the platform is organised around the four groups below.
 */

export const ADMIN_ROLES = [
  "owner",
  "platform_admin",
  "kyc_manager",
  "project_approver",
  "accountant",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * The four groups the platform is run by. Order is deliberate: owners first
 * (they hold the platform), then operations, then the two job roles.
 */
export const ASSIGNABLE_ROLES: AdminRole[] = [
  "owner",
  "platform_admin",
  "kyc_manager",
  "project_approver",
];

/** Whether the platform manages this role's on-chain key rather than the person
 *  connecting their own. Only the KYC attestor signs on chain and has no wallet
 *  of their own here — the platform generates, funds and holds it. */
export const PLATFORM_MANAGED_WALLET: Record<AdminRole, boolean> = {
  owner: false,
  platform_admin: false,
  kyc_manager: true,
  project_approver: false,
  accountant: false,
};

/** How each role reads on screen, and what it is for. */
export const ROLE_LABELS: Record<
  AdminRole,
  { label: string; plural: string; blurb: string }
> = {
  owner: {
    label: "Owner",
    plural: "Owners",
    blurb: "Holds a share of the platform and votes on it. Adding one dilutes every other owner.",
  },
  platform_admin: {
    label: "Platform Administrator",
    plural: "Platform Administrators",
    blurb: "Runs the platform — bans abusive users, watches its health. No share, no vote.",
  },
  kyc_manager: {
    label: "KYC Attestor",
    plural: "KYC Attestors",
    blurb: "Reviews and attests identity. The platform manages their signing key; they never connect a wallet.",
  },
  project_approver: {
    label: "Project Administrator",
    plural: "Project Administrators",
    blurb: "Approves routine listings and flags the ones that need an owner vote. Works entirely in the console.",
  },
  accountant: {
    label: "Accountant",
    plural: "Accountants",
    blurb: "Reads the vault, transactions and reports. Changes nothing.",
  },
};
