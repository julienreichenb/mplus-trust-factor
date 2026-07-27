<script setup lang="ts">
import { computed } from "vue";
import type { WclVisibilityState } from "@mplus/contracts";
import StatusBanner from "../common/StatusBanner.vue";

const props = defineProps<{
  visibility: WclVisibilityState | null | undefined;
}>();

const message = computed(() => {
  switch (props.visibility) {
    case "HIDDEN":
      return "This character is hidden on Warcraft Logs. Detailed log analysis is limited and confidence is reduced.";
    case "NO_PUBLIC_LOGS":
      return "No public Warcraft Logs reports were found for this character. Performance metrics may rely on other sources.";
    case "PRIVATE_SKIPPED":
      return "Some Warcraft Logs reports are private and were skipped during analysis.";
    case "PUBLIC":
    default:
      return null;
  }
});
</script>

<template>
  <span v-if="visibility" class="sr-only" data-testid="wcl-visibility">{{ visibility }}</span>
  <StatusBanner
    v-if="message"
    tone="warn"
    title="Warcraft Logs visibility"
    data-testid="wcl-visibility-banner"
  >
    {{ message }}
  </StatusBanner>
</template>
