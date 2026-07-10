// @ts-check
import { defineConfig, globalIgnores } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

const DOMAIN_MODULES = ['steam', 'gsi', 'maps', 'settings', 'logging', 'storage', 'updates'];

// Module boundaries per ADR-021/026 (03-technical-design.md §1) — tooling,
// not convention. Verified by `pnpm lint:boundaries`.
const boundaryZones = [
  {
    target: './src/ui',
    from: './src',
    except: ['./ui', './shared'],
    message: 'src/ui imports only src/shared (ADR-021/026).',
  },
  {
    target: './src/shared',
    from: './src',
    except: ['./shared'],
    message: 'src/shared must not import from app, modules, or ui (ADR-021/026).',
  },
  {
    target: './src/app',
    from: './src/ui',
    message: 'The main process never imports renderer code (ADR-021/026).',
  },
  ...DOMAIN_MODULES.map((name) => ({
    target: `./src/modules/${name}`,
    from: './src',
    except: [`./modules/${name}`, './shared'],
    message: `Module "${name}" imports only itself and src/shared (ADR-021).`,
  })),
  ...DOMAIN_MODULES.map((name) => ({
    target: './src/app',
    from: `./src/modules/${name}`,
    except: ['./index.ts'],
    message: `Import module "${name}" only via its index.ts (ADR-026).`,
  })),
];

export default defineConfig(
  globalIgnores([
    'node_modules/',
    'out/',
    'dist/',
    '**/__boundary-fixture__*',
    // Third-party session tooling, not project code.
    '.agents/',
    '.claude/',
    '.idea/',
  ]),

  // Application sources: type-aware linting (ADR-012).
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Root config files, scripts, and E2E tests: linted without type
  // information (tests/e2e joined in E20.1 so helpers can annotate
  // parameters; typecheck coverage comes from tsconfig.node.json).
  {
    files: ['*.ts', '*.js', '*.mjs', 'scripts/**/*.mjs', 'tests/**/*.ts'],
    extends: [tseslint.configs.recommended],
  },

  // Import hygiene, sorting, and module boundaries.
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
    plugins: {
      'import-x': importX,
      'simple-import-sort': simpleImportSort,
    },
    settings: {
      // Resolve extensionless TypeScript imports — without this the
      // boundary zones never fire on unresolved imports.
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          // Solution tsconfig; the resolver follows its project references.
          project: 'tsconfig.json',
        }),
      ],
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-restricted-paths': ['error', { zones: boundaryZones }],
    },
  },

  // Neutral contexts are pure TypeScript — no Node, Electron, or React
  // (ADR-019, 03-technical-design.md §1.3).
  {
    files: ['src/shared/**/*.ts', 'src/modules/*/core/**/*.ts'],
    rules: {
      'import-x/no-nodejs-modules': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'Neutral code is pure TypeScript (ADR-019).' },
            { name: 'react', message: 'Neutral code is pure TypeScript (ADR-019).' },
            { name: 'react-dom', message: 'Neutral code is pure TypeScript (ADR-019).' },
          ],
          patterns: [
            {
              group: ['electron/*', 'react/*', 'react-dom/*'],
              message: 'Neutral code is pure TypeScript (ADR-019).',
            },
          ],
        },
      ],
    },
  },

  // Renderer: React hooks rules (React itself lands in E3.2).
  {
    files: ['src/ui/**/*.ts', 'src/ui/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
  },

  // Keep formatting to Prettier — must stay last.
  prettierConfig,
);
