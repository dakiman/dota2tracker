<script setup lang="ts">
import { abilityImageUrl } from '@friendtracker/shared'
import type { SkillBuild } from '@friendtracker/shared'

defineProps<{
  build: SkillBuild
  title?: string
}>()
</script>

<template>
  <div
    class="p-4 rounded border"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <h3 v-if="title" class="text-dota-gold font-medium mb-3">{{ title }}</h3>
    <div class="flex flex-wrap gap-1">
      <img
        v-for="(ability, lvl) in build.levels"
        :key="lvl"
        :src="abilityImageUrl(ability)"
        :alt="ability"
        :title="`Level ${lvl + 1}`"
        class="w-10 h-10 rounded object-cover border"
        style="border-color: var(--color-dota-border);"
      />
    </div>
  </div>
</template>
