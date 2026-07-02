<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useConfigStore } from '@/stores/config'

const config = useConfigStore()
</script>

<template>
  <div class="max-w-2xl mx-auto text-center py-12">
    <h1 class="font-heading text-4xl font-semibold text-dota-gold mb-4">
      {{ config.siteName }}
    </h1>
    <p class="text-dota-text-dim mb-8">
      DOTA 2 stats for your stack. Pick players and see hero meta and builds.
    </p>
    <div class="flex justify-center">
      <RouterLink
        to="/meta"
        class="px-6 py-3 rounded bg-dota-gold-dark text-dota-bg hover:bg-dota-gold transition"
      >
        View hero meta
      </RouterLink>
    </div>
  </div>
</template>
