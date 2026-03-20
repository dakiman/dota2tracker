<script setup lang="ts">
import type { Role } from '@friendtracker/shared'

const ROLES: { value: '' | Role; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'carry', label: 'Carry' },
  { value: 'mid', label: 'Mid' },
  { value: 'offlane', label: 'Offlane' },
  { value: 'support', label: 'Support' },
  { value: 'hard_support', label: 'Hard support' },
]

defineProps<{ modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <button
      v-for="r in ROLES"
      :key="r.value || 'all'"
      type="button"
      :class="[
        'px-4 py-2 rounded text-sm font-medium transition',
        modelValue === r.value
          ? 'bg-dota-gold-dark text-dota-bg'
          : 'bg-dota-bg-card text-dota-text-dim hover:text-dota-text border border-dota-border'
      ]"
      @click="emit('update:modelValue', r.value)"
    >
      {{ r.label }}
    </button>
  </div>
</template>
