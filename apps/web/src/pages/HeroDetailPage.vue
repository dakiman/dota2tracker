<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { usePlayerFilterStore } from '@/stores/playerFilter'
import type { HeroBuild } from '@friendtracker/shared'
import HeroHeader from '@/components/hero/HeroHeader.vue'
import SkillBuildCard from '@/components/hero/SkillBuildCard.vue'
import TalentTree from '@/components/hero/TalentTree.vue'
import StartingItemsGroup from '@/components/hero/StartingItemsGroup.vue'
import CoreItemTimeline from '@/components/hero/CoreItemTimeline.vue'
import ItemStatsList from '@/components/hero/ItemStatsList.vue'
import NeutralItemsTier from '@/components/hero/NeutralItemsTier.vue'
import LateGameInventory from '@/components/hero/LateGameInventory.vue'
import LaneStats from '@/components/hero/LaneStats.vue'
import PerformanceStats from '@/components/hero/PerformanceStats.vue'

const route = useRoute()
const store = usePlayerFilterStore()
const hero = ref<HeroBuild | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const activeTab = ref<'builds' | 'stats'>('builds')

const heroSlug = computed(() => route.params.heroSlug as string)

const hasBuildData = computed(() => {
  if (!hero.value) return false
  return hero.value.skillBuilds.length > 0
    || hero.value.itemBuild.startingItems.length > 0
    || hero.value.itemBuild.coreItems.length > 0
})

const hasKda = computed(() => {
  if (!hero.value) return false
  return (hero.value.kills ?? 0) + (hero.value.deaths ?? 0) + (hero.value.assists ?? 0) > 0
})

const kda = computed(() => {
  if (!hero.value || !hasKda.value) return '0'
  const k = hero.value.kills ?? 0
  const d = hero.value.deaths ?? 0
  const a = hero.value.assists ?? 0
  if (d === 0) return `${k + a}`
  return ((k + a) / d).toFixed(2)
})

let currentLoadId = 0

async function load() {
  if (!heroSlug.value) return
  const loadId = ++currentLoadId
  loading.value = true
  error.value = null
  try {
    const query: Record<string, string> = {}
    if (store.selectedPlayerIds.length) {
      query.players = store.selectedPlayerIds.join(',')
    }
    const data = await useApi<HeroBuild>(
      `/api/heroes/${heroSlug.value}`,
      query
    )
    if (loadId !== currentLoadId) return
    hero.value = data
    const hasBuilds = data.skillBuilds.length > 0
      || data.itemBuild.startingItems.length > 0
      || data.itemBuild.coreItems.length > 0
    if (!hasBuilds) activeTab.value = 'stats'
  } catch (e) {
    if (loadId !== currentLoadId) return
    hero.value = null
    error.value = e instanceof Error ? e.message : 'Failed to load hero data'
  } finally {
    if (loadId === currentLoadId) loading.value = false
  }
}

onMounted(load)
watch([heroSlug, () => store.selectedPlayerIds], load)
</script>

