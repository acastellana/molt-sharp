import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',
    
    // Setup files (run before each test file)
    setupFiles: ['./tests/setup.js'],
    
    // Test file patterns
    include: ['tests/**/*.test.js'],
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['lib/**/*.js'],
      exclude: [
        'node_modules',
        'tests',
        '**/*.test.js'
      ],
      // Thresholds (optional - enable when coverage improves)
      // thresholds: {
      //   lines: 80,
      //   functions: 80,
      //   branches: 80,
      //   statements: 80
      // }
    },
    
    // Global timeout for tests
    testTimeout: 10000,
    
    // Reporter
    reporters: ['verbose'],
    
    // Watch mode settings
    watch: false,
    
    // Globals (optional - enable if you prefer no imports)
    // globals: true
  }
});
