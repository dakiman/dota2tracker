<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useApi, ApiError } from '@/composables/useApi'
import { usePlayerFilterStore } from '@/stores/playerFilter'
import type { HeroStat } from '@friendtracker/shared'
import HeroTable from '@/components/meta/HeroTable.vue'
import RoleFilterTabs from '@/components/meta/RoleFilterTabs.vue'
import ErrorState from '@/components/layout/ErrorState.vue'

const store = usePlayerFilterStore()
const role = ref<string>('')
const heroes = ref<HeroStat[]>([])
const loading = ref(true)
const error = ref<ApiError | null>(null)

let currentLoadId = 0

async function load() {
  const loadId = ++currentLoadId
  loading.value = true
  error.value = null
  try {
    const query: Record<string, string> = {}
    if (store.selectedPlayerIds.length) {
      query.players = store.selectedPlayerIds.join(',')
    }
    if (role.value) query.role = role.value
    const result = await useApi<HeroStat[]>('/api/meta', query)
    if (loadId !== currentLoadId) return
    heroes.value = result
  } catch (e) {
    if (loadId !== currentLoadId) return
    heroes.value = []
    error.value = e instanceof ApiError ? e : new ApiError('Failed to load hero stats', 0)
  } finally {
    if (loadId === currentLoadId) loading.value = false
  }
}

onMounted(load)
watch([() => store.selectedPlayerIds, role], load)
</script>

<template>
  <div>
    <h1 class="font-heading text-3xl text-dota-gold mb-6">Hero Meta</h1>
    <RoleFilterTabs v-model="role" class="mb-6" />
    <ErrorState v-if="error" :status="error.status" @retry="load" />
    <HeroTable v-else :heroes="heroes" :loading="loading" />
  </div>
</template>
