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
    class="p-4 rounded-lg border"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <h3 v-if="title" class="text-dota-gold font-heading text-sm font-medium mb-3 tracking-wider uppercase">
      {{ title }}
    </h3>
    <div class="flex flex-wrap gap-1">
      <div
        v-for="(ability, lvl) in build.levels"
        :key="lvl"
        class="relative group"
      >
        <div class="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] font-mono text-dota-text-dim">
          {{ lvl + 1 }}
        </div>
        <img
          :src="abilityImageUrl(ability)"
          :alt="ability"
          class="w-10 h-10 rounded object-cover border transition-all duration-150 group-hover:border-[var(--color-dota-gold-dark)] group-hover:brightness-125"
          style="border-color: var(--color-dota-border);"
        />
        <div class="absolute -bottom-7 left-1/2 -translate-x-1/2 bg-black/90 text-dota-text text-xs px-2 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 transition-opacity">
          {{ ability.replace(/.*_/, '') }}
        </div>
      </div>
    </div>
  </div>
</template>
