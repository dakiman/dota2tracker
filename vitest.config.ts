import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    // The web stores import via the '@' alias (see apps/web/vite.config.ts);
    // mirror it here so store unit tests resolve '@/composables/*'.
    alias: { '@': resolve(__dirname, 'apps/web/src') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Route tests share one throwaway DB; keep files sequential.
    fileParallelism: false,
    globalSetup: ['tests/global-setup.ts'],
    env: {
      DATABASE_URL:
        'postgresql://friendtracker:devpassword@localhost:5474/friendtracker_test',
      // useApi falls back to window.location.origin when unset — no window in node
      VITE_API_URL: 'http://api.test',
      OPENDOTA_RATE_MS: '0',
    },
  },
})
