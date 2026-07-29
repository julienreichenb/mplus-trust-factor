<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";
const me = ref<{
  authenticated: boolean;
  user?: { id: string; displayName: string | null; roles: string[]; permissions: string[] };
} | null>(null);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const response = await fetch(`${apiBase}/api/v1/auth/me`, { credentials: "include" });
    me.value = await response.json();
  } catch {
    error.value = "Unable to reach the API.";
  }
});

function signIn(): void {
  const returnTo = encodeURIComponent("/account");
  window.location.href = `${apiBase}/api/v1/auth/battlenet/start?returnTo=${returnTo}`;
}

async function signOut(): Promise<void> {
  await fetch(`${apiBase}/api/v1/auth/logout`, { method: "POST", credentials: "include" });
  me.value = { authenticated: false };
}
</script>

<template>
  <section class="auth-page">
    <h1>Sign in</h1>
    <p class="lede">
      Authenticate with Battle.net to verify character ownership. Ownership links stay private and
      never alter public Trust Scores.
    </p>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="me?.authenticated">
      <p>
        Signed in as <strong>{{ me.user?.displayName ?? me.user?.id }}</strong>
      </p>
      <div class="actions">
        <RouterLink class="btn" to="/account">Account settings</RouterLink>
        <button type="button" class="btn btn--ghost" @click="signOut">Sign out</button>
      </div>
    </template>
    <template v-else-if="me">
      <button type="button" class="btn" data-testid="battlenet-signin" @click="signIn">
        Continue with Battle.net
      </button>
    </template>
  </section>
</template>

<style scoped>
.auth-page {
  max-width: 36rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}
.lede {
  color: var(--color-text-muted, #a8a8b3);
  margin-bottom: var(--space-5);
}
.actions {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.7rem 1.1rem;
  border-radius: 0.4rem;
  border: 1px solid rgb(255 255 255 / 16%);
  background: #1f6feb;
  color: #fff;
  text-decoration: none;
  cursor: pointer;
  font: inherit;
}
.btn--ghost {
  background: transparent;
}
.error {
  color: #f87171;
}
</style>
