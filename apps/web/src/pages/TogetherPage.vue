<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useApi, ApiError } from '@/composables/useApi'
import { usePlayerFilterStore } from '@/stores/playerFilter'
import { useConfigStore } from '@/stores/config'
import type { TogetherResponse } from '@friendtracker/shared'
import ErrorState from '@/components/layout/ErrorState.vue'

// Pairs under this many games are listed but excluded from best/worst badges.
const MIN_DUO_MATCHES = 5

const store = usePlayerFilterStore()
const config = useConfigStore()

const data = ref<TogetherResponse | null>(null)
const loading = ref(true)
const error = ref<ApiError | null>(null)

let currentLoadId = 0

function playerName(id: string): string {
  return config.players.find((p) => p.id === id)?.name ?? id
}

async function load() {
  const loadId = ++currentLoadId
  loading.value = true
  error.value = null
  try {
    const query: Record<string, string> = {}
    if (store.selectedPlayerIds.length) {
      query.players = store.selectedPlayerIds.join(',')
    }
    const result = await useApi<TogetherResponse>('/api/together', query)
    if (loadId !== currentLoadId) return
    data.value = result
  } catch (e) {
    if (loadId !== currentLoadId) return
    data.value = null
    error.value = e instanceof ApiError ? e : new ApiError('Failed to load together stats', 0)
  } finally {
    if (loadId === currentLoadId) loading.value = false
  }
}

type SortKey = 'matches' | 'winRate'
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

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return ''
  return sortDesc.value ? ' ↓' : ' ↑'
}

const sortedDuos = computed(() => {
  const arr = [...(data.value?.duos ?? [])]
  arr.sort((a, b) =>
    sortDesc.value ? b[sortKey.value] - a[sortKey.value] : a[sortKey.value] - b[sortKey.value]
  )
  return arr
})

const eligibleByWr = computed(() =>
  (data.value?.duos ?? [])
    .filter((d) => d.matches >= MIN_DUO_MATCHES)
    .sort((a, b) => b.winRate - a.winRate)
)
const bestDuo = computed(() => eligibleByWr.value[0] ?? null)
const worstDuo = computed(() =>
  eligibleByWr.value.length > 1 ? eligibleByWr.value[eligibleByWr.value.length - 1] : null
)

const playersWithGames = computed(() =>
  (data.value?.players ?? []).filter((p) => p.togetherMatches + p.soloMatches > 0)
)

onMounted(() => {
  config.load()
  load()
})
watch(() => store.selectedPlayerIds, load)
</script>

<template>
  <div>
    <h1 class="font-heading text-3xl text-dota-gold mb-6">Played Together</h1>
    <div v-if="loading" class="text-dota-text-dim py-12 text-center">Loading…</div>
    <ErrorState v-else-if="error" :status="error.status" @retry="load" />
    <template v-else-if="data">
      <section class="mb-8">
        <h2 class="font-heading text-xl text-dota-gold mb-3">Duos</h2>
        <div
          class="rounded border overflow-x-auto"
          style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
        >
          <table class="w-full">
            <thead>
              <tr style="background-color: var(--color-dota-bg-light);">
                <th class="text-left py-3 px-4 text-dota-gold font-heading">Duo</th>
                <th
                  class="text-right py-3 px-4 text-dota-text-dim cursor-pointer select-none hover:text-dota-gold transition-colors"
                  @click="toggleSort('matches')"
                >
                  Games{{ sortIndicator('matches') }}
                </th>
                <th class="text-right py-3 px-4 text-dota-text-dim">Wins</th>
                <th
                  class="text-right py-3 px-4 text-dota-text-dim cursor-pointer select-none hover:text-dota-gold transition-colors"
                  @click="toggleSort('winRate')"
                >
                  WR%{{ sortIndicator('winRate') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="d in sortedDuos"
                :key="`${d.playerA}-${d.playerB}`"
                class="border-t"
                style="border-color: var(--color-dota-border);"
              >
                <td class="py-2 px-4">
                  {{ playerName(d.playerA) }} + {{ playerName(d.playerB) }}
                  <span
                    v-if="d === bestDuo"
                    class="ml-2 text-xs px-1.5 py-0.5 rounded"
                    style="background-color: var(--color-dota-green); color: var(--color-dota-bg);"
                  >
                    Best duo
                  </span>
                  <span
                    v-else-if="d === worstDuo"
                    class="ml-2 text-xs px-1.5 py-0.5 rounded"
                    style="background-color: var(--color-dota-red); color: var(--color-dota-text);"
                  >
                    Worst duo
                  </span>
                  <span v-if="d.matches < MIN_DUO_MATCHES" class="ml-2 text-xs text-dota-text-dim">
                    (few games)
                  </span>
                </td>
                <td class="text-right py-2 px-4 font-mono">{{ d.matches }}</td>
                <td class="text-right py-2 px-4 font-mono">{{ d.wins }}</td>
                <td
                  class="text-right py-2 px-4 font-mono"
                  :class="d.winRate >= 50 ? 'text-dota-green' : 'text-dota-red'"
                >
                  {{ d.winRate.toFixed(1) }}%
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="sortedDuos.length === 0" class="p-8 text-center text-dota-text-dim">
            No games with two tracked players on the same team yet.
          </div>
        </div>
      </section>

      <section>
        <h2 class="font-heading text-xl text-dota-gold mb-3">Together vs Solo</h2>
        <div class="space-y-4">
          <div
            v-for="p in playersWithGames"
            :key="p.playerId"
            class="rounded border px-4 py-3"
            style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
          >
            <RouterLink
              :to="`/player/${p.playerId}`"
              class="font-medium hover:text-dota-gold transition-colors"
              style="color: var(--color-dota-text);"
            >
              {{ playerName(p.playerId) }}
            </RouterLink>
            <div class="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <div class="flex justify-between text-xs text-dota-text-dim mb-1">
                  <span>With friends ({{ p.togetherMatches }})</span>
                  <span class="font-mono">{{ p.togetherWinRate.toFixed(1) }}%</span>
                </div>
                <div
                  class="h-2 rounded overflow-hidden"
                  style="background-color: var(--color-dota-bg-light);"
                >
                  <div
                    class="h-full"
                    :style="{ width: `${p.togetherWinRate}%`, backgroundColor: 'var(--color-dota-green)' }"
                  />
                </div>
              </div>
              <div>
                <div class="flex justify-between text-xs text-dota-text-dim mb-1">
                  <span>Solo ({{ p.soloMatches }})</span>
                  <span class="font-mono">{{ p.soloWinRate.toFixed(1) }}%</span>
                </div>
                <div
                  class="h-2 rounded overflow-hidden"
                  style="background-color: var(--color-dota-bg-light);"
                >
                  <div
                    class="h-full"
                    :style="{ width: `${p.soloWinRate}%`, backgroundColor: 'var(--color-dota-gold)' }"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
