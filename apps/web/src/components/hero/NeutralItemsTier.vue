<script setup lang="ts">
import { itemImageUrl } from '@friendtracker/shared'
import type { NeutralTierGroup } from '@friendtracker/shared'

defineProps<{ tierGroup: NeutralTierGroup }>()
</script>

<template>
  <div
    class="p-4 rounded border"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <h4 class="text-dota-gold text-sm font-medium mb-2">Tier {{ tierGroup.tier }}</h4>
    <div class="flex flex-wrap gap-2">
      <div
        v-for="item in tierGroup.items"
        :key="item.name"
        class="flex flex-col items-center gap-1"
      >
        <img
          :src="itemImageUrl(item.image)"
          :alt="item.name"
          :class="['w-10 h-10 rounded object-cover border', item.isBest && 'ring-2 ring-dota-gold']"
          style="border-color: var(--color-dota-border);"
        />
        <span class="text-xs font-mono text-dota-text-dim">{{ item.pickRate }}% · {{ item.winRate }}%</span>
      </div>
    </div>
  </div>
</template>
