import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'

export const usePlayerFilterStore = defineStore('playerFilter', () => {
  const router = useRouter()
  const selectedPlayerIds = ref<string[]>([])

  const isAllSelected = computed(() => {
    return selectedPlayerIds.value.length === 0
  })

  function setFromQuery(ids: string[]) {
    selectedPlayerIds.value = ids
  }

  function toggle(id: string) {
    const idx = selectedPlayerIds.value.indexOf(id)
    if (idx === -1) {
      selectedPlayerIds.value = [...selectedPlayerIds.value, id]
    } else {
      selectedPlayerIds.value = selectedPlayerIds.value.filter((x) => x !== id)
    }
  }

  function resetFilter() {
    selectedPlayerIds.value = []
  }

  watch(
    selectedPlayerIds,
    (ids) => {
      const query = { ...router.currentRoute.value.query }
      if (ids.length === 0) {
        delete query.players
      } else {
        query.players = ids.join(',')
      }
      router.replace({ query })
    },
    { deep: true }
  )

  return {
    selectedPlayerIds,
    isAllSelected,
    setFromQuery,
    toggle,
    selectAll: resetFilter,
    clear: resetFilter,
    resetFilter,
  }
})
