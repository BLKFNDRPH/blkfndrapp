// Who may call each endpoint. Read by scripts/authz-check.mjs, which probes
// every identity below the level and fails on any that gets through, and on any
// route or action missing from this file.
//
// Levels: "public", "user", "admin", "owner", { roles: [...] } (owner is always
// included), "cron" (INDEXER_SECRET bearer token). An action entry may be an
// object: { level, args, refusedWhen, positiveOk, db, why }.
//   args        arguments that pass input validation, so a probe reaches the guard
//   refusedWhen "null": the action refuses by returning null or { x: null }
//   positiveOk  a refusal the allowed caller may still get for a non-auth reason
//   db          the role check is in a database function, named here; the app
//               itself only requires the level given, which is what is probed
//   why         for "db-only" and "untestable": why it is not probed here

const WALLET = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const VAULT = "CBRUIRJXRU6NGHOSF5KMPUOFIXIANCPI43QC6JX2PKNOKD3QSAHPLI2Q";
const UUID = "00000000-0000-4000-8000-000000000001";
const KYC_REVIEWERS = { roles: ["platform_admin", "kyc_manager"] };

export const ROUTES = {
  // Anyone. Reads of public data, the auth round trip, and the email link.
  "GET /api/auth/session": "public",
  "POST /api/auth/logout": "public",
  "POST /api/email/unsubscribe": "public", // the signed token in the link is the credential
  "GET /api/health": "public",
  "GET /api/images/[cid]": "public",
  "GET /api/platform": "public",
  "GET /api/projects": "public",
  "GET /api/projects/[id]": "public",
  "GET /api/projects/[id]/live": "public",
  "GET /api/projects/[id]/record": "public",
  "GET /api/projects/[id]/stake": "public",
  "GET /api/projects/[id]/votes": "public",
  "GET /api/vault-wasm-hash": "public",
  "GET /auth/callback": "public",
  "GET /auth/confirm": "public",

  // Any signed-in account, acting on its own data.
  "POST /api/auth/freighter/disconnect": "user",
  "POST /api/auth/freighter/nonce": "user",
  // A signed-in caller with no challenge on file gets the challenge refusal.
  "POST /api/auth/freighter/verify": { level: "user", positiveOk: /Invalid or expired challenge/ },
  "POST /api/kyc-document": "user",
  "GET /api/me/decisions": "user",
  "GET /api/notifications": "user",
  "PATCH /api/notifications": "user",
  "DELETE /api/notifications": "user",
  "POST /api/upload-image": "user",
  "GET /api/user/contributions": "user",
  "GET /api/user/funds": "user",
  "GET /api/user-by-address": "user",
  "POST /api/user-by-addresses": "user",

  // Any administrator.
  "GET /api/admin/kyc-count": "admin",
  "GET /api/admin/platform-settings": "admin",
  "POST /api/admin/platform-settings": "admin",

  // The scheduler, with INDEXER_SECRET.
  "POST /api/governance-keeper": "cron",
  "GET /api/indexer": "cron",
  "POST /api/indexer": "cron",
  "POST /api/keep-alive": "cron",
  "POST /api/notification-emails": "cron",
  "POST /api/ops-funding": "cron",
  "POST /api/settle-stalled": "cron",
};

