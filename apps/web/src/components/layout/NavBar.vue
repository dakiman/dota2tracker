<script setup lang="ts">
import { RouterLink } from 'vue-router'
import PlayerFilterDropdown from './PlayerFilterDropdown.vue'
import { useConfigStore } from '@/stores/config'

const config = useConfigStore()
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
    </nav>
  </header>
</template>
