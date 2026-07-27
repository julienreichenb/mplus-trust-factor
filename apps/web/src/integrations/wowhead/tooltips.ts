/**
 * Isolated Wowhead tooltip loader (official tooltip script only).
 * Progressive enhancement — never required for equipment usability.
 */

export type WowheadTooltipStatus = "idle" | "loading" | "ready" | "failed";

export interface WowheadTooltipConfig {
  colorLinks: boolean;
  iconizeLinks: boolean;
  renameLinks: boolean;
}

declare global {
  interface Window {
    whTooltips?: WowheadTooltipConfig;
  }
}

const TOOLTIP_SCRIPT_URL = "https://wow.zamimg.com/js/tooltips.js";
const SCRIPT_ATTR = "data-mpts-wowhead-tooltips";

let status: WowheadTooltipStatus = "idle";
let loadPromise: Promise<WowheadTooltipStatus> | null = null;

export function getWowheadTooltipStatus(): WowheadTooltipStatus {
  return status;
}

export function isWowheadTooltipReady(): boolean {
  return status === "ready";
}

function findExistingScript(): HTMLScriptElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLScriptElement>(`script[${SCRIPT_ATTR}]`);
}

function applyTooltipConfig(): void {
  if (typeof window === "undefined") return;
  window.whTooltips = {
    colorLinks: false,
    iconizeLinks: false,
    renameLinks: false,
  };
}

/**
 * Idempotent client-side loader. Failures stay failed for the session (no retry loop).
 */
export function loadWowheadTooltipScript(): Promise<WowheadTooltipStatus> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    status = "failed";
    return Promise.resolve(status);
  }

  if (status === "ready") return Promise.resolve(status);
  if (status === "failed") return Promise.resolve(status);
  if (loadPromise) return loadPromise;

  applyTooltipConfig();

  const existing = findExistingScript();
  if (existing) {
    status = "ready";
    return Promise.resolve(status);
  }

  status = "loading";
  loadPromise = new Promise<WowheadTooltipStatus>((resolve) => {
    const script = document.createElement("script");
    script.src = TOOLTIP_SCRIPT_URL;
    script.async = true;
    script.setAttribute(SCRIPT_ATTR, "true");
    script.onload = () => {
      status = "ready";
      resolve(status);
    };
    script.onerror = () => {
      status = "failed";
      if (import.meta.env.DEV) {
        console.warn("[mpts] Wowhead tooltip script failed to load");
      }
      resolve(status);
    };
    document.head.append(script);
  });

  return loadPromise;
}

/** Soft refresh hook for Wowhead after dynamic link insertion. */
export function refreshWowheadTooltips(): void {
  if (status !== "ready" || typeof window === "undefined") return;
  const maybeRefresh = (window as Window & { $WowheadPower?: { refreshLinks?: () => void } })
    .$WowheadPower;
  try {
    maybeRefresh?.refreshLinks?.();
  } catch {
    // Ignore third-party refresh errors — links remain usable.
  }
}

/** Test helper — resets module state and removes injected scripts. */
export function resetWowheadTooltipLoader(): void {
  status = "idle";
  loadPromise = null;
  if (typeof document !== "undefined") {
    findExistingScript()?.remove();
  }
  if (typeof window !== "undefined") {
    delete window.whTooltips;
  }
}
