<script setup lang="ts">
import { RouterView } from "vue-router";
import AppHeader from "./components/layout/AppHeader.vue";
</script>

<template>
  <div class="shell">
    <AppHeader />
    <main>
      <RouterView />
    </main>
  </div>
</template>
