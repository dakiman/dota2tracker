<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
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
const activeTab = ref<'builds' | 'stats'>('builds')

const heroSlug = computed(() => route.params.heroSlug as string)

async function load() {
  if (!heroSlug.value) return
  loading.value = true
  try {
    const query: Record<string, string> = {}
    if (store.selectedPlayerIds.length) {
      query.players = store.selectedPlayerIds.join(',')
    }
    hero.value = await useApi<HeroBuild>(
      `/api/heroes/${heroSlug.value}`,
      query
    )
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([heroSlug, () => store.selectedPlayerIds], load)
</script>

<template>
  <div v-if="loading" class="text-dota-text-dim">Loading…</div>
  <div v-else-if="hero" class="space-y-8">
    <HeroHeader :hero="hero" />
    <div class="flex gap-2 border-b border-dota-border pb-2">
      <button
        :class="[
          'px-4 py-2 rounded font-medium transition',
          activeTab === 'builds'
            ? 'bg-dota-gold-dark text-dota-bg'
            : 'bg-dota-bg-card text-dota-text-dim hover:text-dota-text'
        ]"
        @click="activeTab = 'builds'"
      >
        Builds
      </button>
      <button
        :class="[
          'px-4 py-2 rounded font-medium transition',
          activeTab === 'stats'
            ? 'bg-dota-gold-dark text-dota-bg'
            : 'bg-dota-bg-card text-dota-text-dim hover:text-dota-text'
        ]"
        @click="activeTab = 'stats'"
      >
        Stats
      </button>
    </div>
    <template v-if="activeTab === 'builds'">
      <section>
        <h2 class="font-heading text-xl text-dota-gold mb-4">Skill builds</h2>
        <div class="grid gap-4 md:grid-cols-2">
          <SkillBuildCard
            v-for="(build, i) in hero.skillBuilds"
            :key="i"
            :build="build"
            :title="i === 0 ? 'Most popular' : 'Highest win rate'"
          />
        </div>
        <TalentTree
          v-if="hero.skillBuilds[0]?.talents?.length"
          :talents="hero.skillBuilds[0].talents"
          class="mt-6"
        />
      </section>
      <section>
        <h2 class="font-heading text-xl text-dota-gold mb-4">Starting items</h2>
        <StartingItemsGroup :groups="hero.itemBuild.startingItems" />
      </section>
      <section>
        <h2 class="font-heading text-xl text-dota-gold mb-4">Core items</h2>
        <CoreItemTimeline :groups="hero.itemBuild.coreItems" />
      </section>
      <section>
        <h2 class="font-heading text-xl text-dota-gold mb-4">Situational</h2>
        <ItemStatsList :items="hero.itemBuild.situationalItems" />
      </section>
      <section>
        <h2 class="font-heading text-xl text-dota-gold mb-4">Neutral items</h2>
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <NeutralItemsTier
            v-for="tier in hero.itemBuild.neutralItems"
            :key="tier.tier"
            :tier-group="tier"
          />
        </div>
      </section>
      <section>
        <h2 class="font-heading text-xl text-dota-gold mb-4">Late game</h2>
        <LateGameInventory :inventories="hero.itemBuild.lateGameInventories" />
      </section>
    </template>
    <template v-else>
      <LaneStats v-if="hero.stats?.laneStats?.length" :stats="hero.stats.laneStats" />
      <PerformanceStats v-if="hero.stats" :stats="hero.stats" />
    </template>
  </div>
  <div v-else class="text-dota-red">Hero not found.</div>
</template>
