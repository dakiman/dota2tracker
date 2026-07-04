<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useApi, ApiError } from '@/composables/useApi'
import { usePlayerFilterStore } from '@/stores/playerFilter'
import { useConfigStore } from '@/stores/config'
import type { MatchesResponse, MatchFeedEntry } from '@friendtracker/shared'
import MatchCard from '@/components/feed/MatchCard.vue'
import ErrorState from '@/components/layout/ErrorState.vue'

const store = usePlayerFilterStore()
const config = useConfigStore()

const matches = ref<MatchFeedEntry[]>([])
const nextBefore = ref<number | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref<ApiError | null>(null)

let currentLoadId = 0

function buildQuery(before?: number | null): Record<string, string> {
  const query: Record<string, string> = {}
  if (store.selectedPlayerIds.length) {
    query.players = store.selectedPlayerIds.join(',')
  }
  if (before) query.before = String(before)
  return query
}

async function load() {
  const loadId = ++currentLoadId
  loading.value = true
  error.value = null
  try {
    const result = await useApi<MatchesResponse>('/api/matches', buildQuery())
    if (loadId !== currentLoadId) return
    matches.value = result.matches
    nextBefore.value = result.nextBefore
  } catch (e) {
    if (loadId !== currentLoadId) return
    matches.value = []
    error.value = e instanceof ApiError ? e : new ApiError('Failed to load matches', 0)
  } finally {
    if (loadId === currentLoadId) loading.value = false
  }
}

async function loadMore() {
  if (!nextBefore.value || loadingMore.value) return
  const loadId = currentLoadId
  loadingMore.value = true
  try {
    const result = await useApi<MatchesResponse>('/api/matches', buildQuery(nextBefore.value))
    if (loadId !== currentLoadId) return
    matches.value = [...matches.value, ...result.matches]
    nextBefore.value = result.nextBefore
  } catch {
    // keep the loaded feed; the button stays for another attempt
  } finally {
    loadingMore.value = false
  }
}

onMounted(load)
watch(() => store.selectedPlayerIds, load)
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <h1 class="font-heading text-3xl text-dota-gold mb-1">{{ config.siteName }}</h1>
    <p class="text-dota-text-dim text-sm mb-6">Latest games from the stack.</p>

    <div v-if="loading" class="text-dota-text-dim py-12 text-center">Loading…</div>
    <ErrorState v-else-if="error" :status="error.status" @retry="load" />
    <div v-else-if="matches.length === 0" class="text-dota-text-dim py-12 text-center">
      No matches yet. Data lands after the next refresh run.
    </div>
    <template v-else>
      <div class="space-y-3">
        <MatchCard v-for="m in matches" :key="m.matchId" :match="m" />
      </div>
      <div v-if="nextBefore" class="mt-6 text-center">
        <button
          class="px-4 py-2 rounded bg-dota-gold-dark text-dota-bg hover:bg-dota-gold transition disabled:opacity-50"
          :disabled="loadingMore"
          @click="loadMore"
        >
          {{ loadingMore ? 'Loading…' : 'Load more' }}
        </button>
      </div>
    </template>
  </div>
</template>
