/** Canonical permission keys for server-side RBAC. */
export const PERMISSIONS = {
  PROFILE_REFRESH_REQUEST: "profile.refresh.request",
  PROFILE_REFRESH_FORCE: "profile.refresh.force",
  PROFILE_REFRESH_COOLDOWN_BYPASS: "profile.refresh.cooldown_bypass",
  PROVIDER_DIAGNOSTICS_READ: "provider.diagnostics.read",
  SCORE_CANDIDATE_READ: "score.candidate.read",
  SCORE_RECALCULATE: "score.recalculate",
  ADMIN_USERS_READ: "admin.users.read",
  ADMIN_USERS_MANAGE: "admin.users.manage",
  ADMIN_JOBS_MANAGE: "admin.jobs.manage",
  ADMIN_SETTINGS_MANAGE: "admin.settings.manage",
  ADMIN_SCORE_MODELS_MANAGE: "admin.score_models.manage",
  ADMIN_MECHANIC_RULES_MANAGE: "admin.mechanic_rules.manage",
  ADMIN_ABILITY_CATALOG_READ: "admin.ability_catalog.read",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_KEYS = {
  USER: "user",
  ADMIN: "admin",
} as const;

export const DEFAULT_USER_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.PROFILE_REFRESH_REQUEST,
];

export const DEFAULT_ADMIN_PERMISSIONS: PermissionKey[] = [
  ...DEFAULT_USER_PERMISSIONS,
  PERMISSIONS.PROFILE_REFRESH_FORCE,
  PERMISSIONS.PROFILE_REFRESH_COOLDOWN_BYPASS,
  PERMISSIONS.PROVIDER_DIAGNOSTICS_READ,
  PERMISSIONS.SCORE_CANDIDATE_READ,
  PERMISSIONS.SCORE_RECALCULATE,
  PERMISSIONS.ADMIN_USERS_READ,
  PERMISSIONS.ADMIN_USERS_MANAGE,
  PERMISSIONS.ADMIN_JOBS_MANAGE,
  PERMISSIONS.ADMIN_SETTINGS_MANAGE,
  PERMISSIONS.ADMIN_SCORE_MODELS_MANAGE,
  PERMISSIONS.ADMIN_MECHANIC_RULES_MANAGE,
  PERMISSIONS.ADMIN_ABILITY_CATALOG_READ,
];

export const BATTLENET_PROVIDER = "battlenet";
export const SESSION_COOKIE_PATH = "/";
