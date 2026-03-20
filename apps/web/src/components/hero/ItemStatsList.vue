<script setup lang="ts">
import { itemImageUrl } from '@friendtracker/shared'
import type { SituationalItem } from '@friendtracker/shared'

defineProps<{ items: SituationalItem[] }>()
</script>

<template>
  <div
    class="p-4 rounded border flex flex-wrap gap-4"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <div
      v-for="item in items"
      :key="item.itemName"
      class="flex items-center gap-3"
    >
      <img
        :src="itemImageUrl(item.itemImage)"
        :alt="item.itemName"
        class="w-10 h-10 rounded object-cover border"
        style="border-color: var(--color-dota-border);"
      />
      <div class="text-sm">
        <span class="text-dota-text">{{ item.itemName.replace(/_/g, ' ') }}</span>
        <span class="text-dota-text-dim font-mono ml-2">
          {{ item.purchaseRate }}% · avg {{ item.avgMinute }} min
        </span>
      </div>
    </div>
  </div>
</template>
