<script setup lang="ts">
import { ref } from 'vue'
import { apiPost, ApiError } from '@/composables/useApi'
import { useAuthStore } from '@/stores/auth'
import { useConfigStore } from '@/stores/config'
import type { Player } from '@friendtracker/shared'

const auth = useAuthStore()
const config = useConfigStore()

const busy = ref(false)
const message = ref('')
const privateName = ref('')
const accountIdInput = ref('')

function applyError(e: unknown) {
  privateName.value = ''
  if (!(e instanceof ApiError)) {
    message.value = 'Something went wrong — try again.'
    return
  }
  const data = e.data as { error?: string; name?: string } | undefined
  if (data?.error === 'no_public_data') {
    privateName.value = data.name || 'this account'
    message.value = ''
  } else if (data?.error === 'already_tracked') {
    message.value = 'Already tracked.'
  } else if (data?.error === 'account_not_found') {
    message.value = 'No Dota account found for that ID.'
  } else if (data?.error === 'invalid_account_id') {
    message.value = "That doesn't look like a Steam account ID."
  } else if (data?.error === 'opendota_unavailable') {
    message.value = 'OpenDota is unavailable right now — try again later.'
  } else {
    message.value = 'Something went wrong — try again.'
  }
}

async function addPlayer(accountId?: string) {
  busy.value = true
  message.value = ''
  privateName.value = ''
  try {
    await apiPost<{ player: Player }>('/api/players', accountId ? { accountId } : undefined)
    message.value = 'Added — stats appear after the first sync.'
    accountIdInput.value = ''
    auth.refresh()
    config.refresh()
  } catch (e) {
    applyError(e)
  } finally {
    busy.value = false
  }
}

async function refreshNow() {
  busy.value = true
  message.value = ''
  privateName.value = ''
  try {
    const res = await apiPost<{ queued: boolean }>('/api/admin/refresh')
    message.value = res.queued ? 'Refresh queued.' : 'A refresh is already queued.'
  } catch {
    message.value = 'Refresh failed — try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="relative flex items-center gap-2 text-sm">
    <button
      v-if="auth.user && !auth.user.playerId"
      class="px-2 py-1 rounded border opacity-90 hover:opacity-100 transition cursor-pointer"
      style="color: var(--color-dota-gold); border-color: var(--color-dota-border);"
      :disabled="busy"
      @click="addPlayer()"
    >
      Track my account
    </button>
    <template v-if="auth.user?.isAdmin">
      <input
        v-model="accountIdInput"
        placeholder="Account ID"
        class="w-28 px-2 py-1 rounded border bg-transparent"
        style="color: var(--color-dota-text); border-color: var(--color-dota-border);"
      />
      <button
        class="px-2 py-1 rounded border opacity-90 hover:opacity-100 transition cursor-pointer"
        style="color: var(--color-dota-text); border-color: var(--color-dota-border);"
        :disabled="busy || !accountIdInput"
        @click="addPlayer(accountIdInput)"
      >
        Add
      </button>
      <button
        class="px-2 py-1 rounded border opacity-90 hover:opacity-100 transition cursor-pointer"
        style="color: var(--color-dota-text); border-color: var(--color-dota-border);"
        :disabled="busy"
        @click="refreshNow()"
      >
        Refresh now
      </button>
    </template>
    <span v-if="message" style="color: var(--color-dota-text-dim);">{{ message }}</span>
    <div
      v-if="privateName"
      class="absolute top-full right-0 mt-2 w-72 p-3 rounded border z-20"
      style="background-color: var(--color-dota-bg-card); border-color: var(--color-dota-border); color: var(--color-dota-text);"
    >
      Found <strong>{{ privateName }}</strong> — but their match data isn't public.
      In Dota 2: Settings → Options → Social →
      <strong>Expose Public Match Data</strong>, then try again.
      <button
        class="block mt-2 underline cursor-pointer"
        style="color: var(--color-dota-text-dim);"
        @click="privateName = ''"
      >
        Dismiss
      </button>
    </div>
  </div>
</template>
