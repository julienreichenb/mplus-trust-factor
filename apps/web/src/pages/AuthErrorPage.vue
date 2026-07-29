<script setup lang="ts">
import { computed } from "vue";
import { useRoute, RouterLink } from "vue-router";

const route = useRoute();
const error = computed(() => String(route.query.error ?? "unknown"));
const detail = computed(() => String(route.query.detail ?? ""));
</script>

<template>
  <section class="auth-page">
    <h1>Sign-in failed</h1>
    <p class="lede">Battle.net authentication did not complete.</p>
    <p class="code" data-testid="auth-error-code">{{ error }}</p>
    <p v-if="detail" class="detail">{{ detail }}</p>
    <RouterLink class="btn" to="/auth/signin">Try again</RouterLink>
  </section>
</template>

<style scoped>
.auth-page {
  max-width: 36rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}
.lede,
.detail {
  color: var(--color-text-muted, #a8a8b3);
}
.code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  margin: var(--space-4) 0;
}
.btn {
  display: inline-flex;
  padding: 0.7rem 1.1rem;
  border-radius: 0.4rem;
  background: #1f6feb;
  color: #fff;
  text-decoration: none;
}
</style>