export const ACTIONS = {
  // src/actions/admins.ts
  "src/actions/admins.ts#getAdminsAction": "admin",
  "src/actions/admins.ts#getMyRoleAction": "public", // the caller's own role; null when signed out
  "src/actions/admins.ts#grantAdminAction": { level: "owner", args: ["new-admin@authz.test", "", "New Admin", "kyc_manager", ""] },
  "src/actions/admins.ts#revokeAdminAction": { level: "owner", args: ["someone@authz.test"] },
  "src/actions/admins.ts#recognizeWalletAction": { level: "admin", args: [WALLET] },
  "src/actions/admins.ts#getAdminAuditLogAction": "admin",

  // src/actions/categories.ts
  "src/actions/categories.ts#getCategoriesAction": "public",
  "src/actions/categories.ts#addCategoryAction": { level: "admin", args: ["Authz"] },
  "src/actions/categories.ts#removeCategoryAction": { level: "admin", args: ["Authz"] },

  // src/actions/feature-requests.ts
  "src/actions/feature-requests.ts#getFeatureRequestsAction": "public",
  "src/actions/feature-requests.ts#submitFeatureRequestAction": { level: "user", args: ["A request title", "Body"] },
  "src/actions/feature-requests.ts#toggleUpvoteAction": { level: "user", args: [UUID, true] },
  "src/actions/feature-requests.ts#decideFeatureRequestAction": { level: "owner", args: [UUID, true] },
  "src/actions/feature-requests.ts#respondToFeatureRequestAction": { level: "owner", args: [UUID, "note", "shipped"] },

  // src/actions/moderation.ts
  "src/actions/moderation.ts#getUsersAction": { roles: ["platform_admin"] },
  "src/actions/moderation.ts#banUserAction": { level: { roles: ["platform_admin"] }, args: [UUID, "reason"] },
  "src/actions/moderation.ts#unbanUserAction": { level: { roles: ["platform_admin"] }, args: [UUID] },
  "src/actions/moderation.ts#getHealthAction": { roles: ["platform_admin"] },

  // src/actions/project-moderation.ts
  "src/actions/project-moderation.ts#flagProjectAction": { level: "admin", args: ["1", "reason"] },
  "src/actions/project-moderation.ts#voteOnProjectAction": { level: "admin", args: ["1", true], db: "project_approval_votes write policy" },
  "src/actions/project-moderation.ts#clearModerationAction": { level: "admin", args: ["1"] },
  "src/actions/project-moderation.ts#getModerationAction": "public", // whether a listing awaits review
  "src/actions/project-moderation.ts#getPendingReviewsAction": "admin",

  // src/actions/project-restrictions.ts
  "src/actions/project-restrictions.ts#setProjectHiddenAction": { level: "user", args: [VAULT, true, "reason"], db: "set_project_hidden: can_restrict_projects(); no anon execute" },
  "src/actions/project-restrictions.ts#setProjectLockedAction": { level: "user", args: [VAULT, true, "reason"], db: "set_project_locked: can_restrict_projects(); no anon execute" },
  "src/actions/project-restrictions.ts#checkVaultLockAction": "public",

  // src/actions/secrets.ts: the session client calls definer functions that are the boundary.
  "src/actions/secrets.ts#getSecretStatusAction": { level: "db-only", why: "platform_secret_status returns rows only when is_owner(); no anon execute" },
  "src/actions/secrets.ts#setPlatformSecretAction": { level: "db-only", why: "set_platform_secret raises 42501 unless is_owner(); no anon execute" },

  // src/app/actions.ts
  "src/app/actions.ts#runImproveListingQuality": { level: "user", refusedWhen: "null", args: [{ title: "t", description: "d", category: "c", fundingGoal: 1, imageUrl: "" }] },
  "src/app/actions.ts#submitKycRequest": { level: "user", args: [{}] },
  "src/app/actions.ts#remindMeToSetUpWallet": { level: "user", args: ["/profile"] },
  "src/app/actions.ts#attachMyKycWallet": "user",
  "src/app/actions.ts#getMyKycStatus": "user",
  "src/app/actions.ts#getKycRequests": { level: KYC_REVIEWERS, args: ["pending"] },
  "src/app/actions.ts#getKycSubmission": { level: KYC_REVIEWERS, args: [UUID] },
  "src/app/actions.ts#updateKycRequestStatus": { level: KYC_REVIEWERS, args: [UUID, "approved"], positiveOk: /no such submission/ },
  "src/app/actions.ts#attestKycAction": { level: KYC_REVIEWERS, args: [UUID] },
  "src/app/actions.ts#revokeKycAction": { level: KYC_REVIEWERS, args: [UUID] },
  "src/app/actions.ts#getMyManagedAttestorAction": { level: KYC_REVIEWERS, refusedWhen: "null", positiveOk: /./ },
  "src/app/actions.ts#triggerIndexerSync": "admin",
  "src/app/actions.ts#submitMilestoneProof": {
    level: "untestable",
    why: "reads the vault from the chain before requireWalletOwnerOrAdmin(vault.creator); offline the read fails first",
  },

  // src/app/auth/actions.ts: signing in and out is for everyone.
  "src/app/auth/actions.ts#signUpWithPassword": "public",
  "src/app/auth/actions.ts#signInWithPassword": "public",
  "src/app/auth/actions.ts#signInWithGoogle": "public",
  "src/app/auth/actions.ts#requestPasswordReset": "public",
  "src/app/auth/actions.ts#signOut": "public",

  // src/app/email/unsubscribe/actions.ts
  "src/app/email/unsubscribe/actions.ts#unsubscribeFromEmail": "public", // the signed token is the credential

  // src/app/settings/actions.ts
  "src/app/settings/actions.ts#updateUserDisplayName": { level: "user", args: ["New Name"] },
  "src/app/settings/actions.ts#getMyEmailSettings": "user",
  "src/app/settings/actions.ts#setMyEmailPreference": { level: "user", args: ["votes", false] },
};
