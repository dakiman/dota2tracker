<script setup lang="ts">
import type { TalentChoice } from '@friendtracker/shared'

defineProps<{ talents: TalentChoice[] }>()
</script>

<template>
  <div
    class="p-4 rounded border"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <h3 class="text-dota-gold font-medium mb-3">Talents</h3>
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <div
        v-for="t in talents"
        :key="t.level"
        class="flex items-center justify-between gap-2 py-2 px-3 rounded text-sm"
        style="background-color: var(--color-dota-bg-light);"
      >
        <span class="text-dota-text-dim">Lvl {{ t.level }}</span>
        <span class="font-mono text-dota-green">{{ t.winRate }}%</span>
        <span class="text-dota-text-dim">{{ t.picked === 'left' ? t.left : t.right }}</span>
      </div>
    </div>
  </div>
</template>
