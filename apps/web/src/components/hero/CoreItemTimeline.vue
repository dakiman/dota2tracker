<script setup lang="ts">
import { itemImageUrl } from '@friendtracker/shared'
import type { ItemGroup } from '@friendtracker/shared'

defineProps<{ groups: ItemGroup[] }>()
</script>

<template>
  <div class="space-y-4">
    <div
      v-for="(g, i) in groups"
      :key="i"
      class="p-4 rounded border flex flex-wrap items-center gap-3"
      style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
    >
      <span
        class="px-2 py-0.5 rounded text-xs font-medium"
        style="background-color: var(--color-dota-gold-dark); color: var(--color-dota-bg);"
      >
        CORE
      </span>
      <img
        v-for="item in g.items"
        :key="item"
        :src="itemImageUrl(item)"
        :alt="item"
        class="w-12 h-12 rounded object-cover border"
        style="border-color: var(--color-dota-border);"
      />
      <span class="text-dota-text-dim text-sm font-mono">
        {{ g.winRate.toFixed(1) }}% · {{ g.matches }} games
      </span>
    </div>
  </div>
</template>
