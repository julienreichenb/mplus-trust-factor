<script setup lang="ts">
import { RouterLink } from "vue-router";
</script>

<template>
  <section class="denied">
    <h1>Access denied</h1>
    <p>You do not have permission to view this page.</p>
    <div class="actions">
      <RouterLink class="btn" to="/">Home</RouterLink>
      <RouterLink class="btn btn--ghost" to="/account">Account</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.denied {
  max-width: 36rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}
.actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-4);
}
.btn {
  display: inline-flex;
  padding: 0.7rem 1.1rem;
  border-radius: 0.4rem;
  background: #1f6feb;
  color: #fff;
  text-decoration: none;
}
.btn--ghost {
  background: transparent;
  border: 1px solid rgb(255 255 255 / 16%);
}
</style>
