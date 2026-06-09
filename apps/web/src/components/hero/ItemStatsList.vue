<script setup lang="ts">
import { itemImageUrl, formatItemName } from '@friendtracker/shared'
import type { SituationalItem } from '@friendtracker/shared'

defineProps<{ items: SituationalItem[] }>()
</script>

<template>
  <div
    class="rounded-lg border overflow-hidden"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <div
      v-for="(item, i) in items"
      :key="item.itemName"
      class="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-dota-bg-light"
      :class="i < items.length - 1 ? 'border-b' : ''"
      :style="i < items.length - 1 ? 'border-color: var(--color-dota-border)' : ''"
    >
      <img
        :src="itemImageUrl(item.itemImage)"
        :alt="item.itemName"
        class="w-10 h-[30px] rounded object-cover border"
        style="border-color: var(--color-dota-border);"
      />
      <span class="text-dota-text text-sm flex-1">{{ formatItemName(item.itemName) }}</span>
      <span v-if="item.purchaseRate > 0" class="text-xs font-mono text-dota-text-dim">
        {{ item.purchaseRate }}% pick
      </span>
      <span v-if="item.avgMinute > 0" class="text-xs font-mono text-dota-text-dim">
        ~{{ item.avgMinute }}m
      </span>
    </div>
  </div>
</template>
