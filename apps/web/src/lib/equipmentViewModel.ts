import type { EquipmentSummary } from "../api/types";
import { isWowheadLinksEnabled } from "../config/features";
import { wowheadItemUrl } from "../integrations/wowhead/urls";
import {
  readOptionalHttpsUrl,
  readOptionalPositiveInt,
  readOptionalString,
  sanitizeHttpsUrl,
} from "./safeUrl";

export interface EquipmentGemViewModel {
  name: string;
}

export interface EquipmentItemViewModel {
  id: string;
  slot: string;
  slotLabel: string;
  itemId: number | null;
  name: string | null;
  itemLevel: number | null;
  quality: string | null;
  iconUrl: string | null;
  externalUrl: string | null;
  enchantment: string | null;
  gems: readonly EquipmentGemViewModel[];
  isAvailable: boolean;
  isKnownSlot: boolean;
}

export interface EquipmentViewModel {
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  items: EquipmentItemViewModel[];
  filledCount: number;
}

const EQUIPMENT_SLOT_DEFS: Array<{ id: string; label: string; match: RegExp }> = [
  { id: "head", label: "Head", match: /^head$/i },
  { id: "neck", label: "Neck", match: /^neck$/i },
  { id: "shoulders", label: "Shoulders", match: /shoulder/i },
  { id: "back", label: "Back", match: /^(back|cloak)$/i },
  { id: "chest", label: "Chest", match: /^chest$/i },
  { id: "wrist", label: "Wrists", match: /wrist/i },
  { id: "hands", label: "Hands", match: /hand|glove/i },
  { id: "waist", label: "Waist", match: /waist|belt/i },
  { id: "legs", label: "Legs", match: /leg/i },
  { id: "feet", label: "Feet", match: /feet|boot/i },
  { id: "finger-1", label: "Ring 1", match: /finger|ring/i },
  { id: "finger-2", label: "Ring 2", match: /finger|ring/i },
  { id: "trinket-1", label: "Trinket 1", match: /trinket/i },
  { id: "trinket-2", label: "Trinket 2", match: /trinket/i },
  { id: "main-hand", label: "Main Hand", match: /main.?hand|weapon/i },
  { id: "off-hand", label: "Off Hand", match: /off.?hand|shield/i },
];

function emptyKnownSlots(): EquipmentItemViewModel[] {
  return EQUIPMENT_SLOT_DEFS.map((def) => ({
    id: def.id,
    slot: def.id,
    slotLabel: def.label,
    itemId: null,
    name: null,
    itemLevel: null,
    quality: null,
    iconUrl: null,
    externalUrl: null,
    enchantment: null,
    gems: [],
    isAvailable: false,
    isKnownSlot: true,
  }));
}

function humanizeUnknownSlot(slot: string): string {
  const cleaned = slot.trim().replace(/[_-]+/g, " ");
  if (!cleaned) return "Unknown slot";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseGems(source: object): EquipmentGemViewModel[] {
  const record = source as Record<string, unknown>;
  const raw = record.gems;
  if (!Array.isArray(raw)) return [];
  const gems: EquipmentGemViewModel[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const name = readOptionalString(entry, ["name", "label"]);
    if (name) gems.push({ name });
  }
  return gems;
}

function enrichFromRawItem(item: object): {
  itemId: number | null;
  quality: string | null;
  iconUrl: string | null;
  enchantment: string | null;
  gems: readonly EquipmentGemViewModel[];
  externalUrl: string | null;
} {
  const itemId = readOptionalPositiveInt(item, ["itemId", "id"]);
  const quality = readOptionalString(item, ["quality", "qualityName"]);
  const iconUrl = readOptionalHttpsUrl(item, ["iconUrl", "icon"]);
  const enchantment = readOptionalString(item, ["enchantment", "enchant"]);
  const gems = parseGems(item);

  let externalUrl: string | null = null;
  if (isWowheadLinksEnabled() && itemId != null) {
    externalUrl = wowheadItemUrl(itemId);
  }
  if (!externalUrl) {
    const provided = readOptionalHttpsUrl(item, ["url", "externalUrl", "href"]);
    // Only accept Wowhead-like or already-sanitized https URLs from the payload.
    externalUrl = provided ? sanitizeHttpsUrl(provided) : null;
  }

  return { itemId, quality, iconUrl, enchantment, gems, externalUrl };
}

/**
 * Normalize equipment for presentation. Optional enrichment fields (itemId, iconUrl, …)
 * are read only when present on the payload object — never invented.
 */
export function toEquipmentViewModel(
  equipment: EquipmentSummary | null | undefined,
): EquipmentViewModel | null {
  if (!equipment) return null;

  const slots = emptyKnownSlots();
  const used = new Set<string>();
  const unknown: EquipmentItemViewModel[] = [];
  let unknownIndex = 0;

  for (const item of equipment.keyItems ?? []) {
    if (!item || typeof item !== "object") continue;
    const slotRaw = typeof item.slot === "string" ? item.slot : "";
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : null;
    const itemLevel =
      typeof item.itemLevel === "number" && !Number.isNaN(item.itemLevel) ? item.itemLevel : null;
    const enrichment = enrichFromRawItem(item);

    const candidates = EQUIPMENT_SLOT_DEFS.filter((def) => def.match.test(slotRaw));
    const target = candidates.find((def) => !used.has(def.id)) ?? null;

    if (target) {
      used.add(target.id);
      const index = EQUIPMENT_SLOT_DEFS.findIndex((def) => def.id === target.id);
      slots[index] = {
        id: target.id,
        slot: slotRaw || target.id,
        slotLabel: target.label,
        itemId: enrichment.itemId,
        name,
        itemLevel,
        quality: enrichment.quality,
        iconUrl: enrichment.iconUrl,
        externalUrl: enrichment.externalUrl,
        enchantment: enrichment.enchantment,
        gems: enrichment.gems,
        isAvailable: Boolean(name),
        isKnownSlot: true,
      };
      continue;
    }

    unknownIndex += 1;
    unknown.push({
      id: `unknown-${unknownIndex}-${slotRaw || "slot"}`,
      slot: slotRaw || `unknown-${unknownIndex}`,
      slotLabel: humanizeUnknownSlot(slotRaw || `Unknown ${unknownIndex}`),
      itemId: enrichment.itemId,
      name,
      itemLevel,
      quality: enrichment.quality,
      iconUrl: enrichment.iconUrl,
      externalUrl: enrichment.externalUrl,
      enchantment: enrichment.enchantment,
      gems: enrichment.gems,
      isAvailable: Boolean(name),
      isKnownSlot: false,
    });
  }

  const items = [...slots, ...unknown];
  return {
    averageItemLevel: equipment.averageItemLevel,
    equippedItemLevel: equipment.equippedItemLevel,
    items,
    filledCount: items.filter((s) => s.isAvailable).length,
  };
}

/** @deprecated Prefer toEquipmentViewModel — kept for existing call sites/tests. */
export function mapEquipmentSlots(equipment: EquipmentSummary | null | undefined) {
  const view = toEquipmentViewModel(equipment);
  return (view?.items ?? emptyKnownSlots())
    .filter((item) => item.isKnownSlot)
    .map((item) => ({
      id: item.id,
      label: item.slotLabel,
      name: item.name,
      itemLevel: item.itemLevel,
      filled: item.isAvailable,
    }));
}
