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
    },
  },
})
