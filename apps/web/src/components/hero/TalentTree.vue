<script setup lang="ts">
import { computed } from 'vue'
import type { TalentChoice } from '@friendtracker/shared'

const props = defineProps<{ talents: TalentChoice[] }>()

const sortedLevels = [25, 20, 15, 10] as const

const talentByLevel = computed(() => {
  const map = new Map<number, TalentChoice>()
  for (const t of props.talents) map.set(t.level, t)
  return map
})

function cleanTalentText(text: string): string {
  return text.replace(/\{s:[^}]+\}/g, '').replace(/\s{2,}/g, ' ').trim()
}
</script>

<template>
  <div
    class="p-4 rounded-lg border overflow-hidden"
    style="border-color: var(--color-dota-border); background-color: var(--color-dota-bg-card);"
  >
    <h3 class="text-dota-gold font-heading text-sm font-medium mb-3 tracking-wider uppercase">Talents</h3>
    <div class="space-y-1">
      <div
        v-for="level in sortedLevels"
        :key="level"
        class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"
      >
        <!-- Left talent -->
        <div
          v-if="talentByLevel.get(level)"
          class="text-right px-3 py-1.5 rounded text-xs transition-colors min-w-0 break-words"
          :class="talentByLevel.get(level)?.picked === 'left'
            ? 'bg-dota-gold-dark/20 text-dota-gold border border-dota-gold-dark/40'
            : 'text-dota-text-dim'"
        >
          {{ cleanTalentText(talentByLevel.get(level)?.left ?? '') }}
          <span
            v-if="talentByLevel.get(level)?.picked === 'left'"
            class="font-mono text-dota-green ml-1"
          >
            {{ talentByLevel.get(level)?.winRate }}%
          </span>
        </div>
        <div v-else class="text-right text-xs text-dota-text-dim px-3 py-1.5">—</div>

        <!-- Level badge -->
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0"
          style="background-color: var(--color-dota-bg-light); border: 2px solid var(--color-dota-gold-dark);"
        >
          {{ level }}
        </div>

        <!-- Right talent -->
        <div
          v-if="talentByLevel.get(level)"
          class="text-left px-3 py-1.5 rounded text-xs transition-colors min-w-0 break-words"
          :class="talentByLevel.get(level)?.picked === 'right'
            ? 'bg-dota-gold-dark/20 text-dota-gold border border-dota-gold-dark/40'
            : 'text-dota-text-dim'"
        >
          {{ cleanTalentText(talentByLevel.get(level)?.right ?? '') }}
          <span
            v-if="talentByLevel.get(level)?.picked === 'right'"
            class="font-mono text-dota-green ml-1"
          >
            {{ talentByLevel.get(level)?.winRate }}%
          </span>
        </div>
        <div v-else class="text-left text-xs text-dota-text-dim px-3 py-1.5">—</div>
      </div>
    </div>
  </div>
</template>
