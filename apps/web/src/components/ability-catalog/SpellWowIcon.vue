<script setup lang="ts">
import { ref, watch } from "vue";
import { resolveWowheadSpellIconName } from "../../integrations/wowhead/spellIcons";
import WowIcon from "./WowIcon.vue";

const props = withDefaults(
  defineProps<{
    /** Preferred static icon name from catalog / external metadata. */
    iconName?: string | null;
    /** Fallback: resolve icon via Wowhead tooltip when iconName is missing. */
    spellId?: number | null;
    alt?: string;
    width?: number;
    height?: number;
    lazy?: boolean;
  }>(),
  {
    iconName: null,
    spellId: null,
    alt: "",
    width: 40,
    height: 40,
    lazy: true,
  },
);

const resolvedName = ref<string | null>(props.iconName ?? null);
let resolveGeneration = 0;

async function resolveIcon(): Promise<void> {
  const generation = ++resolveGeneration;
  if (props.iconName) {
    resolvedName.value = props.iconName;
    return;
  }
  const spellId = props.spellId;
  if (!spellId) {
    resolvedName.value = null;
    return;
  }
  const name = await resolveWowheadSpellIconName(spellId);
  if (generation !== resolveGeneration) return;
  resolvedName.value = name;
}

watch(
  () => [props.iconName, props.spellId] as const,
  () => {
    void resolveIcon();
  },
  { immediate: true },
);
</script>

<template>
  <WowIcon
    :icon-name="resolvedName"
    :alt="alt"
    :width="width"
    :height="height"
    :lazy="lazy"
  />
</template>
