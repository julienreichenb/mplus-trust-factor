import type { EquipmentSummary } from "../api/types";
import { wowheadItemQuery, wowheadItemUrl } from "../integrations/wowhead/urls";
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
  /** Wowhead `data-wowhead` payload (`item=…&ilvl=…&bonus=…`). */
  wowheadData: string | null;
  enchantment: string | null;
  gems: readonly EquipmentGemViewModel[];
  bonusList: readonly number[];
  isAvailable: boolean;
  isKnownSlot: boolean;
  /** Heuristic: enchantment text mentions embellishment (no dedicated DTO field yet). */
  isEmbellished: boolean;
  /** Trinkets, weapons, or embellished pieces — larger in hero gear panel. */
  isHeroHighlight: boolean;
}

const HERO_HIGHLIGHT_SLOT_IDS = new Set(["trinket-1", "trinket-2", "main-hand", "off-hand"]);
const HIDDEN_HERO_SLOT_RE = /shirt|tabard/i;

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
  { id: "hands", label: "Hands", match: /^(hands?|gloves?)$/i },
  { id: "waist", label: "Waist", match: /waist|belt/i },
  { id: "legs", label: "Legs", match: /leg/i },
  { id: "feet", label: "Feet", match: /feet|boot/i },
  { id: "finger-1", label: "Ring 1", match: /finger|ring/i },
  { id: "finger-2", label: "Ring 2", match: /finger|ring/i },
  { id: "trinket-1", label: "Trinket 1", match: /trinket/i },
  { id: "trinket-2", label: "Trinket 2", match: /trinket/i },
  { id: "main-hand", label: "Main Hand", match: /main.?hand|^weapon$/i },
  { id: "off-hand", label: "Off Hand", match: /off.?hand|shield/i },
];

function detectEmbellished(enchantment: string | null): boolean {
  return Boolean(enchantment && /embellish/i.test(enchantment));
}

function isHeroHighlightSlot(slotId: string, isEmbellished: boolean): boolean {
  return isEmbellished || HERO_HIGHLIGHT_SLOT_IDS.has(slotId);
}

function parseBonusList(source: object): number[] {
  const record = source as Record<string, unknown>;
  const raw = record.bonusList ?? record.bonus_list;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0);
}

function buildWowheadFields(
  itemId: number | null,
  itemLevel: number | null,
  bonusList: readonly number[],
): { externalUrl: string | null; wowheadData: string | null } {
  if (itemId == null) return { externalUrl: null, wowheadData: null };
  const options = { itemLevel, bonusList };
  return {
    externalUrl: wowheadItemUrl(itemId, options),
    wowheadData: wowheadItemQuery(itemId, options),
  };
}

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
    wowheadData: null,
    enchantment: null,
    gems: [],
    bonusList: [],
    isAvailable: false,
    isKnownSlot: true,
    isEmbellished: false,
    isHeroHighlight: isHeroHighlightSlot(def.id, false),
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

