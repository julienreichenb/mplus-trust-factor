import type { RouteRecordRaw } from "vue-router";

export const routeDefs: RouteRecordRaw[] = [
  { path: "/", name: "home", component: () => import("./pages/HomePage.vue") },
  {
    path: "/character/:region/:realm/:name",
    name: "character",
    component: () => import("./pages/CharacterPage.vue"),
    props: true,
  },
  { path: "/compare", name: "compare", component: () => import("./pages/ComparePage.vue") },
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
    path: "/admin/models",
    name: "admin-models",
    component: () => import("./pages/AdminModelsPage.vue"),
    meta: { requiresAdmin: true },
  },
  {
    path: "/admin/ability-catalog",
    name: "admin-ability-catalog",
    component: () => import("./pages/AdminAbilityCatalogPage.vue"),
    meta: { requiresAdmin: true },
  },
  {
    path: "/admin/users",
    name: "admin-users",
    component: () => import("./pages/AdminUsersPage.vue"),
    meta: { requiresAdmin: true },
  },
  {
    path: "/admin/bulk-processing",
    name: "admin-bulk-processing",
    component: () => import("./pages/AdminBulkProcessingPage.vue"),
    meta: { requiresAdmin: true },
  },
];
