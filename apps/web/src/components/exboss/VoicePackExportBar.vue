<script setup lang="ts">
import { ref } from "vue";
import type { PackNameValidation } from "../../lib/exboss-voice-pack-export";
import { MAX_PACK_NAME_LENGTH } from "../../lib/exboss-voice-pack-export";
import DisclosureChevron from "../ability-catalog/DisclosureChevron.vue";

defineProps<{
  packName: string;
  packNameValidation: PackNameValidation;
  addonDirectory: string | null;
  canExport: boolean;
  exporting: boolean;
  exportSuccess: string | null;
  customCount: number;
  totalCount: number;
}>();

const emit = defineEmits<{
  updatePackName: [value: string];
  export: [];
}>();

const installOpen = ref(false);

function onInstallToggle(event: Event): void {
  installOpen.value = (event.target as HTMLDetailsElement).open;
}
</script>

<template>
  <section class="voice-export" data-testid="voice-pack-export">
    <div class="voice-export__pack" data-testid="voice-pack-name-section">
      <label class="voice-export__label" for="voice-pack-name-input">Pack name</label>
      <input
        id="voice-pack-name-input"
        class="voice-export__input"
        type="text"
        autocomplete="off"
        :maxlength="MAX_PACK_NAME_LENGTH"
        data-testid="voice-pack-name-input"
        :value="packName"
        :disabled="exporting"
        :aria-invalid="!packNameValidation.ok ? 'true' : 'false'"
        :aria-describedby="
          ['voice-pack-addon-id', !packNameValidation.ok ? 'voice-pack-name-error' : null]
            .filter(Boolean)
            .join(' ')
        "
        @input="emit('updatePackName', ($event.target as HTMLInputElement).value)"
      />
      <p
        id="voice-pack-addon-id"
        class="voice-export__addon mpts-data"
        data-testid="voice-pack-addon-directory"
      >
        <span class="voice-export__addon-label">Addon folder</span>
        <span>{{ addonDirectory ?? "—" }}</span>
      </p>
      <p
        v-if="!packNameValidation.ok"
        id="voice-pack-name-error"
        class="voice-export__error"
        role="alert"
        data-testid="voice-pack-name-error"
      >
        {{ packNameValidation.message }}
      </p>
    </div>

    <div class="voice-export__actions">
      <p class="voice-export__counts" data-testid="voice-pack-export-counts">
        Custom {{ customCount }} · Original {{ totalCount - customCount }}
      </p>
      <button
        type="button"
        class="btn primary"
        data-testid="voice-pack-download"
        :disabled="!canExport || exporting"
        :aria-busy="exporting ? 'true' : 'false'"
        :aria-disabled="!canExport || exporting ? 'true' : 'false'"
        @click="emit('export')"
      >
        {{ exporting ? "Generating ZIP…" : "Download ZIP" }}
      </button>
      <p
        v-if="exportSuccess"
        class="voice-export__success"
        role="status"
        data-testid="voice-pack-export-success"
      >
        {{ exportSuccess }}
      </p>
    </div>

    <details
      class="voice-export__install"
      data-testid="voice-pack-install-guidance"
      @toggle="onInstallToggle"
    >
      <summary class="voice-export__install-summary">
        <DisclosureChevron :expanded="installOpen" />
        <span class="voice-export__install-title">How to Install in WoW</span>
        <span class="voice-export__install-hint">4 quick steps</span>
      </summary>
      <ol class="voice-export__install-steps">
        <li>
          <span class="voice-export__step-num" aria-hidden="true">1</span>
          <span>
            Drop the ZIP’s addon folder into
            <code class="mpts-data">World of Warcraft/_retail_/Interface/AddOns/</code>
          </span>
        </li>
        <li>
          <span class="voice-export__step-num" aria-hidden="true">2</span>
          <span>
            Keep <strong>EXBOSS-ENG</strong> installed — original alerts still use it.
          </span>
        </li>
        <li>
          <span class="voice-export__step-num" aria-hidden="true">3</span>
          <span>Reload the UI with <code class="mpts-data">/reload</code>.</span>
        </li>
        <li>
          <span class="voice-export__step-num" aria-hidden="true">4</span>
          <span>Pick your pack by name in ExBoss. Done.</span>
        </li>
      </ol>
    </details>
  </section>
</template>

<style scoped>
.voice-export {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.voice-export__pack {
  display: grid;
  gap: var(--space-2);
  max-width: 36rem;
}

.voice-export__label {
  font-weight: 600;
}

.voice-export__input {
  width: 100%;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}

.voice-export__input:focus-visible {
  outline: 2px solid var(--color-brand);
  outline-offset: 2px;
}

.voice-export__addon {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.voice-export__addon-label {
  font-weight: 600;
  color: var(--color-text);
}

.voice-export__error {
  margin: 0;
  color: var(--color-danger-500, #ef4444);
  font-size: var(--text-sm);
}

.voice-export__actions {
  display: grid;
  gap: var(--space-3);
  justify-items: start;
}

.voice-export__counts {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.voice-export__success {
  margin: 0;
  color: var(--color-success-500);
  font-size: var(--text-sm);
}

.voice-export__install {
  max-width: 40rem;
  border: 1px dashed color-mix(in srgb, var(--color-gold-300) 45%, var(--color-border));
  border-radius: var(--radius-card);
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--color-amber-400) 8%, transparent),
      transparent 55%
    ),
    var(--color-surface-hover);
  overflow: hidden;
}

.voice-export__install-summary {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.7rem 0.85rem;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.voice-export__install-summary::-webkit-details-marker {
  display: none;
}

.voice-export__install-summary:hover,
.voice-export__install-summary:focus-visible {
  background: color-mix(in srgb, var(--color-amber-400) 10%, transparent);
}

.voice-export__install-title {
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.01em;
}

.voice-export__install-hint {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  font-weight: 600;
}

.voice-export__install[open] .voice-export__install-hint {
  opacity: 0.55;
}

.voice-export__install-steps {
  margin: 0;
  padding: 0 var(--space-3) var(--space-3);
  list-style: none;
  display: grid;
  gap: 0.55rem;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.voice-export__install-steps li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: start;
}

.voice-export__step-num {
  display: grid;
  place-items: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-amber-400) 22%, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-amber-500) 45%, var(--color-border));
  color: var(--color-gold-300);
  font-size: var(--text-xs);
  font-weight: 800;
  line-height: 1;
}

@media (min-width: 720px) {
  .voice-export {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .voice-export__install {
    grid-column: 1 / -1;
  }
}
</style>
