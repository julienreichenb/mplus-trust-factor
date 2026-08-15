import { ref } from "vue";
import type { PublicScoringContextDTO } from "@mplus/contracts";
import { api } from "../api/client";

const data = ref<PublicScoringContextDTO | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
let inflight: Promise<void> | null = null;

export function resetPublishedScoringContextCache(): void {
  data.value = null;
  error.value = null;
  loading.value = false;
  inflight = null;
}

export function usePublishedScoringContext() {
  async function ensure(): Promise<void> {
    if (data.value || inflight) {
      await inflight;
      return;
    }
    loading.value = true;
    error.value = null;
    inflight = api
      .getPublishedScoringContext()
      .then((response) => {
        data.value = response;
      })
      .catch((err: unknown) => {
        error.value = (err as Error).message;
        data.value = null;
      })
      .finally(() => {
        loading.value = false;
        inflight = null;
      });
    await inflight;
  }

  return { data, error, loading, ensure };
}
