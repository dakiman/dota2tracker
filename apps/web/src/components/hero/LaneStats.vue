<script setup lang="ts">
import type { LaneStats as LaneStatsType } from '@friendtracker/shared'

defineProps<{ stats: LaneStatsType[] }>()
</script>

<template>
  <div
    class="p-6 rounded border"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <h2 class="font-heading text-xl text-dota-gold mb-4">Lane stats</h2>
    <div class="space-y-4">
      <div
        v-for="s in stats"
        :key="s.lane"
        class="flex items-center gap-4"
      >
        <span class="w-24 text-dota-text">{{ s.lane }}</span>
        <span class="font-mono text-dota-text-dim">{{ s.advantagePct }}% adv</span>
        <div class="flex-1 flex gap-1">
          <span
            class="h-2 rounded"
            style="width: 33%; background-color: var(--color-dota-green);"
            :title="`Wins: ${s.wins}`"
          />
          <span
            class="h-2 rounded"
            style="width: 10%; background-color: var(--color-dota-text-dim);"
            :title="`Draws: ${s.draws}`"
          />
          <span
            class="h-2 rounded"
            style="width: 33%; background-color: var(--color-dota-red);"
            :title="`Losses: ${s.losses}`"
          />
        </div>
      </div>
    </div>
  </div>
</template>
