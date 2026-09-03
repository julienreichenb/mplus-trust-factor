import type { RouteRecordRaw } from "vue-router";
import type { AdminDestinationId } from "./lib/adminNav";

declare module "vue-router" {
  interface RouteMeta {
    requiresAuth?: boolean;
    adminDestinationId?: AdminDestinationId;
  }
}

export const routeDefs: RouteRecordRaw[] = [
  { path: "/", name: "home", component: () => import("./pages/HomePage.vue") },
  {
    path: "/character/:region/:realm/:name",
    name: "character",
    component: () => import("./pages/CharacterPage.vue"),
    props: true,
  },
  { path: "/compare", name: "compare", component: () => import("./pages/ComparePage.vue") },
  { path: "/faq", name: "faq", component: () => import("./pages/FaqPage.vue") },
  {
    path: "/tools/exboss-voice-pack",
    name: "exboss-voice-pack",
    component: () => import("./pages/ExBossVoicePackPage.vue"),
  },
  {
    path: "/auth/signin",
    name: "auth-signin",
    component: () => import("./pages/AuthSignInPage.vue"),
  },
  {
    path: "/auth/error",
    name: "auth-error",
    component: () => import("./pages/AuthErrorPage.vue"),
  },
  {
    path: "/account",
    name: "account",
    component: () => import("./pages/AccountPage.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/access-denied",
    name: "access-denied",
    component: () => import("./pages/AccessDeniedPage.vue"),
  },
  {
    path: "/admin/scoring/:tab?",
    name: "admin-scoring",
    component: () => import("./pages/AdminScoringConsolePage.vue"),
    meta: { adminDestinationId: "score-console" },
  },
  {
    path: "/admin/characters/:characterId",
    name: "admin-character",
    component: () => import("./pages/AdminCharacterPage.vue"),
    props: true,
    meta: { adminDestinationId: "admin-users" },
  },
  {
    path: "/admin/ability-catalog/:tab?",
    name: "admin-ability-catalog",
    component: () => import("./pages/AdminAbilityCatalogConsolePage.vue"),
    meta: { adminDestinationId: "ability-catalog" },
  },
  {
    path: "/admin/users",
    name: "admin-users",
    component: () => import("./pages/AdminUsersPage.vue"),
    meta: { adminDestinationId: "admin-users" },
  },
  {
    path: "/admin/bulk-processing",
    name: "admin-bulk-processing",
    component: () => import("./pages/AdminBulkProcessingPage.vue"),
    meta: { adminDestinationId: "bulk-processing" },
  },
  {
    path: "/admin/calibration/runs/:runId",
    name: "admin-calibration-report",
    component: () => import("./pages/AdminCalibrationReportPage.vue"),
    meta: { adminDestinationId: "score-console" },
  },
  {
    path: "/admin/faq",
    name: "admin-faq",
    component: () => import("./pages/AdminFaqPage.vue"),
    meta: { adminDestinationId: "admin-faq" },
  },
  {
    path: "/admin/misc",
    name: "admin-misc",
    component: () => import("./pages/AdminMiscPage.vue"),
    meta: { adminDestinationId: "admin-misc" },
  },
  // Legacy deep links → Scoring console tabs
  { path: "/admin/models", redirect: "/admin/scoring/models" },
  { path: "/admin/tuning", redirect: "/admin/scoring/tuning" },
  {
    path: "/admin/calibration/:cohortId?",
    redirect: (to) => ({
      path: "/admin/scoring/calibration",
      query: to.params.cohortId ? { cohort: String(to.params.cohortId) } : {},
    }),
  },
];
