import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'
import eslintPluginPrettier from 'eslint-plugin-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'

const sharedPrettierRules = {
  'prettier/prettier': 'error',
  '@typescript-eslint/no-explicit-any': 'off',
}

export default defineConfig([
  globalIgnores(['dist', '**/node_modules', 'frontend/src/routeTree.gen.ts']),
  // Frontend (React + Vite)
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      eslintConfigPrettier,
    ],
    plugins: {
      prettier: eslintPluginPrettier,
    },
    rules: {
      ...sharedPrettierRules,
      'react-refresh/only-export-components': [
        'error',
        {
          allowConstantExport: true,
          allowExportNames: ['useChatSession', 'useSidebarMenuOpen'],
        },
      ],
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // Backend (Node + Express)
  {
    files: ['backend/**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
    plugins: {
      prettier: eslintPluginPrettier,
    },
    rules: sharedPrettierRules,
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  // Frontend tooling configs
  {
    files: ['frontend/vite.config.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
    plugins: {
      prettier: eslintPluginPrettier,
    },
    rules: sharedPrettierRules,
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.node, ...globals.browser },
    },
  },
])
