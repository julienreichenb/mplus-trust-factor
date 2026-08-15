<script setup lang="ts">
import { computed, onMounted } from "vue";
import DimensionAxisIcon from "../charts/DimensionAxisIcon.vue";
import FieldTooltip from "../common/FieldTooltip.vue";
import { usePublicScoreModel } from "../../composables/usePublicScoreModel";
import { COMPONENT_HELP, DIMENSION_HELP } from "../../pages/adminScoringHelp";
import {
  effectiveWeightPercent,
  formatEffectivePercent,
  resolveTunableWeightsFromConfig,
} from "../../api/tunable-weights";
import { resolveSurvivalActiveHealingFromConfig } from "../../api/survival-active-healing";
import type { RadarDimension } from "../../lib/format";

const { active, ensure } = usePublicScoreModel();
onMounted(() => {
  void ensure();
});

const DIM_KEYS = ["performance", "utility", "survival", "experience"] as const;
type DimKey = (typeof DIM_KEYS)[number];

const DIM_ICON: Record<DimKey, RadarDimension> = {
  performance: "PERFORMANCE",
  utility: "UTILITY",
  survival: "SURVIVAL",
  experience: "EXPERIENCE",
};

const weights = computed(() => resolveTunableWeightsFromConfig(active.value?.config));
const healing = computed(() => resolveSurvivalActiveHealingFromConfig(active.value?.config));

const dimEffective = computed(() => {
  const d = weights.value.dimensions;
  return {
    performance: formatEffectivePercent(effectiveWeightPercent(d.performance, d)),
    survival: formatEffectivePercent(effectiveWeightPercent(d.survival, d)),
    utility: formatEffectivePercent(effectiveWeightPercent(d.utility, d)),
    experience: formatEffectivePercent(effectiveWeightPercent(d.experience, d)),
  };
});

function componentEffective(group: Record<string, number>, key: string): string {
  return formatEffectivePercent(effectiveWeightPercent(group[key] ?? 0, group));
}
</script>

