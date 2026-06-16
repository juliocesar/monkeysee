import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import pluginPrettier from 'eslint-plugin-prettier'
import onlyWarn from 'eslint-plugin-only-warn'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: { prettier: pluginPrettier, onlyWarn },
    rules: { 'prettier/prettier': 'error' },
  },
  // Browser + WebExtension globals for the extension package
  {
    files: ['packages/extension/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  // Node globals for the bridge
  {
    files: ['packages/bridge/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Node globals for build scripts (esbuild runners) and root config files
  {
    files: ['**/*.mjs', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  { ignores: ['**/dist/**', '**/*.tsbuildinfo', 'packages/extension/static/**'] },
]
