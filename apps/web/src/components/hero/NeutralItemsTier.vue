<script setup lang="ts">
import { itemImageUrl } from '@friendtracker/shared'
import type { NeutralTierGroup } from '@friendtracker/shared'

defineProps<{ tierGroup: NeutralTierGroup }>()
</script>

<template>
  <div
    class="p-3 rounded-lg border"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <div class="flex items-center gap-2 mb-2">
      <span class="text-xs font-mono font-bold px-1.5 py-0.5 rounded" style="background-color: var(--color-dota-gold-dark); color: var(--color-dota-bg);">
        T{{ tierGroup.tier }}
      </span>
      <span class="text-xs text-dota-text-dim">Neutral items</span>
    </div>
    <div class="flex flex-wrap gap-2">
      <div
        v-for="item in tierGroup.items"
        :key="item.name"
        class="flex items-center gap-2 px-2 py-1.5 rounded transition-colors hover:bg-dota-bg-light"
        :class="item.isBest ? 'ring-1 ring-dota-gold/50' : ''"
      >
        <img
          :src="itemImageUrl(item.image)"
          :alt="item.name"
          class="w-9 h-[27px] rounded object-cover border"
          style="border-color: var(--color-dota-border);"
        />
        <div class="text-xs">
          <div class="font-mono">
            <span class="text-dota-text-dim">{{ item.pickRate }}%</span>
            <span class="ml-1" :class="item.winRate >= 50 ? 'text-dota-green' : 'text-dota-red'">{{ item.winRate }}%</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
