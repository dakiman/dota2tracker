<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { heroCropUrl } from '@friendtracker/shared'
import type { HeroStat } from '@friendtracker/shared'

const props = defineProps<{
  heroes: HeroStat[]
  loading?: boolean
}>()

type SortKey = 'matches' | 'winRate' | 'kda'
const sortKey = ref<SortKey>('matches')
const sortDesc = ref(true)

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDesc.value = !sortDesc.value
  } else {
    sortKey.value = key
    sortDesc.value = true
  }
}

const sortedHeroes = computed(() => {
  const arr = [...props.heroes]
  arr.sort((a, b) => {
    let valA: number, valB: number
    if (sortKey.value === 'kda') {
      valA = parseFloat(a.kda) || 0
      valB = parseFloat(b.kda) || 0
    } else {
      valA = a[sortKey.value]
      valB = b[sortKey.value]
    }
    return sortDesc.value ? valB - valA : valA - valB
  })
  return arr
})

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return ''
  return sortDesc.value ? ' ↓' : ' ↑'
}
</script>

<template>
  <div
    class="rounded border overflow-x-auto"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <div v-if="loading" class="p-8 text-center text-dota-text-dim">Loading…</div>
    <table v-else class="w-full">
      <thead>
        <tr style="background-color: var(--color-dota-bg-light);">
          <th class="text-left py-3 px-4 text-dota-gold font-heading">Hero</th>
          <th class="text-right py-3 px-4 text-dota-text-dim cursor-pointer select-none hover:text-dota-gold transition-colors" @click="toggleSort('matches')">Matches{{ sortIndicator('matches') }}</th>
          <th class="text-right py-3 px-4 text-dota-text-dim cursor-pointer select-none hover:text-dota-gold transition-colors" @click="toggleSort('winRate')">WR%{{ sortIndicator('winRate') }}</th>
          <th class="text-right py-3 px-4 text-dota-text-dim cursor-pointer select-none hover:text-dota-gold transition-colors hidden sm:table-cell" @click="toggleSort('kda')">KDA{{ sortIndicator('kda') }}</th>
          <th class="text-left py-3 px-4 text-dota-text-dim hidden sm:table-cell">Role</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="h in sortedHeroes"
          :key="h.heroId + (h.role || '')"
          class="border-t hover:bg-dota-bg-light/70 transition cursor-pointer"
          style="border-color: var(--color-dota-border);"
        >
          <td class="py-2 px-4">
            <RouterLink
              :to="{ path: `/hero/${h.heroSlug}`, query: $route.query }"
              class="flex items-center gap-3 font-medium"
              style="color: var(--color-dota-text);"
            >
              <img
                :src="heroCropUrl(h.heroSlug)"
                :alt="h.heroName"
                class="w-12 h-12 rounded object-cover"
              />
              {{ h.heroName }}
            </RouterLink>
          </td>
          <td class="text-right py-2 px-4 font-mono">{{ h.matches }}</td>
          <td class="text-right py-2 px-4 font-mono" :class="h.winRate >= 50 ? 'text-dota-green' : 'text-dota-red'">{{ h.winRate.toFixed(1) }}%</td>
          <td class="text-right py-2 px-4 font-mono hidden sm:table-cell">{{ h.kda }}</td>
          <td class="py-2 px-4 text-dota-text-dim capitalize hidden sm:table-cell">{{ h.role.replace('_', ' ') }}</td>
        </tr>
      </tbody>
    </table>
    <div
      v-if="!loading && heroes.length === 0"
      class="p-8 text-center text-dota-text-dim"
    >
      No heroes match the filter.
    </div>
  </div>
</template>
