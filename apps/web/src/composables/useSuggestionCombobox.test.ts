import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { nextTick, ref } from "vue";
import { useSuggestionCombobox } from "./useSuggestionCombobox";

describe("useSuggestionCombobox", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces, aborts prior fetch, and respects minLength 2", async () => {
    const fetchSuggestions = vi.fn(async (q: string, signal: AbortSignal) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      return [{ id: q }];
    });
    const query = ref("");
    const box = useSuggestionCombobox({
      query,
      fetchSuggestions,
      debounceMs: 250,
      minLength: 2,
    });

    query.value = "a";
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchSuggestions).not.toHaveBeenCalled();

    query.value = "ab";
    await vi.advanceTimersByTimeAsync(100);
    query.value = "abc";
    await vi.advanceTimersByTimeAsync(250);
    await nextTick();

    expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchSuggestions.mock.calls[0]?.[0]).toBe("abc");
    expect(box.suggestions.value).toEqual([{ id: "abc" }]);
    expect(box.open.value).toBe(true);
  });

  it("closes on Escape", async () => {
    const query = ref("wall");
    const box = useSuggestionCombobox({
      query,
      fetchSuggestions: async () => [{ id: "1" }],
      debounceMs: 0,
      minLength: 2,
    });
    await box.search("wall");
    expect(box.open.value).toBe(true);
    box.onKeydown(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(box.open.value).toBe(false);
  });

  it("aborts in-flight search when query drops below minLength and ignores late results", async () => {
    const deferred: {
      resolve?: (value: Array<{ id: string }>) => void;
      signal?: AbortSignal;
    } = {};
    const fetchSuggestions = vi.fn(
      (_q: string, signal: AbortSignal) =>
        new Promise<Array<{ id: string }>>((resolve, reject) => {
          deferred.signal = signal;
          deferred.resolve = resolve;
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const query = ref("");
    const box = useSuggestionCombobox({
      query,
      fetchSuggestions,
      debounceMs: 250,
      minLength: 2,
    });

    query.value = "wa";
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    expect(box.loading.value).toBe(true);

    query.value = "w";
    await vi.advanceTimersByTimeAsync(250);
    await nextTick();

    expect(deferred.signal?.aborted).toBe(true);
    expect(box.suggestions.value).toEqual([]);
    expect(box.open.value).toBe(false);
    expect(box.loading.value).toBe(false);

    deferred.resolve?.([{ id: "stale" }]);
    await nextTick();
    await Promise.resolve();

    expect(box.suggestions.value).toEqual([]);
    expect(box.open.value).toBe(false);
  });
});
