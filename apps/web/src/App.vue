<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
import { resolveApiMode } from "./api/client";

const apiMode = resolveApiMode();
</script>

<template>
  <div class="shell">
    <header>
      <p class="brand"><span>M+</span> Trust Factor</p>
      <nav class="nav" aria-label="Primary">
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/compare">Compare</RouterLink>
        <RouterLink to="/admin/models">Admin</RouterLink>
      </nav>
      <span class="mode-pill" data-testid="api-mode">API: {{ apiMode }}</span>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>
