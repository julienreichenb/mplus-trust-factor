<script setup lang="ts">
defineProps<{
  sources: Array<{ provider: string; fetchedAt: string; url: string | null }>;
  raiderIoUsed: boolean;
  modelKey?: string | null;
  modelVersion?: number | null;
  calculatedAt?: string | null;
}>();
</script>

<template>
  <footer class="sources" aria-labelledby="sources-title">
    <h2 id="sources-title">Sources & model</h2>
    <ul>
      <li v-for="s in sources" :key="s.provider + s.fetchedAt">
        <strong>{{ s.provider }}</strong>
        · fetched {{ new Date(s.fetchedAt).toLocaleString() }}
        <template v-if="s.url">
          ·
          <a :href="s.url" rel="noopener noreferrer" target="_blank">Open</a>
        </template>
      </li>
    </ul>
    <p v-if="raiderIoUsed" class="rio" data-testid="raiderio-attribution">
      Includes data from
      <a href="https://raider.io" rel="noopener noreferrer" target="_blank">Raider.IO</a>
      where noted above. Attribution required for public Raider.IO usage.
    </p>
    <p class="model">
      Model {{ modelKey ?? "—" }} v{{ modelVersion ?? "—" }}
      <span v-if="calculatedAt"> · calculated {{ new Date(calculatedAt).toLocaleString() }}</span>
    </p>
  </footer>
</template>

<style scoped>
.sources {
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

ul {
  padding-left: 1.1rem;
}

.rio,
.model {
  color: var(--muted);
  font-size: 0.9rem;
}
</style>