<template>
  <div v-if="loading" class="text-dota-text-dim py-12 text-center">Loading…</div>
  <div v-else-if="hero" class="space-y-5">
    <RouterLink
      to="/meta"
      class="inline-flex items-center gap-1 text-sm text-dota-text-dim hover:text-dota-gold transition-colors"
    >
      ← Back to Heroes
    </RouterLink>
    <HeroHeader :hero="hero" />

    <!-- Tab bar -->
    <div v-if="hasBuildData" class="flex gap-1 border-b pb-0" style="border-color: var(--color-dota-border);">
      <button
        :class="[
          'px-5 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
          activeTab === 'builds'
            ? 'border-dota-gold text-dota-gold'
            : 'border-transparent text-dota-text-dim hover:text-dota-text'
        ]"
        @click="activeTab = 'builds'"
      >
        Builds
      </button>
      <button
        :class="[
          'px-5 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
          activeTab === 'stats'
            ? 'border-dota-gold text-dota-gold'
            : 'border-transparent text-dota-text-dim hover:text-dota-text'
        ]"
        @click="activeTab = 'stats'"
      >
        Stats
      </button>
    </div>

    <!-- BUILDS TAB -->
    <template v-if="activeTab === 'builds'">
      <div v-if="!hasBuildData" class="text-dota-text-dim py-8 text-center">
        No build data available for this hero yet.
      </div>
      <template v-else>
        <!-- Two-column layout: Items left, Skills/Talents right -->
        <div class="grid gap-5 lg:grid-cols-[1fr_320px]">
          <!-- Left column: Items -->
          <div class="space-y-5">
            <!-- Starting Items -->
            <section v-if="hero.itemBuild.startingItems.length">
              <h2 class="section-label">Starting Items</h2>
              <StartingItemsGroup :groups="hero.itemBuild.startingItems" />
            </section>

            <!-- Core Items -->
            <section v-if="hero.itemBuild.coreItems.length">
              <h2 class="section-label">Core Items</h2>
              <CoreItemTimeline :groups="hero.itemBuild.coreItems" />
            </section>

            <!-- Situational Items -->
            <section v-if="hero.itemBuild.situationalItems.length">
              <h2 class="section-label">Situational</h2>
              <ItemStatsList :items="hero.itemBuild.situationalItems" />
            </section>

            <!-- Neutral Items -->
            <section v-if="hero.itemBuild.neutralItems.some(t => t.items.length)">
              <h2 class="section-label">Neutral Items</h2>
              <div class="space-y-3">
                <NeutralItemsTier
                  v-for="tier in hero.itemBuild.neutralItems.filter(t => t.items.length)"
                  :key="tier.tier"
                  :tier-group="tier"
                />
              </div>
            </section>

            <!-- Late Game -->
            <section v-if="hero.itemBuild.lateGameInventories.length">
              <h2 class="section-label">Late Game Inventory</h2>
              <LateGameInventory :inventories="hero.itemBuild.lateGameInventories" />
            </section>
          </div>

          <!-- Right column: Skills & Talents -->
          <div class="space-y-5" v-if="hero.skillBuilds.length">
            <section>
              <h2 class="section-label">Skill Build</h2>
              <div class="space-y-3">
                <SkillBuildCard
                  v-for="(build, i) in hero.skillBuilds"
                  :key="i"
                  :build="build"
                  :title="i === 0 ? 'Most Popular' : 'Highest Win Rate'"
                />
              </div>
            </section>
            <section v-if="hero.skillBuilds[0]?.talents?.length">
              <TalentTree :talents="hero.skillBuilds[0].talents" />
            </section>
          </div>
        </div>
      </template>
    </template>

    <!-- STATS TAB -->
    <template v-else>
      <section class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div class="stat-card">
          <h3 class="text-dota-text-dim text-xs uppercase tracking-wider mb-1">Matches</h3>
          <p class="font-mono text-2xl text-dota-text">{{ hero.totalMatches }}</p>
        </div>
        <div class="stat-card">
          <h3 class="text-dota-text-dim text-xs uppercase tracking-wider mb-1">Win Rate</h3>
          <p class="font-mono text-2xl" :class="hero.winRate >= 50 ? 'text-dota-green' : 'text-dota-red'">{{ hero.winRate.toFixed(1) }}%</p>
        </div>
        <div v-if="hasKda" class="stat-card">
          <h3 class="text-dota-text-dim text-xs uppercase tracking-wider mb-1">KDA</h3>
          <p class="font-mono text-2xl text-dota-text">{{ kda }}</p>
          <p class="text-dota-text-dim text-xs mt-1 font-mono">{{ hero.kills }} / {{ hero.deaths }} / {{ hero.assists }}</p>
        </div>
        <div class="stat-card">
          <h3 class="text-dota-text-dim text-xs uppercase tracking-wider mb-1">Wins / Losses</h3>
          <p class="font-mono text-2xl text-dota-text">
            <span class="text-dota-green">{{ Math.round(hero.totalMatches * hero.winRate / 100) }}</span>
            <span class="text-dota-text-dim"> / </span>
            <span class="text-dota-red">{{ hero.totalMatches - Math.round(hero.totalMatches * hero.winRate / 100) }}</span>
          </p>
        </div>
      </section>
      <LaneStats v-if="hero.stats?.laneStats?.length" :stats="hero.stats.laneStats" />
      <PerformanceStats v-if="hero.stats" :stats="hero.stats" />
    </template>
  </div>
  <div v-else-if="error" class="py-16 text-center">
    <p class="text-dota-text-dim text-lg mb-2">Hero not found</p>
    <p class="text-dota-text-dim text-sm mb-6">{{ error }}</p>
    <RouterLink
      to="/meta"
      class="inline-block px-4 py-2 rounded text-sm font-medium"
      style="background-color: var(--color-dota-bg-light); border: 1px solid var(--color-dota-border); color: var(--color-dota-gold);"
    >
      ← Back to Heroes
    </RouterLink>
  </div>
  <div v-else class="text-dota-red py-12 text-center">Hero not found.</div>
</template>

<style scoped>
.section-label {
  font-family: var(--font-heading);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-dota-gold);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 0.75rem;
}

.stat-card {
  padding: 1rem;
  border-radius: 0.5rem;
  border: 1px solid var(--color-dota-border);
  background-color: var(--color-dota-bg-card);
}
</style>
