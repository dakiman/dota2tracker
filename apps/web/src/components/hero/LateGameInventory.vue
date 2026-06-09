<script setup lang="ts">
import { itemImageUrl, formatItemName } from '@friendtracker/shared'

defineProps<{
  inventories: Array<{ bracket: string; items: string[] }>
}>()
</script>

<template>
  <div class="space-y-3">
    <div
      v-for="inv in inventories"
      :key="inv.bracket"
      class="p-3 rounded-lg border"
      style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
    >
      <div class="text-xs font-mono text-dota-text-dim mb-2">{{ inv.bracket }}</div>
      <!-- 6-slot inventory grid mimicking in-game -->
      <div class="inline-grid grid-cols-3 gap-0.5 rounded overflow-hidden border" style="border-color: var(--color-dota-border);">
        <div
          v-for="slot in 6"
          :key="slot"
          class="w-14 h-10 relative group"
          style="background-color: var(--color-dota-bg-light);"
        >
          <img
            v-if="inv.items[slot - 1]"
            :src="itemImageUrl(inv.items[slot - 1])"
            :alt="inv.items[slot - 1]"
            class="w-full h-full object-cover transition-all duration-150 group-hover:brightness-125"
          />
          <div v-if="inv.items[slot - 1]" class="absolute -bottom-7 left-1/2 -translate-x-1/2 bg-black/90 text-dota-text text-xs px-2 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 transition-opacity">
            {{ formatItemName(inv.items[slot - 1]) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
