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
            v-if="s.wins > 0"
            class="h-2 rounded"
            :style="{ width: `${(s.wins / (s.wins + s.draws + s.losses)) * 100}%`, backgroundColor: 'var(--color-dota-green)' }"
            :title="`Wins: ${s.wins}`"
          />
          <span
            v-if="s.draws > 0"
            class="h-2 rounded"
            :style="{ width: `${(s.draws / (s.wins + s.draws + s.losses)) * 100}%`, backgroundColor: 'var(--color-dota-text-dim)' }"
            :title="`Draws: ${s.draws}`"
          />
          <span
            v-if="s.losses > 0"
            class="h-2 rounded"
            :style="{ width: `${(s.losses / (s.wins + s.draws + s.losses)) * 100}%`, backgroundColor: 'var(--color-dota-red)' }"
            :title="`Losses: ${s.losses}`"
          />
        </div>
      </div>
    </div>
  </div>
</template>
