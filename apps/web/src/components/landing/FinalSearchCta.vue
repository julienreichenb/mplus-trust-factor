<script setup lang="ts">
import CharacterSearchForm from "../search/CharacterSearchForm.vue";
</script>

<template>
  <section id="final-cta" class="cta" aria-labelledby="cta-title" data-testid="final-search-cta">
    <header>
      <p class="eyebrow">Ready to screen</p>
      <h2 id="cta-title">Look up a character</h2>
      <p>Region, realm and name — same search as the hero, with recent history when available.</p>
    </header>
    <CharacterSearchForm submit-label="Open trust profile" form-id="final-character-search" />
  </section>
</template>

<style scoped>
.cta {
  display: grid;
  gap: var(--space-6);
  padding: var(--space-8) 0 0;
  border-top: 1px solid var(--color-border);
}

.eyebrow {
  margin: 0 0 var(--space-2);
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-gold-300);
}

header h2 {
  margin: 0 0 var(--space-3);
}

header p {
  margin: 0;
  max-width: 36rem;
}
</style>
