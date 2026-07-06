import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import type { AuthUser } from '@friendtracker/shared'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  let loadPromise: Promise<void> | null = null

  async function load() {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const res = await useApi<{ user: AuthUser | null }>('/api/auth/me')
        user.value = res.user
      } catch {
        user.value = null
        loadPromise = null
      }
    })()
    return loadPromise
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
      loadPromise = null
    }
  }

  async function refresh() {
    loadPromise = null
    return load()
  }

  return { user, load, logout, refresh }
})
