<script setup lang="ts">
import { itemImageUrl } from '@friendtracker/shared'
import type { ItemGroup } from '@friendtracker/shared'

defineProps<{ groups: ItemGroup[] }>()
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <div
      v-for="(g, i) in groups"
      :key="i"
      class="p-4 rounded border flex flex-wrap items-center gap-2"
      style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
    >
      <img
        v-for="item in g.items"
        :key="item"
        :src="itemImageUrl(item)"
        :alt="item"
        class="w-10 h-10 rounded object-cover border"
        style="border-color: var(--color-dota-border);"
      />
      <span class="text-dota-text-dim text-sm font-mono ml-auto">
        {{ g.winRate.toFixed(1) }}% WR · {{ g.matches }} games
      </span>
    </div>
  </div>
</template>
