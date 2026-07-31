<script setup lang="ts">
import { computed } from "vue";
import {
  formatCharacterIdentityDisplay,
  type CharacterIdentityDisplayInput,
} from "../../lib/characterIdentity";
import {
  classColor as wowClassColor,
  classIconUrl as wowClassIconUrl,
} from "../../lib/wowClass";

const props = withDefaults(
  defineProps<{
    region?: string | null;
    name?: string | null;
    realmSlug?: string | null;
    realmName?: string | null;
    classSlug?: string | null;
    className?: string | null;
    classColor?: string | null;
    avatarUrl?: string | null;
    classIconUrl?: string | null;
    portraitUrl?: string | null;
    /** Portrait pixel size. */
    size?: number;
    /** Compact layout for dense admin lists. */
    compact?: boolean;
  }>(),
  {
    region: null,
    name: null,
    realmSlug: null,
    realmName: null,
    classSlug: null,
    className: null,
    classColor: null,
    avatarUrl: null,
    classIconUrl: null,
    portraitUrl: null,
    size: 36,
    compact: false,
  },
);

const display = computed(() => {
  const input: CharacterIdentityDisplayInput = {
    region: props.region,
    name: props.name,
    realmSlug: props.realmSlug,
    realmName: props.realmName,
    classSlug: props.classSlug,
    className: props.className,
    classColor: props.classColor ?? wowClassColor(props.classSlug),
    avatarUrl: props.avatarUrl,
    classIconUrl: props.classIconUrl ?? wowClassIconUrl(props.classSlug),
    portraitUrl: props.portraitUrl,
  };
  return formatCharacterIdentityDisplay(input);
});

const nameStyle = computed(() =>
  display.value.classColor ? { color: display.value.classColor } : undefined,
);
</script>

<template>
  <span
    class="char-identity"
    :class="{ 'char-identity--compact': compact }"
    data-testid="character-identity"
    :aria-label="display.accessibleLabel"
  >
    <img
      v-if="display.portraitSrc"
      class="char-identity__portrait"
      :src="display.portraitSrc"
      alt=""
      :width="size"
      :height="size"
      decoding="async"
    />
    <span
      v-else
      class="char-identity__portrait char-identity__portrait--empty"
      aria-hidden="true"
      :style="{ width: `${size}px`, height: `${size}px` }"
    />
    <span class="char-identity__text">
      <span class="char-identity__region mpts-data">{{ display.region }}</span>
      <span class="char-identity__pair">
        <span class="char-identity__nickname" :style="nameStyle">{{ display.nickname }}</span>
        <span class="char-identity__hyphen" aria-hidden="true">-</span>
        <span class="char-identity__server">{{ display.server }}</span>
      </span>
      <span v-if="display.className" class="visually-hidden">{{ display.className }}</span>
    </span>
  </span>
</template>

<style scoped>
.char-identity {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  max-width: 100%;
}

.char-identity--compact {
  gap: var(--space-2);
}

.char-identity__portrait {
  border-radius: 0.3rem;
  object-fit: cover;
  flex-shrink: 0;
  background: rgb(255 255 255 / 8%);
}

.char-identity__portrait--empty {
  display: inline-block;
  background: rgb(255 255 255 / 8%);
}

.char-identity__text {
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.35rem 0.45rem;
  min-width: 0;
}

.char-identity__region {
  font-family: var(--font-data);
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.char-identity__pair {
  display: inline-flex;
  align-items: baseline;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 650;
}

.char-identity__nickname {
  overflow: hidden;
  text-overflow: ellipsis;
}

.char-identity__hyphen,
.char-identity__server {
  color: var(--color-text);
}

.char-identity__server {
  overflow: hidden;
  text-overflow: ellipsis;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
