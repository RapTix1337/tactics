// Verifies that every module-boundary rule in eslint.config.js actually
// fails (risk W1: boundary rules silently weakened). For each boundary a
// deliberate violation file is created under src/, linted through the real
// config, and required to produce the expected rule error. All fixture files
// are removed afterwards; the run aborts if a fixture path already exists.
//
// Usage: pnpm lint:boundaries
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { loadESLint } from 'eslint';

const RESTRICTED_PATHS = 'import-x/no-restricted-paths';
const NO_NODE = 'import-x/no-nodejs-modules';
const NO_RESTRICTED_IMPORTS = 'no-restricted-imports';

// Resolution targets for violations that point into the (still empty) gsi
// module; created only when absent and removed only when created here.
const auxFiles = [
  { path: 'src/modules/gsi/index.ts', content: 'export {};\n' },
  { path: 'src/modules/gsi/core/__boundary-fixture__target.ts', content: 'export {};\n' },
];

const violations = [
  {
    description: 'ui must not import app',
    path: 'src/ui/__boundary-fixture__ui-app.ts',
    content: "import '../app/main';\n",
    expectedRule: RESTRICTED_PATHS,
  },
  {
    description: 'ui must not import modules',
    path: 'src/ui/__boundary-fixture__ui-module.ts',
    content: "import '../modules/gsi';\n",
    expectedRule: RESTRICTED_PATHS,
  },
  {
    description: 'shared must not import ui',
    path: 'src/shared/__boundary-fixture__shared-ui.ts',
    content: "import '../ui/main';\n",
    expectedRule: RESTRICTED_PATHS,
  },
  {
    description: 'app must not import ui',
    path: 'src/app/__boundary-fixture__app-ui.ts',
    content: "import '../ui/main';\n",
    expectedRule: RESTRICTED_PATHS,
  },
  {
    description: 'app must import modules only via index.ts',
    path: 'src/app/__boundary-fixture__app-deep.ts',
    content: "import '../modules/gsi/core/__boundary-fixture__target';\n",
    expectedRule: RESTRICTED_PATHS,
  },
  {
    description: 'modules must not import other modules',
    path: 'src/modules/steam/__boundary-fixture__module-module.ts',
    content: "import '../gsi';\n",
    expectedRule: RESTRICTED_PATHS,
  },
  {
    description: 'modules must not import app',
    path: 'src/modules/steam/__boundary-fixture__module-app.ts',
    content: "import '../../app/main';\n",
    expectedRule: RESTRICTED_PATHS,
  },
  {
    description: 'shared must not import Node built-ins',
    path: 'src/shared/__boundary-fixture__shared-node.ts',
    content: "import 'node:fs';\n",
    expectedRule: NO_NODE,
  },
  {
    description: 'shared must not import electron',
    path: 'src/shared/__boundary-fixture__shared-electron.ts',
    content: "import 'electron';\n",
    expectedRule: NO_RESTRICTED_IMPORTS,
  },
  {
    description: 'module cores must not import react',
    path: 'src/modules/gsi/core/__boundary-fixture__core-react.ts',
    content: "import 'react';\n",
    expectedRule: NO_RESTRICTED_IMPORTS,
  },
];

const createdFiles = [];
const createdDirs = [];

async function createFixture(path, content) {
  // mkdir returns the first directory it actually created (or undefined).
  const createdDir = await mkdir(dirname(path), { recursive: true });
  if (createdDir !== undefined) {
    createdDirs.push(createdDir);
  }
  await writeFile(path, content, { flag: 'wx' });
  createdFiles.push(path);
}

async function main() {
  for (const violation of violations) {
    if (existsSync(violation.path)) {
      throw new Error(`Fixture path already exists, refusing to run: ${violation.path}`);
    }
  }
  for (const aux of auxFiles) {
    if (!existsSync(aux.path)) {
      await createFixture(aux.path, aux.content);
    }
  }
  for (const violation of violations) {
    await createFixture(violation.path, violation.content);
  }

  const ESLint = await loadESLint();
  // The fixtures match a globalIgnores entry so that stray leftovers never
  // break `pnpm lint`; here they are linted deliberately.
  const eslint = new ESLint({ ignore: false });
  const results = await eslint.lintFiles(violations.map((violation) => violation.path));

  let failures = 0;
  for (const violation of violations) {
    const result = results.find((entry) =>
      entry.filePath.replaceAll('\\', '/').endsWith(violation.path),
    );
    const hit = result?.messages.some((message) => message.ruleId === violation.expectedRule);
    if (hit === true) {
      console.log(`PASS  ${violation.description}`);
    } else {
      failures += 1;
      console.error(`FAIL  ${violation.description} — expected ${violation.expectedRule}`);
      for (const message of result?.messages ?? []) {
        console.error(`      got: ${message.ruleId ?? 'parse error'}: ${message.message}`);
      }
    }
  }

  if (failures > 0) {
    throw new Error(`${failures} boundary rule(s) did not fire`);
  }
  console.log(`All ${violations.length} boundary rules fire as expected.`);
}

try {
  await main();
} finally {
  for (const path of createdFiles) {
    await rm(path, { force: true });
  }
  for (const path of createdDirs) {
    await rm(path, { recursive: true, force: true });
  }
}
