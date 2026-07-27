import { createRouter, createWebHistory } from "vue-router";
import { routeDefs } from "./routes";

export const router = createRouter({
  history: createWebHistory(),
  routes: routeDefs,
});
