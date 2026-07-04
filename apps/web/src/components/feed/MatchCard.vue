<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { heroCropUrl } from '@friendtracker/shared'
import type { MatchFeedEntry } from '@friendtracker/shared'
import { relativeTime } from '@/utils/relativeTime'
import { formatDuration } from '@/utils/formatDuration'

const props = defineProps<{ match: MatchFeedEntry }>()

// All tracked participants on the winning side -> win; all losing -> loss;
// otherwise friends were on opposite teams.
const verdict = computed<'win' | 'loss' | 'mixed'>(() => {
  const wins = props.match.participants.filter((p) => p.won).length
  if (wins === props.match.participants.length) return 'win'
  if (wins === 0) return 'loss'
  return 'mixed'
})

const VERDICT_LABEL = { win: 'Victory', loss: 'Defeat', mixed: 'Crossed paths' } as const
const VERDICT_COLOR = {
  win: 'var(--color-dota-green)',
  loss: 'var(--color-dota-red)',
  mixed: 'var(--color-dota-gold)',
} as const
</script>

<template>
  <div
    class="rounded border border-l-4 px-4 py-3"
    :style="{
      borderColor: 'var(--color-dota-border)',
      borderLeftColor: VERDICT_COLOR[verdict],
      backgroundColor: 'var(--color-dota-bg-card)',
    }"
  >
    <div class="flex items-center justify-between text-xs text-dota-text-dim mb-2">
      <span class="font-medium" :style="{ color: VERDICT_COLOR[verdict] }">
        {{ VERDICT_LABEL[verdict] }}
      </span>
      <span>{{ relativeTime(match.startTime) }} · {{ formatDuration(match.duration) }}</span>
    </div>
    <div class="space-y-1.5">
      <div
        v-for="p in match.participants"
        :key="p.playerId"
        class="flex items-center gap-3 text-sm"
      >
        <img
          :src="heroCropUrl(p.heroSlug)"
          :alt="p.heroName"
          class="w-8 h-8 rounded object-cover"
        />
        <RouterLink
          :to="`/player/${p.playerId}`"
          class="font-medium hover:text-dota-gold transition-colors"
          style="color: var(--color-dota-text);"
        >
          {{ p.playerName }}
        </RouterLink>
        <span class="text-dota-text-dim">{{ p.heroName }}</span>
        <span class="ml-auto font-mono text-dota-text-dim">
          {{ p.kills }}/{{ p.deaths }}/{{ p.assists }}
        </span>
        <span
          v-if="verdict === 'mixed'"
          class="font-mono text-xs w-4 text-center"
          :style="{ color: p.won ? 'var(--color-dota-green)' : 'var(--color-dota-red)' }"
        >
          {{ p.won ? 'W' : 'L' }}
        </span>
      </div>
    </div>
  </div>
</template>
