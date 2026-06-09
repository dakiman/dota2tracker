<script setup lang="ts">
import { itemImageUrl, formatItemName } from '@friendtracker/shared'
import type { ItemGroup } from '@friendtracker/shared'

defineProps<{ groups: ItemGroup[] }>()
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="(g, i) in groups"
      :key="i"
      class="p-3 rounded-lg border"
      style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
    >
      <div class="flex items-center gap-1">
        <template v-for="(item, j) in g.items" :key="item + j">
          <div class="relative group">
            <img
              :src="itemImageUrl(item)"
              :alt="item"
              class="w-12 h-9 rounded object-cover border transition-all duration-150 group-hover:border-[var(--color-dota-gold-dark)] group-hover:brightness-125"
              style="border-color: var(--color-dota-border);"
            />
            <div class="absolute -bottom-7 left-1/2 -translate-x-1/2 bg-black/90 text-dota-text text-xs px-2 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 transition-opacity">
              {{ formatItemName(item) }}
            </div>
          </div>
          <!-- Arrow between items -->
          <svg v-if="j < g.items.length - 1" class="w-4 h-4 text-dota-text-dim shrink-0" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10M10 4l3 4-3 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </template>
        <div v-if="g.matches > 0" class="ml-auto text-xs font-mono text-dota-text-dim pl-3">
          <span :class="g.winRate >= 50 ? 'text-dota-green' : 'text-dota-red'">{{ g.winRate.toFixed(1) }}%</span>
          <span class="ml-1">{{ g.matches }}g</span>
        </div>
      </div>
    </div>
  </div>
</template>
