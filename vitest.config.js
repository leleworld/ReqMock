import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node', // util 函数为纯逻辑，无需 jsdom
    include: ['tests/**/*.test.{js,mjs}'],
    coverage: {
      provider: 'v8',
      include: ['src/utils/**'],
      reporter: ['text', 'lcov']
    }
  }
});
