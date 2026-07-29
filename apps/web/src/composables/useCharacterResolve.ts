import { getCurrentInstance, onBeforeUnmount, ref, type Ref } from "vue";
import { api } from "../api/client";
import type { CharacterResolveResponse, RealmOption, SearchUiState } from "../api/types";

export interface CharacterResolveController {
  uiState: Ref<SearchUiState>;
  message: Ref<string | null>;
  profilePath: Ref<string | null>;
  resolving: Ref<boolean>;
  resolve: (input: {
    name: string;
    realm: RealmOption;
    forceRetry?: boolean;
  }) => Promise<CharacterResolveResponse | null>;
  retry: () => Promise<CharacterResolveResponse | null>;
  cancel: () => void;
  reset: () => void;
}

/**
 * Explicit search resolution state machine.
 * Navigating away cancels an in-flight resolve via onBeforeUnmount.
 */
export function useCharacterResolve(): CharacterResolveController {
  const uiState = ref<SearchUiState>("IDLE");
  const message = ref<string | null>(null);
  const profilePath = ref<string | null>(null);
  const resolving = ref(false);

  let lastInput: { name: string; realm: RealmOption } | null = null;
  let aborted = false;
  let inFlight = false;

  function cancel(): void {
    aborted = true;
    inFlight = false;
    resolving.value = false;
  }

  function reset(): void {
    cancel();
    aborted = false;
    uiState.value = "IDLE";
    message.value = null;
    profilePath.value = null;
    lastInput = null;
  }

  async function resolve(input: {
    name: string;
    realm: RealmOption;
    forceRetry?: boolean;
  }): Promise<CharacterResolveResponse | null> {
    if (inFlight) return null;
    inFlight = true;
    aborted = false;
    lastInput = { name: input.name, realm: input.realm };
    resolving.value = true;
    uiState.value = "VALIDATING";
    message.value = null;
    profilePath.value = null;

    const name = input.name.trim();
    const realm = input.realm;
    if (!name || !realm?.slug) {
      uiState.value = "TERMINAL_ERROR";
      message.value = "Character name and realm are required.";
      resolving.value = false;
      inFlight = false;
      return {
        status: "FAILED",
        retryable: false,
        message: message.value,
      };
    }

    uiState.value = "RESOLVING";
    try {
      const result = await api.resolveCharacter({
        name,
        realmSlug: realm.slug,
        region: (realm.region ?? "EU") as never,
        forceRetry: input.forceRetry === true,
      });
      if (aborted) return null;

      if (result.status === "READY") {
        uiState.value = "READY";
        profilePath.value = result.profilePath;
        resolving.value = false;
        inFlight = false;
        return result;
      }

      if (result.status === "NOT_FOUND") {
        uiState.value = "NOT_FOUND";
        message.value = result.message;
        resolving.value = false;
        inFlight = false;
        return result;
      }

      if (result.status === "PROVIDER_UNAVAILABLE") {
        uiState.value = "RETRYABLE_ERROR";
        message.value = result.message;
        resolving.value = false;
        inFlight = false;
        return result;
      }

      if (result.status === "FAILED") {
        uiState.value = result.retryable ? "RETRYABLE_ERROR" : "TERMINAL_ERROR";
        message.value = result.message;
        resolving.value = false;
        inFlight = false;
        return result;
      }

      uiState.value = result.status;
      profilePath.value = result.profilePath;
      resolving.value = false;
      inFlight = false;
      return result;
    } catch (error) {
      if (aborted) return null;
      uiState.value = "RETRYABLE_ERROR";
      message.value = error instanceof Error ? error.message : "Search failed. Please retry.";
      resolving.value = false;
      inFlight = false;
      return {
        status: "PROVIDER_UNAVAILABLE",
        retryable: true,
        message: message.value,
      };
    }
  }

  async function retry(): Promise<CharacterResolveResponse | null> {
    if (!lastInput) return null;
    return resolve({ ...lastInput, forceRetry: true });
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(cancel);
  }

  return {
    uiState,
    message,
    profilePath,
    resolving,
    resolve,
    retry,
    cancel,
    reset,
  };
}
