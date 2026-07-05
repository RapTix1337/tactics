# TactiCS

[![ci](https://github.com/RapTix1337/tactics/actions/workflows/ci.yml/badge.svg)](https://github.com/RapTix1337/tactics/actions/workflows/ci.yml)

> **Tactics + CS** — an open-source desktop companion app for Counter-Strike 2.

> **Status: early stage — in development.** Planning and architecture are
> complete; Phase 3 (walking skeleton → MVP) is in progress.

## What is TactiCS?

TactiCS is a modern desktop application built with Electron and React that
connects to Counter-Strike 2 via Valve's official
[Game State Integration (GSI)](https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive_Game_State_Integration)
interface. It aims to remove all manual setup: install the app, and it detects
CS2, configures GSI for you, and reacts live to what you are playing.

## Vision

Become the go-to open-source companion for CS2 players who want to learn maps,
analyze their play, and improve — without fiddling with config files or
uploading their data to closed platforms.

## Goals

- Professional, long-term maintainable codebase with a clear architecture
- Easy to extend — new features should not require rewrites
- Well tested and performant
- Welcoming to open-source contributors: readable code, thorough docs
- Privacy-friendly: local-first by default

## Planned Features

### Milestone 1 — Map & Callouts (MVP)

- Detect a running/installed Counter-Strike 2
- Automatically configure Game State Integration (GSI)
- Provide a local HTTP server receiving GSI data
- Detect the currently played map
- Display the matching map with **all callouts**

### Later (directional roadmap, not commitments)

Callout training mode · match history · statistics · demo analysis ·
strats & notes · overlays · local profiles · cloud sync (opt-in) ·
community sharing

TactiCS deliberately does **not** plan: live player positions, utility
lineups, heatmaps, a plugin system.

## Tech Stack

Finalized in the architecture & technical design phase.

| Area | Technology |
|---|---|
| Desktop shell | Electron |
| UI | React + TypeScript |
| Build/dev tooling | Vite via electron-vite |
| Packaging & updates | electron-builder + electron-updater (GitHub Releases) |
| Routing | TanStack Router |
| Styling | Tailwind CSS + shadcn/ui |
| State management | Zustand |
| Forms | React Hook Form |
| Validation | Zod |
| Persistence | SQLite via better-sqlite3 + Drizzle ORM |
| Logging | electron-log |
| Unit/integration tests | Vitest + React Testing Library |
| E2E tests | Playwright (final confirmation via an early spike) |
| Lint/format | ESLint + Prettier |
| Git hooks | husky + lint-staged + commitlint |
| Package manager | pnpm |

**Platforms:** Windows first; the code is kept platform-neutral so Linux
support can follow.

## Development Setup

TactiCS targets **Windows first** (ADR-004), so Windows-native development is
the primary path. Development inside **WSL2 (Ubuntu 22.04) with WSLg** is also
supported — Windows behavior of the packaged app is covered by CI on
`windows-latest` regardless of the dev host. Pick the environment that matches
your machine below; the `pnpm` scripts under
[Working with the repo](#working-with-the-repo) are identical for both.

### Windows-native

| Tool | Version | Install |
|---|---|---|
| [nvm-windows](https://github.com/coreybutler/nvm-windows) | latest | installer from the nvm-windows releases |
| Node.js | 24.x — the major bundled by Electron 43 | `nvm install 24` then `nvm use 24` |
| pnpm | 11.x, corepack-managed | `corepack enable` then `corepack prepare pnpm@11.9.0 --activate` |
| Visual Studio Build Tools (C++) + Python 3 | latest | **only** if a native module has to compile from source; `pnpm install` uses `better-sqlite3` prebuilt binaries, so no compiler is needed for a normal install |

Windows notes:

- Run the setup commands in the same shell (PowerShell) whose `PATH` `git`
  inherits, so the husky hooks can find `pnpm` (see
  [docs/11-contributing.md](docs/11-contributing.md)).
- Native rebuilds against the Electron ABI (if ever triggered) need the
  Visual Studio "Desktop development with C++" workload plus Python 3 for
  node-gyp.

### WSL2 (Ubuntu 22.04) with WSLg

| Tool | Version | Install |
|---|---|---|
| [nvm](https://github.com/nvm-sh/nvm) | latest | install script from the nvm README |
| Node.js | 24.x — the major bundled by Electron 43 | `nvm install 24` |
| pnpm | 11.x, corepack-managed | `corepack enable && corepack prepare pnpm@11.9.0 --activate` |
| build-essential | distro default | `sudo apt install build-essential` — native rebuild of better-sqlite3 against the Electron ABI |
| Python 3 | distro default | preinstalled on Ubuntu 22.04; needed by node-gyp |

WSL notes:

- Electron windows render through WSLg.
- Electron under WSLg logs benign `Failed to connect to the bus` (D-Bus)
  errors on startup; windows open regardless.

### Shared notes

- pnpm ≥ 10 blocks dependency postinstall scripts by default. The build
  scripts of `electron` and `esbuild` are pre-approved in
  `pnpm-workspace.yaml`.

### Working with the repo

```
pnpm install      # install dependencies + git hooks (Node 24 + pnpm 11, see above)
pnpm dev          # start the app in dev mode with HMR (opens the app window)
pnpm build        # bundle main/preload/renderer into out/
pnpm typecheck    # type-check the three TS contexts (node / web / neutral)
pnpm test         # Vitest unit/integration tests, node + jsdom (watch: pnpm test:watch)
pnpm test:e2e     # Playwright E2E against the built app (run pnpm build first)
pnpm lint         # ESLint incl. module-boundary rules
pnpm lint:boundaries  # prove every boundary rule still fires
pnpm format:check # Prettier check (format with: pnpm format)
pnpm start        # run the app from the built bundles
```

If starting the app fails because the Electron binary is missing (pnpm can
skip Electron's postinstall when the package is served from the store cache),
fetch it manually: `node node_modules/electron/install.js`.

## Repository Structure (current)

```
tactics/
├── src/
│   ├── app/           # composition layer, main process (incl. preload)
│   ├── modules/       # domain + infrastructure modules (main process only)
│   ├── ui/            # composition layer, renderer
│   └── shared/        # types, IPC contract, small utilities
├── data/maps/         # map/callout data (SVG + JSON), one folder per map
├── tests/             # E2E tests and recorded GSI fixtures
├── README.md          # This file
└── LICENSE            # GPL-3.0
```

## Development Phases

| Phase | Focus | Status |
|---|---|---|
| 0 | Project setup, rules, documentation skeleton | ✅ done |
| 1 | Requirements engineering | ✅ done |
| 2 | Architecture & technical design | ✅ done |
| 3 | MVP: GSI auto-setup, map detection, callouts | 🔨 in progress |
| 4 | First post-1.0 releases (training mode, …) | planned |
| 5+ | Extensions (see roadmap) | directional |

## Contributing

Contribution guidelines will be published once the project reaches a
contributable state.

## License

[GPL-3.0](LICENSE) — TactiCS is and stays open source; derived works must be
open source as well.

## Disclaimer

TactiCS is a community project and is not affiliated with or endorsed by Valve
Corporation. Counter-Strike is a trademark of Valve Corporation. TactiCS only
uses the official Game State Integration interface and does not read game
memory or interact with VAC-protected processes.
