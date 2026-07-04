<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { RouterLink } from 'vue-router'
import { usePlayerFilterStore } from '@/stores/playerFilter'
import { useConfigStore } from '@/stores/config'

const store = usePlayerFilterStore()
const config = useConfigStore()
const open = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

const players = computed(() => config.players)

function handleClickOutside(event: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  config.load()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})

function toggle(id: string) {
  // Empty selection means "all players", so unchecking one from that state
  // should keep everyone else selected, not select only the clicked player.
  if (store.isAllSelected) {
    store.setFromQuery(players.value.filter((p) => p.id !== id).map((p) => p.id))
  } else {
    store.toggle(id)
  }
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
        <span class="flex-1">{{ p.name }}</span>
        <RouterLink
          :to="`/player/${p.id}`"
          class="text-dota-text-dim hover:text-dota-gold transition-colors text-xs"
          title="View profile"
          @click.stop="open = false"
        >
          →
        </RouterLink>
      </label>
    </div>
  </div>
</template>
