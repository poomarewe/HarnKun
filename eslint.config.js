import js from '@eslint/js';

const browserNames = ['window', 'document', 'navigator', 'indexedDB', 'localStorage', 'URL', 'URLSearchParams', 'DOMParser', 'TextDecoder', 'Uint8Array', 'atob', 'btoa', 'File', 'FormData', 'Image', 'HTMLElement', 'requestAnimationFrame', 'createImageBitmap', 'crypto', 'fetch', 'console', 'setTimeout', 'clearTimeout', 'Response', 'Request', 'Headers', 'Buffer', 'process', 'AbortSignal', 'DOMException', '__APP_VERSION__', '__APP_VERSION_TIME__'];
export default [
  { ignores: ['dist/**', 'node_modules/**', '.npm-cache/**', 'test-results/**', 'playwright-report/**', 'design/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.jsx'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: Object.fromEntries([...browserNames, 'BroadcastChannel', 'innerWidth', 'Storage', 'IDBObjectStore', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle', 'performance', 'PerformanceObserver'].map(name => [name, 'readonly'])) },
    // JSX variables are not recognized by core no-unused-vars. Revisit with a React lint plugin.
    rules: { 'no-unused-vars': 'off' },
  },
];
