<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useApi } from '@/composables/useApi'
import { usePlayerFilterStore } from '@/stores/playerFilter'
import type { AppConfig } from '@friendtracker/shared'

const store = usePlayerFilterStore()
const open = ref(false)
const config = ref<AppConfig | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)

const players = computed(() => config.value?.players ?? [])

function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    open.value = false
  }
}

onMounted(async () => {
  document.addEventListener('click', handleClickOutside)
  try {
    config.value = await useApi<AppConfig>('/api/config')
  } catch {
    config.value = { players: [], siteName: 'FriendTracker' }
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})

function toggle(id: string) {
  store.toggle(id)
}
</script>

<template>
  <div class="relative" ref="dropdownRef">
    <button
      type="button"
      class="px-3 py-2 rounded border text-sm flex items-center gap-2"
      style="border-color: var(--color-dota-border); color: var(--color-dota-text);"
      @click="open = !open"
    >
      Players
      <span class="text-dota-text-dim text-xs">
        {{ store.selectedPlayerIds.length === 0 ? 'All' : store.selectedPlayerIds.length }}
      </span>
    </button>
    <div
      v-if="open"
      class="absolute right-0 top-full mt-1 py-2 rounded shadow-xl min-w-[200px] max-h-[320px] overflow-auto"
      style="background-color: var(--color-dota-bg-card); border: 1px solid var(--color-dota-border);"
    >
      <button
        type="button"
        class="w-full text-left px-4 py-2 text-sm hover:bg-dota-bg-light"
        style="color: var(--color-dota-gold);"
        @click="store.selectAll()"
      >
        Reset filter
      </button>
      <div class="border-t my-1" style="border-color: var(--color-dota-border);" />
      <label
        v-for="p in players"
        :key="p.id"
        class="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-dota-bg-light text-sm"
      >
        <input
          type="checkbox"
          :checked="store.selectedPlayerIds.length === 0 || store.selectedPlayerIds.includes(p.id)"
          @change="toggle(p.id)"
        />
        <span>{{ p.name }}</span>
      </label>
    </div>
  </div>
</template>
