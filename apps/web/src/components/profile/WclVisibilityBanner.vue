<script setup lang="ts">
import { computed } from "vue";
import type { WclDataState, WclVisibilityState } from "@mplus/contracts";
import StatusBanner from "../common/StatusBanner.vue";

const props = defineProps<{
  visibility: WclVisibilityState | null | undefined;
  dataState?: WclDataState | null | undefined;
}>();

const message = computed(() => {
  if (props.visibility === "HIDDEN") {
    return "This character is hidden on Warcraft Logs. Detailed log analysis is limited and confidence is reduced.";
  }
  if (props.visibility === "PUBLIC" && props.dataState === "NO_MATCHED_RUN") {
    return "Public profile — no combat logs matched to selected runs.";
  }
  if (props.visibility === "PUBLIC" && props.dataState === "RANKINGS_ONLY") {
    return "Public rankings contributed; detailed combat analysis unavailable.";
  }
  switch (props.dataState) {
    case "NO_PUBLIC_LOGS":
      return "No public Warcraft Logs reports were found for this character. Performance metrics may rely on other sources.";
    case "RATE_LIMITED":
      return "Warcraft Logs enrichment was rate-limited. Existing snapshot data is shown when available.";
    case "UNAVAILABLE":
      return "Warcraft Logs was unavailable during enrichment. Existing snapshot data is shown when available.";
    default:
      return null;
  }
});

const testIdValue = computed(() => props.visibility ?? "");
</script>

<template>
  <span v-if="visibility" class="sr-only" data-testid="wcl-visibility">{{ testIdValue }}</span>
  <span v-if="dataState" class="sr-only" data-testid="wcl-data-state">{{ dataState }}</span>
  <StatusBanner
    v-if="message"
    tone="warn"
    title="Warcraft Logs visibility"
    data-testid="wcl-visibility-banner"
  >
    {{ message }}
  </StatusBanner>
</template>
