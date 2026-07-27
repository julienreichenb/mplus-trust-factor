import { onMounted, onBeforeUnmount, watch, type Ref } from "vue";
import { isWowheadTooltipsEnabled } from "../config/features";
import {
  loadWowheadTooltipScript,
  refreshWowheadTooltips,
  type WowheadTooltipStatus,
} from "../integrations/wowhead/tooltips";

/**
 * Optionally load Wowhead tooltips on character routes.
 * Never blocks rendering; failures degrade to plain links.
 */
export function useWowheadTooltips(enabled: Ref<boolean> | boolean = true) {
  let cancelled = false;

  async function ensure(): Promise<WowheadTooltipStatus | "skipped"> {
    const isEnabled = typeof enabled === "boolean" ? enabled : enabled.value;
    if (!isEnabled || !isWowheadTooltipsEnabled()) return "skipped";
    const status = await loadWowheadTooltipScript();
    if (!cancelled && status === "ready") {
      refreshWowheadTooltips();
    }
    return status;
  }

  onMounted(() => {
    void ensure();
  });

  if (typeof enabled !== "boolean") {
    watch(enabled, () => {
      void ensure();
    });
  }

  onBeforeUnmount(() => {
    cancelled = true;
  });

  return { ensure };
}
