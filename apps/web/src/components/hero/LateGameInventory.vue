<script setup lang="ts">
import { itemImageUrl } from '@friendtracker/shared'

defineProps<{
  inventories: Array<{ bracket: string; items: string[] }>
}>()
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    <div
      v-for="inv in inventories"
      :key="inv.bracket"
      class="p-4 rounded border"
      style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
    >
      <h4 class="text-dota-gold text-sm font-medium mb-2">{{ inv.bracket }}</h4>
      <div class="flex flex-wrap gap-2">
        <img
          v-for="item in inv.items"
          :key="item"
          :src="itemImageUrl(item)"
          :alt="item"
          class="w-10 h-10 rounded object-cover border"
          style="border-color: var(--color-dota-border);"
        />
      </div>
    </div>
  </div>
</template>
