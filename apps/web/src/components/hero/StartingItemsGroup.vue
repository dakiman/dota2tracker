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
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1.5">
          <div
            v-for="item in g.items"
            :key="item"
            class="relative group"
          >
            <img
              :src="itemImageUrl(item)"
              :alt="item"
              class="w-10 h-[30px] rounded object-cover border transition-all duration-150 group-hover:border-[var(--color-dota-gold-dark)] group-hover:brightness-125"
              style="border-color: var(--color-dota-border);"
            />
            <div class="absolute -bottom-7 left-1/2 -translate-x-1/2 bg-black/90 text-dota-text text-xs px-2 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 transition-opacity">
              {{ formatItemName(item) }}
            </div>
          </div>
        </div>
        <div v-if="g.matches > 0" class="ml-auto text-xs font-mono text-dota-text-dim">
          <span :class="g.winRate >= 50 ? 'text-dota-green' : 'text-dota-red'">{{ g.winRate.toFixed(1) }}%</span>
          <span class="ml-1">{{ g.matches }} games</span>
        </div>
      </div>
    </div>
  </div>
</template>