<template>
  <section class="dims" data-testid="faq-scoring-dimensions">
    <p v-if="active" class="muted model">
      Model {{ active.key }} v{{ active.version }} — current production mix
    </p>
    <article
      v-for="dimKey in DIM_KEYS"
      :key="dimKey"
      class="card"
      :data-testid="`faq-dimension-${dimKey}`"
    >
      <header class="card__header">
        <div class="card__icon">
          <DimensionAxisIcon layout="fill" :dimension="DIM_ICON[dimKey]" />
        </div>
        <div class="card__title">
          <h4>
            {{ DIMENSION_HELP[dimKey].title }}
            <FieldTooltip
              :label="`${DIMENSION_HELP[dimKey].title} help`"
              :what-it-means="DIMENSION_HELP[dimKey].whatItMeans"
            />
          </h4>
          <p class="muted">{{ DIMENSION_HELP[dimKey].summary }}</p>
        </div>
        <div class="effective" :data-testid="`faq-dim-effective-${dimKey}`">
          Effective
          <strong>{{ dimEffective[dimKey] }}</strong>
        </div>
      </header>

      <div class="components">
        <template v-if="dimKey === 'performance'">
          <div class="comp-section">
            <h5>Parse calculation</h5>
            <p class="hint">Shared by all roles</p>
            <div class="row">
              <span>
                {{ COMPONENT_HELP.performance.parseBestAverage.label }}
                <FieldTooltip
                  :label="`${COMPONENT_HELP.performance.parseBestAverage.label} help`"
                  :what-it-means="COMPONENT_HELP.performance.parseBestAverage.whatItMeans"
                />
              </span>
              <strong>{{ componentEffective(weights.components.performance.parse, "bestAverage") }}</strong>
            </div>
            <div class="row">
              <span>
                {{ COMPONENT_HELP.performance.parseMedianAverage.label }}
                <FieldTooltip
                  :label="`${COMPONENT_HELP.performance.parseMedianAverage.label} help`"
                  :what-it-means="COMPONENT_HELP.performance.parseMedianAverage.whatItMeans"
                />
              </span>
              <strong>{{ componentEffective(weights.components.performance.parse, "medianAverage") }}</strong>
            </div>
          </div>
          <div class="comp-section">
            <h5>DPS</h5>
            <div class="row">
              <span>
                {{ COMPONENT_HELP.performance.dpsDamageParse.label }}
                <FieldTooltip
                  :label="`${COMPONENT_HELP.performance.dpsDamageParse.label} help`"
                  :what-it-means="COMPONENT_HELP.performance.dpsDamageParse.whatItMeans"
                />
              </span>
              <strong>{{
                componentEffective(weights.components.performance.roles.dps, "damageParse")
              }}</strong>
            </div>
            <div class="row">
              <span>
                {{ COMPONENT_HELP.performance.dpsCooldown.label }}
                <FieldTooltip
                  :label="`${COMPONENT_HELP.performance.dpsCooldown.label} help`"
                  :what-it-means="COMPONENT_HELP.performance.dpsCooldown.whatItMeans"
                />
              </span>
              <strong>{{ componentEffective(weights.components.performance.roles.dps, "cooldown") }}</strong>
            </div>
          </div>
          <div class="comp-section">
            <h5>Tank</h5>
            <div class="row">
              <span>
                {{ COMPONENT_HELP.performance.tankDamageParse.label }}
                <FieldTooltip
                  :label="`${COMPONENT_HELP.performance.tankDamageParse.label} help`"
                  :what-it-means="COMPONENT_HELP.performance.tankDamageParse.whatItMeans"
                />
              </span>
              <strong>100%</strong>
            </div>
          </div>
          <div class="comp-section">
            <h5>Healer</h5>
            <div class="row">
              <span>
                {{ COMPONENT_HELP.performance.healerHealingParse.label }}
                <FieldTooltip
                  :label="`${COMPONENT_HELP.performance.healerHealingParse.label} help`"
                  :what-it-means="COMPONENT_HELP.performance.healerHealingParse.whatItMeans"
                />
              </span>
              <strong>{{
                componentEffective(weights.components.performance.roles.healer, "healingParse")
              }}</strong>
            </div>
            <div class="row">
              <span>
                {{ COMPONENT_HELP.performance.healerDamageParse.label }}
                <FieldTooltip
                  :label="`${COMPONENT_HELP.performance.healerDamageParse.label} help`"
                  :what-it-means="COMPONENT_HELP.performance.healerDamageParse.whatItMeans"
                />
              </span>
              <strong>{{
                componentEffective(weights.components.performance.roles.healer, "damageParse")
              }}</strong>
            </div>
          </div>
        </template>

        <template v-else-if="dimKey === 'utility'">
          <div
            v-for="key in ([
              'interrupt',
              'crowdControl',
              'dispelPurge',
              'groupSupport',
              'movement',
              'combatRes',
              'bloodlust',
            ] as const)"
            :key="key"
            class="row"
          >
            <span>
              {{ COMPONENT_HELP.utility[key].label }}
              <FieldTooltip
                :label="`${COMPONENT_HELP.utility[key].label} help`"
                :what-it-means="COMPONENT_HELP.utility[key].whatItMeans"
              />
            </span>
            <strong>{{ componentEffective(weights.components.utility, key) }}</strong>
          </div>
        </template>

        <template v-else-if="dimKey === 'survival'">
          <div
            v-for="key in (['outcome', 'defensive', 'recovery'] as const)"
            :key="key"
            class="row"
          >
            <span>
              {{ COMPONENT_HELP.survival[key].label }}
              <FieldTooltip
                :label="`${COMPONENT_HELP.survival[key].label} help`"
                :what-it-means="COMPONENT_HELP.survival[key].whatItMeans"
              />
            </span>
            <strong>{{ componentEffective(weights.components.survival, key) }}</strong>
          </div>
          <div class="comp-section">
            <h5>{{ COMPONENT_HELP.survival.activeHealing.title }}</h5>
            <p class="hint">{{ COMPONENT_HELP.survival.activeHealing.whatItMeans }}</p>
            <div class="row">
              <span>Enabled</span>
              <strong>{{ healing.enabled ? "Yes" : "No" }}</strong>
            </div>
            <div class="row">
              <span>Minimum meaningful heal</span>
              <strong>{{ Math.round(healing.minEffectiveHealPctMaxHp * 1000) / 10 }}%</strong>
            </div>
            <div class="row">
              <span>Self-healing weight</span>
              <strong>{{ healing.selfWeight }}</strong>
            </div>
            <div class="row">
              <span>Ally-healing weight</span>
              <strong>{{ healing.allyWeight }}</strong>
            </div>
            <div class="row">
              <span>Maximum Survival bonus</span>
              <strong>{{ healing.maxSurvivalBonusPoints }}</strong>
            </div>
          </div>
        </template>

        <template v-else>
          <p class="hint">
            Experience scoring ships later. These weights prepare the model structure — they do not
            produce Experience results yet.
          </p>
          <div
            v-for="key in (['previousSeasonScore', 'historicalTitle', 'historicalRanking'] as const)"
            :key="key"
            class="row"
          >
            <span>
              {{ COMPONENT_HELP.experience[key].label }}
              <FieldTooltip
                :label="`${COMPONENT_HELP.experience[key].label} help`"
                :what-it-means="COMPONENT_HELP.experience[key].whatItMeans"
              />
            </span>
            <strong>{{ componentEffective(weights.components.experience, key) }}</strong>
          </div>
        </template>
      </div>
    </article>
  </section>
</template>

<style scoped>
.dims {
  display: grid;
  gap: var(--space-3);
}
.model {
  margin: 0;
}
.card {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}
.card__header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: var(--space-3);
  align-items: start;
}
.card__icon {
  display: grid;
  place-items: center;
  color: var(--color-gold-300);
}
.card__icon :deep(.dim-icon) {
  width: 2.5rem;
  height: 2.5rem;
}
.card__title h4 {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-body);
  font-size: var(--text-base);
}
.muted,
.hint {
  color: var(--color-text-muted);
  margin: 0.2rem 0 0;
  font-size: var(--text-sm);
  line-height: 1.45;
}
.effective {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  text-align: right;
  white-space: nowrap;
}
.effective strong {
  display: block;
  font-family: var(--font-data);
  color: var(--color-gold-300);
  font-size: var(--text-lg);
}
.components {
  display: grid;
  gap: var(--space-2);
}
.comp-section {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
}
.comp-section h5 {
  margin: 0;
  font-size: var(--text-sm);
}
.row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  align-items: center;
  font-size: var(--text-sm);
}
.row span {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}
.row strong {
  font-family: var(--font-data);
  color: var(--color-gold-300);
  white-space: nowrap;
}
@media (max-width: 40rem) {
  .card__header {
    grid-template-columns: auto 1fr;
  }
  .effective {
    grid-column: 2;
    text-align: left;
  }
}
</style>
