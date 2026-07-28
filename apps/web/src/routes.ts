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
    path: "/admin/models",
    name: "admin-models",
    component: () => import("./pages/AdminModelsPage.vue"),
  },
  {
    path: "/admin/ability-catalog",
    name: "admin-ability-catalog",
    component: () => import("./pages/AdminAbilityCatalogPage.vue"),
  },
];
