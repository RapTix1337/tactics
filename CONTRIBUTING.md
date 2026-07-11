# Contributing to TactiCS

Contributions are welcome — TactiCS is GPL-3.0 open source with no CLA. By
contributing you agree that your contribution is licensed GPL-3.0 like the
rest of the repository; this applies to **map/callout data exactly as it
does to code** (see
[Contributing map data](#contributing-map-data-catalog-and-default-layouts)).
This guide covers the whole path from development setup to a merged PR.

## Development setup

The toolchain (Node 24, corepack-managed pnpm 11) and the step-by-step
setup for Windows-native and WSL2 development live in the
[README — Development Setup](README.md#development-setup), together with
the full list of `pnpm` scripts. Use **pnpm only** — never npm or yarn.

Native-module notes (better-sqlite3):

- `pnpm install` compiles better-sqlite3 natively when needed — its build
  script is allow-listed in `pnpm-workspace.yaml`. A C++ toolchain plus
  Python 3 is required **only when no prebuilt binary matches your
  platform**; a normal install downloads a prebuilt and needs no compiler.
- The installed binary carries one ABI at a time: **Vitest runs against
  the system-Node build**, while `pnpm dev` / `pnpm start` /
  `pnpm test:e2e` need the **Electron ABI**.
  `scripts/ensure-native-abi.mjs` switches on demand via npm `pre` hooks,
  and electron-builder rebuilds against the Electron ABI at package time —
  contributors never run an Electron-ABI rebuild manually.

## Branch and PR workflow

TactiCS uses **GitHub Flow**: `main` is protected, all changes arrive via
reviewed PRs.

1. Fork the repository (maintainers: branch directly) and create a feature
   branch off `main`.
2. Keep the branch focused — one logical change per PR.
3. Commit following the
   [commit convention](#commit-convention-and-git-hooks).
4. Run the quality gates locally (below) — CI enforces the same set and
   must be green before merge.
5. Open a PR against `main`: describe **what** changed and **why**, and
   link related issues.
6. The maintainer reviews and merges.

Quality gates:

```
pnpm lint          # ESLint incl. module-boundary rules
pnpm format:check  # Prettier
pnpm typecheck     # the three TS contexts (node / web / neutral)
pnpm test          # Vitest unit + integration (incl. the map-data gate)
pnpm build         # bundle main/preload/renderer
```

## Commit convention and git hooks

Commits follow **Conventional Commits** (`feat:`, `fix:`, `docs:`,
`refactor:`, `test:`, `chore:`, `ci:`, `build:`), written in English in
the imperative mood. Hooks are installed automatically by `pnpm install`
(husky `prepare` script):

- `pre-commit` runs lint-staged: ESLint `--fix` + Prettier on staged files.
- `commit-msg` runs commitlint (`@commitlint/config-conventional`).

The hook scripts are plain POSIX `sh` one-liners and work in Git Bash and
PowerShell-driven git on Windows. `pnpm` must be on the `PATH` of whatever
starts git — GUI clients that bypass the shell profile may need husky's
`~/.config/husky/init.sh`. Hooks are a local convenience; the authoritative
quality gate is CI.

## Code style and module boundaries

ESLint (flat config, type-aware via typescript-eslint) and Prettier are the
style authority — run `pnpm lint` and `pnpm format:check`. The architecture
boundaries are **enforced as lint rules** in `eslint.config.js`:

| Rule | Enforced by |
|---|---|
| `src/ui` imports only `src/shared` | `import-x/no-restricted-paths` zone |
| `src/shared` imports nothing from `src/` | `import-x/no-restricted-paths` zone |
| Main process (`src/app`) never imports `src/ui` | `import-x/no-restricted-paths` zone |
| Domain modules import only themselves + `src/shared` | `import-x/no-restricted-paths` zone (per module) |
| Modules are imported from outside only via their `index.ts` | `import-x/no-restricted-paths` zone (per module) |
| Neutral code (`src/shared`, `src/modules/*/core`) is pure TS — no Node | `import-x/no-nodejs-modules` |
| Neutral code — no Electron, no React | `no-restricted-imports` |

`pnpm lint:boundaries` proves every rule still fires: it generates a
deliberate violation per boundary, expects the lint error, and cleans up —
run it after touching `eslint.config.js`.

## Testing expectations

New logic requires tests; bug fixes require a regression test that fails
before the fix. Follow the test pyramid — many unit tests, fewer
integration tests, few E2E scenarios — and keep tests deterministic: no
reliance on timing, network, or a running CS2/Steam. Unit and integration
tests are colocated (`*.test.ts(x)` next to the source); E2E tests and
recorded GSI fixtures live under `tests/`.

## Contributing map data (catalog and default layouts)

The app ships **facts only**: the Active Duty map catalog and one default
callout layout per map — never imagery. Maps are data, not code: a
contribution edits `map.json` files under `data/maps/`, no application
code changes.

- **Schema:** [data/maps/README.md](data/maps/README.md) is the
  authoritative schema doc — folder layout, `map.json` fields, and the
  normalized 0–1 coordinate space.
- **What to contribute:** pool rotations (add/remove a map folder),
  display-name or GSI-name fixes, and default-layout improvements
  (callout names + approximate normalized positions).
- **Facts, never imagery:** contributions are names, GSI names, and
  normalized positions. No radar images, screenshots, or artwork of any
  kind — users provide their own images in-app. No Valve assets, no copies
  of third-party callout databases; names and positions must be curated
  original facts.
- **Data gate:** every shipped map is validated in CI by the schema-gate
  test (`src/modules/maps/adapters/fs-map-registry.test.ts`) — strict Zod
  parsing rejects unknown keys, so typos fail fast. Run `pnpm test` before
  opening the PR.
- **Review:** the maintainer verifies contributed facts against the game
  before merging.
- **License:** map/callout data in this repository is **GPL-3.0, exactly
  like code**. Do not contribute data you cannot license that way.

## Reporting bugs and proposing features

- **Bugs** → GitHub Issues. Include app version, OS, and steps to
  reproduce; attach exported logs where useful (settings → export logs —
  log files are rotated and contain no sensitive data).
- **Ideas and questions** → GitHub Discussions. Note the deliberate
  non-goals first: utility lineups, heatmaps, a plugin system, and live
  player positions are out of scope by design and will not be accepted as
  proposals.
