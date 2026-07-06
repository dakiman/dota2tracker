import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import type { AppConfig, Player } from '@friendtracker/shared'

const DEFAULT_SITE_NAME = 'FriendTracker'

export const useConfigStore = defineStore('config', () => {
  const siteName = ref(DEFAULT_SITE_NAME)
  const players = ref<Player[]>([])
  const lastRefreshed = ref<string | null>(null)
  let loadPromise: Promise<void> | null = null

  async function load() {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const cfg = await useApi<AppConfig>('/api/config')
        siteName.value = cfg.siteName || DEFAULT_SITE_NAME
        players.value = cfg.players
        lastRefreshed.value = cfg.lastRefreshed
        document.title = `${siteName.value} – DOTA 2 Stats`
      } catch {
        // keep defaults; index.html already carries the fallback title
        loadPromise = null
      }
    })()
    return loadPromise
  }

  async function refresh() {
    loadPromise = null
    return load()
  }

  return { siteName, players, lastRefreshed, load, refresh }
})
