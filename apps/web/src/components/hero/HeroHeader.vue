<script setup lang="ts">
import { heroCropUrl } from '@friendtracker/shared'
import type { HeroBuild, Role } from '@friendtracker/shared'

defineProps<{ hero: HeroBuild; activeRole: Role | null; buildRoles: Role[] }>()
defineEmits<{ (e: 'select-role', role: Role): void }>()
</script>

<template>
  <div class="relative overflow-hidden rounded-lg border" style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);">
    <!-- Background hero crop image with gradient overlay -->
    <div class="absolute inset-0 opacity-15">
      <img
        :src="heroCropUrl(hero.heroSlug)"
        :alt="hero.heroName"
        class="w-full h-full object-cover object-top"
      />
    </div>
    <div class="absolute inset-0 bg-gradient-to-r from-[var(--color-dota-bg-card)] via-[var(--color-dota-bg-card)]/80 to-transparent" />

    <div class="relative flex flex-wrap items-center gap-5 p-5">
      <img
        :src="heroCropUrl(hero.heroSlug)"
        :alt="hero.heroName"
        class="w-28 h-16 rounded object-cover border-2"
        style="border-color: var(--color-dota-gold-dark);"
      />
      <div class="flex-1 min-w-0">
        <h1 class="font-heading text-2xl font-semibold tracking-wide" style="color: var(--color-dota-gold);">
          {{ hero.heroName }}
        </h1>
        <div class="flex items-center gap-4 mt-1">
          <span class="text-dota-text-dim text-sm">{{ hero.totalMatches }} matches</span>
          <span
            class="font-mono text-sm font-medium"
            :class="hero.winRate >= 50 ? 'text-dota-green' : 'text-dota-red'"
          >
            {{ hero.winRate.toFixed(1) }}% WR
          </span>
          <span v-if="(hero.kills ?? 0) + (hero.deaths ?? 0) + (hero.assists ?? 0) > 0"
            class="text-dota-text-dim text-sm font-mono"
          >
            {{ hero.kills }}/{{ hero.deaths }}/{{ hero.assists }} K/D/A
          </span>
        </div>
        <div class="flex flex-wrap gap-2 mt-2">
          <button
            v-for="tab in hero.roleTabs"
            :key="tab.role"
            type="button"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium capitalize cursor-pointer transition-colors"
            style="background-color: var(--color-dota-bg-light);"
            :style="{
              border: `1px solid ${tab.role === activeRole ? 'var(--color-dota-gold)' : 'var(--color-dota-border)'}`,
            }"
            @click="$emit('select-role', tab.role)"
          >
            <span :class="tab.role === activeRole ? 'text-dota-gold' : 'text-dota-text'">{{ tab.role.replace('_', ' ') }}</span>
            <span class="font-mono" :class="tab.winRate >= 50 ? 'text-dota-green' : 'text-dota-red'">
              {{ tab.winRate.toFixed(1) }}%
            </span>
            <span class="text-dota-text-dim">{{ tab.matches }} games</span>
            <span
              v-if="buildRoles.includes(tab.role)"
              class="w-1.5 h-1.5 rounded-full"
              style="background-color: var(--color-dota-gold);"
              title="Build available"
            />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
