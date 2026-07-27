import { onBeforeUnmount, ref, shallowRef } from "vue";

/**
 * Abort in-flight requests on route leave / remount.
 */
export function useAbortableQuery() {
  const controller = shallowRef<AbortController | null>(null);
  const aborted = ref(false);

  function nextSignal(): AbortSignal {
    controller.value?.abort();
    const c = new AbortController();
    controller.value = c;
    aborted.value = false;
    return c.signal;
  }

  function abort(): void {
    aborted.value = true;
    controller.value?.abort();
  }

  onBeforeUnmount(abort);

  return { nextSignal, abort, aborted };
}
