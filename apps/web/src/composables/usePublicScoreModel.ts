import { computed, ref } from "vue";
import type { AdminScoreModelDTO, ScoreModelConfig } from "@mplus/contracts";
import { api } from "../api/client";
import { DIMENSION_LABELS, formatWeight } from "../lib/format";

const models = ref<AdminScoreModelDTO[] | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
let inflight: Promise<void> | null = null;

const PUBLIC_DIMS = ["PERFORMANCE", "SURVIVAL", "UTILITY", "EXPERIENCE"] as const;

const BLURBS: Record<(typeof PUBLIC_DIMS)[number], string> = {
  PERFORMANCE: "Parses and cooldown use",
  SURVIVAL: "Deaths and defensives",
  UTILITY: "Observed toolkit",
  EXPERIENCE: "Exposure and history",
};

export function resetPublicScoreModelCache(): void {
  models.value = null;
  error.value = null;
  loading.value = false;
  inflight = null;
}

function asConfig(value: unknown): ScoreModelConfig | null {
  if (!value || typeof value !== "object") return null;
  const weights = (value as { weights?: unknown }).weights;
  if (!weights || typeof weights !== "object") return null;
  return value as ScoreModelConfig;
}

export function usePublicScoreModel() {
  async function ensure(): Promise<void> {
    if (models.value || inflight) {
      await inflight;
      return;
    }
    loading.value = true;
    error.value = null;
    inflight = api
      .listPublicScoreModels()
      .then((rows) => {
        models.value = rows;
      })
      .catch((err: unknown) => {
        error.value = (err as Error).message;
        models.value = null;
      })
      .finally(() => {
        loading.value = false;
        inflight = null;
      });
    await inflight;
  }

  const active = computed(() => {
    const rows = models.value ?? [];
    return rows.find((row) => row.key === "default") ?? rows[0] ?? null;
  });

  const dimensions = computed(() => {
    const model = active.value;
    const config = asConfig(model?.config);
    return PUBLIC_DIMS.map((dim) => {
      const weight =
        dim === "PERFORMANCE"
          ? config?.weights.performance
          : dim === "SURVIVAL"
            ? config?.weights.survival
            : dim === "UTILITY"
              ? config?.weights.utility
              : config?.weights.experienceConsistency;
      return {
        key: dim,
        label: DIMENSION_LABELS[dim],
        blurb: BLURBS[dim],
        weight,
        weightLabel: weight != null ? formatWeight(weight) : null,
      };
    });
  });

  return { active, dimensions, error, loading, ensure };
}
