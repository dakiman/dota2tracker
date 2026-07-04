<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useApi, ApiError } from '@/composables/useApi'
import { useConfigStore } from '@/stores/config'
import type { HeroStat, MatchesResponse, MatchFeedEntry } from '@friendtracker/shared'
import HeroTable from '@/components/meta/HeroTable.vue'
import RoleFilterTabs from '@/components/meta/RoleFilterTabs.vue'
import MatchCard from '@/components/feed/MatchCard.vue'
import ErrorState from '@/components/layout/ErrorState.vue'

const route = useRoute()
const config = useConfigStore()

const playerId = computed(() => route.params.id as string)
const player = computed(() => config.players.find((p) => p.id === playerId.value) ?? null)

const configReady = ref(false)
const heroStats = ref<HeroStat[]>([])
const recent = ref<MatchFeedEntry[]>([])
const role = ref<string>('')
const loading = ref(true)
const error = ref<ApiError | null>(null)

let currentLoadId = 0

async function load() {
  if (!player.value) return
  const loadId = ++currentLoadId
  loading.value = true
  error.value = null
  try {
    const [stats, matchData] = await Promise.all([
      useApi<HeroStat[]>('/api/meta', { players: playerId.value }),
      useApi<MatchesResponse>('/api/matches', { players: playerId.value, limit: '10' }),
    ])
    if (loadId !== currentLoadId) return
    heroStats.value = stats
    recent.value = matchData.matches
  } catch (e) {
    if (loadId !== currentLoadId) return
    heroStats.value = []
    recent.value = []
    error.value = e instanceof ApiError ? e : new ApiError('Failed to load player data', 0)
  } finally {
    if (loadId === currentLoadId) loading.value = false
  }
}

// Every player_matches row lands in exactly one meta row, so sums are exact.
const totals = computed(() => {
  const matches = heroStats.value.reduce((n, h) => n + h.matches, 0)
  const wins = heroStats.value.reduce((n, h) => n + h.wins, 0)
  return { matches, wins, winRate: matches > 0 ? (wins / matches) * 100 : 0 }
})

// This player's W/L in each recent match, newest first
const form = computed(() =>
  recent.value.map(
    (m) => m.participants.find((p) => p.playerId === playerId.value)?.won ?? false
  )
)

const filteredHeroes = computed(() =>
  role.value ? heroStats.value.filter((h) => h.role === role.value) : heroStats.value
)

onMounted(async () => {
  await config.load()
  configReady.value = true
  if (player.value) {
    load()
  } else {
    loading.value = false
  }
})
watch(playerId, load)
</script>

<template>
  <div v-if="!configReady" class="text-dota-text-dim py-12 text-center">Loading…</div>
  <ErrorState v-else-if="!player" :status="404" not-found-message="Player not found">
    <RouterLink to="/" class="text-sm" style="color: var(--color-dota-gold);">
      ← Back home
    </RouterLink>
  </ErrorState>
  <div v-else class="space-y-6">
    <div class="flex items-center gap-4">
      <img
        v-if="player.avatar"
        :src="player.avatar"
        :alt="player.name"
        class="w-16 h-16 rounded"
      />
      <div>
        <h1 class="font-heading text-3xl text-dota-gold">{{ player.name }}</h1>
        <p class="text-sm text-dota-text-dim">
          {{ totals.matches }} matches ·
          <span :class="totals.winRate >= 50 ? 'text-dota-green' : 'text-dota-red'">
            {{ totals.winRate.toFixed(1) }}% WR
          </span>
        </p>
      </div>
      <div v-if="form.length" class="ml-auto flex gap-1" title="Recent form, newest first">
        <span
          v-for="(won, i) in form"
          :key="i"
          class="w-2.5 h-2.5 rounded-full"
          :style="{ backgroundColor: won ? 'var(--color-dota-green)' : 'var(--color-dota-red)' }"
        />
      </div>
    </div>

    <div v-if="loading" class="text-dota-text-dim py-12 text-center">Loading…</div>
    <ErrorState v-else-if="error" :status="error.status" @retry="load" />
    <template v-else>
      <section>
        <h2 class="font-heading text-xl text-dota-gold mb-3">Heroes</h2>
        <RoleFilterTabs v-model="role" class="mb-4" />
        <HeroTable :heroes="filteredHeroes" />
      </section>
      <section>
        <h2 class="font-heading text-xl text-dota-gold mb-3">Recent matches</h2>
        <div class="space-y-3">
          <MatchCard v-for="m in recent" :key="m.matchId" :match="m" />
        </div>
        <div v-if="recent.length === 0" class="text-dota-text-dim py-8 text-center">
          No recent matches.
        </div>
      </section>
    </template>
  </div>
</template>
