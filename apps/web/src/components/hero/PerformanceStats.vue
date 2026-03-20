<script setup lang="ts">
import type { StatsData } from '@friendtracker/shared'

defineProps<{ stats: StatsData }>()
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <div
      v-if="stats.radiantWinRate != null || stats.direWinRate != null"
      class="p-4 rounded border"
      style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
    >
      <h3 class="text-dota-gold text-sm font-medium mb-2">Radiant vs Dire</h3>
      <p class="font-mono text-dota-text">
        Radiant {{ stats.radiantWinRate?.toFixed(1) }}% · Dire {{ stats.direWinRate?.toFixed(1) }}%
      </p>
    </div>
    <div
      v-if="stats.networthAt10 != null"
      class="p-4 rounded border"
      style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
    >
      <h3 class="text-dota-gold text-sm font-medium mb-2">Networth</h3>
      <p class="font-mono text-dota-text-dim text-sm">
        10m: {{ stats.networthAt10 }} · 15m: {{ stats.networthAt15 }} · 20m: {{ stats.networthAt20 }}
      </p>
    </div>
    <div
      v-if="stats.pickPhases?.length"
      class="p-4 rounded border"
      style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
    >
      <h3 class="text-dota-gold text-sm font-medium mb-2">Pick phase WR</h3>
      <div class="space-y-1 text-sm font-mono text-dota-text-dim">
        <p v-for="p in stats.pickPhases" :key="p.phase">{{ p.phase }}: {{ p.winRate }}%</p>
      </div>
    </div>
    <div
      v-if="stats.matchDurationWinRate?.length"
      class="p-4 rounded border"
      style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
    >
      <h3 class="text-dota-gold text-sm font-medium mb-2">Duration WR</h3>
      <div class="space-y-1 text-sm font-mono text-dota-text-dim">
        <p v-for="d in stats.matchDurationWinRate" :key="d.bracket">{{ d.bracket }}: {{ d.winRate }}%</p>
      </div>
    </div>
  </div>
</template>
