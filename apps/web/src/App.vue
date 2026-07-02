<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import NavBar from '@/components/layout/NavBar.vue'
import { useConfigStore } from '@/stores/config'
import { relativeTime } from '@/utils/relativeTime'

const config = useConfigStore()
onMounted(config.load)
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <NavBar />
    <main class="flex-1 container mx-auto px-4 py-6">
      <RouterView />
    </main>
    <footer
      v-if="config.lastRefreshed"
      class="container mx-auto px-4 py-4 text-center text-xs text-dota-text-dim"
    >
      Data updated {{ relativeTime(config.lastRefreshed) }}
    </footer>
  </div>
</template>
