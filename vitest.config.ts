import { defineConfig } from 'vitest/config'

export default defineConfig({
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
    },
  },
})
