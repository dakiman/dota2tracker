<script setup lang="ts">
import { heroImageUrl } from '@friendtracker/shared'
import type { HeroBuild } from '@friendtracker/shared'

defineProps<{ hero: HeroBuild }>()
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-6 p-6 rounded border"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <img
      :src="heroImageUrl(hero.heroSlug)"
      :alt="hero.heroName"
      class="w-24 h-24 rounded object-cover"
    />
    <div>
      <h1 class="font-heading text-3xl font-semibold" style="color: var(--color-dota-gold);">
        {{ hero.heroName }}
      </h1>
      <p class="text-dota-text-dim mt-1">
        {{ hero.totalMatches }} matches · {{ hero.winRate.toFixed(1) }}% win rate
      </p>
      <div class="flex gap-3 mt-2">
        <span
          v-for="tab in hero.roleTabs"
          :key="tab.role"
          class="px-2 py-1 rounded text-xs capitalize"
          style="background-color: var(--color-dota-bg-light); color: var(--color-dota-text-dim);"
        >
          {{ tab.role.replace('_', ' ') }}: {{ tab.winRate.toFixed(1) }}%
        </span>
      </div>
    </div>
  </div>
</template>
