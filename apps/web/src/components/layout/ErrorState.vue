<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  status: number
  notFoundMessage?: string
}>()

const emit = defineEmits<{ retry: [] }>()

const isNotFound = computed(() => props.status === 404 && !!props.notFoundMessage)
</script>

<template>
  <div class="py-12 text-center">
    <p v-if="isNotFound" class="text-dota-text-dim text-lg">{{ notFoundMessage }}</p>
    <template v-else>
      <p class="text-dota-red mb-4">Something went wrong loading this page.</p>
      <button
        class="px-4 py-2 rounded bg-dota-gold-dark text-dota-bg hover:bg-dota-gold transition"
        @click="emit('retry')"
      >
        Retry
      </button>
    </template>
    <div class="mt-4">
      <slot />
    </div>
  </div>
</template>
