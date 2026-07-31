<script setup lang="ts">
import { computed, ref } from "vue";
import type { ValidationIssue } from "@mplus/abilities";
import DisclosureChevron from "./DisclosureChevron.vue";

const props = defineProps<{
  issues: ValidationIssue[];
}>();

const emit = defineEmits<{
  select: [canonicalKey: string | undefined];
}>();

const expanded = ref(false);
const panelId = "ability-catalog-validation-panel";
const triggerId = "ability-catalog-validation-trigger";

const fatalIssues = computed(() => props.issues.filter((issue) => issue.severity === "error"));
const warningIssues = computed(() => props.issues.filter((issue) => issue.severity === "warning"));
const visibleWarnings = computed(() => warningIssues.value.slice(0, 40));
const hasMoreWarnings = computed(() => warningIssues.value.length > 40);
const warningCount = computed(() => warningIssues.value.length);
const hasFatal = computed(() => fatalIssues.value.length > 0);
const hasWarnings = computed(() => warningIssues.value.length > 0);

function toggle(): void {
  expanded.value = !expanded.value;
}

function onIssueClick(issue: ValidationIssue): void {
  emit("select", issue.canonicalKey);
}
</script>

<template>
  <div
    v-if="hasFatal || hasWarnings"
    class="validation-issues"
    data-testid="validation-summary"
    :data-expanded="expanded ? 'true' : 'false'"
  >
    <!-- Fatal errors stay outside the collapsed disclosure. -->
    <div
      v-if="hasFatal"
      class="validation-issues__fatal"
      role="alert"
      data-testid="validation-fatal-status"
    >
      <p class="eyebrow">Validation errors</p>
      <ul class="validation-issues__fatal-list" data-testid="validation-fatal-list">
        <li v-for="(issue, idx) in fatalIssues" :key="`fatal-${idx}`">
          <button
            type="button"
            class="btn link issue-link"
            data-severity="error"
            @click="onIssueClick(issue)"
          >
            <span class="issue-severity">error</span>
            {{ issue.message }}
            <span v-if="issue.canonicalKey" class="issue-key">({{ issue.canonicalKey }})</span>
          </button>
        </li>
      </ul>
    </div>

    <template v-if="hasWarnings">
      <button
        :id="triggerId"
        type="button"
        class="validation-issues__trigger"
        :aria-expanded="expanded ? 'true' : 'false'"
        :aria-controls="panelId"
        data-testid="validation-toggle"
        @click="toggle"
      >
        <p class="eyebrow">Validation warnings</p>
        <span class="validation-issues__count" data-testid="validation-issue-count">
          {{ warningCount }}
        </span>
        <DisclosureChevron :expanded="expanded" />
      </button>

      <div
        :id="panelId"
        role="region"
        :aria-labelledby="triggerId"
        :hidden="!expanded"
        data-testid="validation-panel-body"
      >
        <ul
          class="validation-issues__list"
          :aria-label="`Validation warnings (${warningCount})`"
        >
          <li v-for="(issue, idx) in visibleWarnings" :key="`warn-${idx}`">
            <button
              type="button"
              class="btn link issue-link"
              data-severity="warning"
              @click="onIssueClick(issue)"
            >
              <span class="issue-severity">warning</span>
              {{ issue.message }}
              <span v-if="issue.canonicalKey" class="issue-key">({{ issue.canonicalKey }})</span>
            </button>
          </li>
        </ul>
        <p v-if="hasMoreWarnings" class="muted">
          Showing first 40 of {{ warningCount }} warnings.
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.validation-issues {
  margin: 0 0 var(--space-4, 1rem);
  min-width: 0;
}

.validation-issues__fatal {
  margin: 0 0 var(--space-3, 0.75rem);
}

.validation-issues__fatal .eyebrow {
  margin: 0 0 var(--space-2, 0.5rem);
  color: var(--danger);
}

.validation-issues__fatal-list,
.validation-issues__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: var(--space-2, 0.5rem);
  max-width: 100%;
}

.validation-issues__list {
  margin-top: var(--space-2, 0.5rem);
  max-height: 12rem;
  overflow-y: auto;
}

.validation-issues__trigger {
  display: flex;
  align-items: center;
  gap: var(--space-3, 0.65rem);
  width: 100%;
  padding: var(--space-1, 0.15rem) 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}

.validation-issues__trigger:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

.validation-issues__trigger .eyebrow {
  margin: 0;
}

.validation-issues__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--warn) 22%, transparent);
  color: var(--warn);
  font-size: 0.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
  flex-shrink: 0;
}

.validation-issues__trigger :deep(.disclosure-chevron) {
  margin-left: auto;
}

.issue-link {
  text-align: left;
  width: 100%;
  font-weight: 500;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.issue-severity {
  text-transform: uppercase;
  font-size: 0.7rem;
  font-weight: 700;
  margin-right: 0.35rem;
}

.issue-link[data-severity="error"] .issue-severity {
  color: var(--danger);
}

.issue-link[data-severity="warning"] .issue-severity {
  color: var(--warn);
}

.issue-key {
  color: var(--muted);
  font-size: 0.85em;
}

.muted {
  color: var(--muted);
}
</style>
