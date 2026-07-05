<script setup lang="ts">
import { RouterLink } from 'vue-router'
import PlayerFilterDropdown from './PlayerFilterDropdown.vue'
import { useConfigStore } from '@/stores/config'
import { useAuthStore } from '@/stores/auth'

const config = useConfigStore()
const auth = useAuthStore()
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b flex items-center justify-between px-4 py-3"
    style="background-color: var(--color-dota-bg-card); border-color: var(--color-dota-border);"
  >
    <RouterLink to="/" class="font-heading text-xl font-semibold" style="color: var(--color-dota-gold);">
      {{ config.siteName }}
    </RouterLink>
    <nav class="flex items-center gap-6">
      <RouterLink
        to="/meta"
        class="opacity-80 hover:opacity-100 transition"
        style="color: var(--color-dota-text);"
      >
        Meta
      </RouterLink>
      <RouterLink
        to="/together"
        class="opacity-80 hover:opacity-100 transition"
        style="color: var(--color-dota-text);"
      >
        Together
      </RouterLink>
      <PlayerFilterDropdown />
      <a
        v-if="!auth.user"
        href="/api/auth/steam/login"
        class="opacity-80 hover:opacity-100 transition text-sm"
        style="color: var(--color-dota-text);"
      >
        Sign in with Steam
      </a>
      <div v-else class="flex items-center gap-2">
        <img
          v-if="auth.user.avatar"
          :src="auth.user.avatar"
          alt=""
          class="w-6 h-6 rounded-full"
        />
        <span class="text-sm" style="color: var(--color-dota-text);">{{ auth.user.name }}</span>
        <button
          class="opacity-80 hover:opacity-100 transition text-sm cursor-pointer"
          style="color: var(--color-dota-text-dim);"
          @click="auth.logout()"
        >
          Log out
        </button>
      </div>
    </nav>
  </header>
</template>