function enrichFromRawItem(
  item: object,
  itemLevel: number | null,
): {
  itemId: number | null;
  quality: string | null;
  iconUrl: string | null;
  enchantment: string | null;
  gems: readonly EquipmentGemViewModel[];
  bonusList: readonly number[];
  externalUrl: string | null;
  wowheadData: string | null;
} {
  const itemId = readOptionalPositiveInt(item, ["itemId", "id"]);
  const quality = readOptionalString(item, ["quality", "qualityName"]);
  const iconUrl = readOptionalHttpsUrl(item, ["iconUrl", "icon"]);
  let enchantment = readOptionalString(item, ["enchantment", "enchant"]);
  if (!enchantment) {
    const record = item as Record<string, unknown>;
    if (Array.isArray(record.enchantments)) {
      const parts = record.enchantments.filter(
        (e): e is string => typeof e === "string" && e.trim().length > 0,
      );
      enchantment = parts.length ? parts.join(", ") : null;
    }
  }
  const gems = parseGems(item);
  const bonusList = parseBonusList(item);
  const wowhead = buildWowheadFields(itemId, itemLevel, bonusList);
  const provided = readOptionalHttpsUrl(item, ["url", "externalUrl", "href"]);

  return {
    itemId,
    quality,
    iconUrl,
    enchantment,
    gems,
    bonusList,
    externalUrl: wowhead.externalUrl ?? (provided ? sanitizeHttpsUrl(provided) : null),
    wowheadData: wowhead.wowheadData,
  };
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

  for (const item of equipment.items?.length ? equipment.items : (equipment.keyItems ?? [])) {
    if (!item || typeof item !== "object") continue;
    const slotRaw = typeof item.slot === "string" ? item.slot : "";
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : null;
    const itemLevel =
      typeof item.itemLevel === "number" && !Number.isNaN(item.itemLevel) && item.itemLevel > 0
        ? item.itemLevel
        : null;
    const enrichment = enrichFromRawItem(item, itemLevel);

    const candidates = EQUIPMENT_SLOT_DEFS.filter((def) => def.match.test(slotRaw));
    const target = candidates.find((def) => !used.has(def.id)) ?? null;

    if (target) {
      used.add(target.id);
      const index = EQUIPMENT_SLOT_DEFS.findIndex((def) => def.id === target.id);
      const isEmbellished = detectEmbellished(enrichment.enchantment);
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
        wowheadData: enrichment.wowheadData,
        enchantment: enrichment.enchantment,
        gems: enrichment.gems,
        bonusList: enrichment.bonusList,
        isAvailable: Boolean(name),
        isKnownSlot: true,
        isEmbellished,
        isHeroHighlight: isHeroHighlightSlot(target.id, isEmbellished),
      };
      continue;
    }

    unknownIndex += 1;
    const isEmbellished = detectEmbellished(enrichment.enchantment);
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
      wowheadData: enrichment.wowheadData,
      enchantment: enrichment.enchantment,
      gems: enrichment.gems,
      bonusList: enrichment.bonusList,
      isAvailable: Boolean(name),
      isKnownSlot: false,
      isEmbellished,
      isHeroHighlight: isEmbellished,
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

function heroHighlightRank(item: EquipmentItemViewModel): number {
  if (item.id === "main-hand" || item.id === "off-hand") return 0;
  if (item.id === "trinket-1" || item.id === "trinket-2") return 1;
  if (item.isEmbellished) return 2;
  if (item.isHeroHighlight) return 3;
  return 4;
}

/**
 * Equipped pieces for the hero gear panel: filled slots only; shirt/tabard hidden.
 * Order: weapons → trinkets → embellished → remaining gear.
 */
export function toHeroGearItems(
  equipment: EquipmentSummary | null | undefined,
): EquipmentItemViewModel[] {
  const view = toEquipmentViewModel(equipment);
  if (!view) return [];

  const visible = view.items.filter((item) => {
    if (!item.isAvailable) return false;
    if (HIDDEN_HERO_SLOT_RE.test(item.slot) || HIDDEN_HERO_SLOT_RE.test(item.slotLabel)) {
      return false;
    }
    return true;
  });

  return [...visible].sort((a, b) => {
    const rank = heroHighlightRank(a) - heroHighlightRank(b);
    if (rank !== 0) return rank;
    return a.slotLabel.localeCompare(b.slotLabel);
  });
}

/** Prefer view-model Wowhead URL; fall back to constructing from itemId + equipped context. */
export function resolveItemWowheadUrl(item: EquipmentItemViewModel): string | null {
  if (item.externalUrl) return item.externalUrl;
  if (item.itemId != null) {
    return wowheadItemUrl(item.itemId, {
      itemLevel: item.itemLevel,
      bonusList: item.bonusList,
    });
  }
  return null;
}

export function resolveItemWowheadData(item: EquipmentItemViewModel): string | null {
  if (item.wowheadData) return item.wowheadData;
  if (item.itemId == null) return null;
  return wowheadItemQuery(item.itemId, {
    itemLevel: item.itemLevel,
    bonusList: item.bonusList,
  });
}
