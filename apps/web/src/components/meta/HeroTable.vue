<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { heroCropUrl } from '@friendtracker/shared'
import type { HeroStat } from '@friendtracker/shared'

defineProps<{
  heroes: HeroStat[]
  loading?: boolean
}>()
</script>

<template>
  <div
    class="rounded overflow-hidden border"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <div v-if="loading" class="p-8 text-center text-dota-text-dim">Loading…</div>
    <table v-else class="w-full">
      <thead>
        <tr style="background-color: var(--color-dota-bg-light);">
          <th class="text-left py-3 px-4 text-dota-gold font-heading">Hero</th>
          <th class="text-right py-3 px-4 text-dota-text-dim">Matches</th>
          <th class="text-right py-3 px-4 text-dota-text-dim">WR%</th>
          <th class="text-right py-3 px-4 text-dota-text-dim">KDA</th>
          <th class="text-left py-3 px-4 text-dota-text-dim">Role</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="h in heroes"
          :key="h.heroId + (h.role || '')"
          class="border-t hover:bg-dota-bg-light transition"
          style="border-color: var(--color-dota-border);"
        >
          <td class="py-2 px-4">
            <RouterLink
              :to="`/hero/${h.heroSlug}`"
              class="flex items-center gap-3 font-medium"
              style="color: var(--color-dota-text);"
            >
              <img
                :src="heroCropUrl(h.heroSlug)"
                :alt="h.heroName"
                class="w-12 h-12 rounded object-cover"
              />
              {{ h.heroName }}
            </RouterLink>
          </td>
          <td class="text-right py-2 px-4 font-mono">{{ h.matches }}</td>
          <td class="text-right py-2 px-4 font-mono">{{ h.winRate.toFixed(1) }}%</td>
          <td class="text-right py-2 px-4 font-mono">{{ h.kda }}</td>
          <td class="py-2 px-4 text-dota-text-dim capitalize">{{ h.role.replace('_', ' ') }}</td>
        </tr>
      </tbody>
    </table>
    <div
      v-if="!loading && heroes.length === 0"
      class="p-8 text-center text-dota-text-dim"
    >
      No heroes match the filter.
    </div>
  </div>
</template>
