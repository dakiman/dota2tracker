<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useApi } from '@/composables/useApi'
import { usePlayerFilterStore } from '@/stores/playerFilter'
import type { HeroStat } from '@friendtracker/shared'
import HeroTable from '@/components/meta/HeroTable.vue'
import RoleFilterTabs from '@/components/meta/RoleFilterTabs.vue'

const store = usePlayerFilterStore()
const role = ref<string>('')
const heroes = ref<HeroStat[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  try {
    const query: Record<string, string> = {}
    if (store.selectedPlayerIds.length) {
      query.players = store.selectedPlayerIds.join(',')
    }
    if (role.value) query.role = role.value
    heroes.value = await useApi<HeroStat[]>('/api/meta', query)
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([() => store.selectedPlayerIds, role], load)
</script>

<template>
  <div>
    <h1 class="font-heading text-3xl text-dota-gold mb-6">Hero Meta</h1>
    <RoleFilterTabs v-model="role" class="mb-6" />
    <HeroTable :heroes="heroes" :loading="loading" />
  </div>
</template>
