# Map Data

The app ships **facts only** (ADR-045): the Active Duty map catalog and one
default callout layout per map. It ships **no map imagery** — users provide
their own radar images in-app (per-map profiles, epic E22). Maps and
callouts are **data, not code** (MAP-02/06): adding or updating a pool map
means editing files here — no application code changes. Callout names and
positions are curated original facts; no Valve assets, no third-party
callout databases.

## Folder layout

```
data/maps/<mapId>/
└── map.json      # catalog entry + default callout layout
```

- `<mapId>` is the engine-style map name, lowercase (`^[a-z0-9_]+$`),
  e.g. `de_dust2`. The `id` field inside `map.json` must equal the folder
  name (enforced by the loader).

Validation: `map.json` is parsed by the Zod schema in
`src/modules/maps/core/map-schema.ts`. Objects are **strict** — unknown keys
are rejected, so typos fail fast in data PRs. An invalid map is logged and
skipped at load; it never crashes the app. The colocated schema-gate test
(`fs-map-registry.test.ts`) validates every shipped map in CI.

## `map.json` fields

### Catalog entry

| Field | Type | Rules |
|---|---|---|
| `id` | string | `^[a-z0-9_]+$`; equals the folder name |
| `displayName` | string | non-empty; shown in the sidebar and maps overview |
| `gsiNames` | string[] | ≥ 1, unique; raw map names CS2 reports via GSI that resolve to this map (aliases allowed) |

### Default layout

| Field | Type | Rules |
|---|---|---|
| `callouts` | Callout[] | the default callout layout (MAP-04/05); every shipped pool map has a curated, non-empty layout (enforced by the schema-gate test) |

### `Callout`

| Field | Type | Rules |
|---|---|---|
| `name` | string | non-empty; unique within the map |
| `x`, `y` | number | **normalized position**: `0–1` on both axes (see below) |

## Conventions

### Coordinate space

Callout positions are **normalized to the map image**: `x` and `y` are
fractions of the image width and height (`0,0` = top-left, `1,1` =
bottom-right). The app ships no image, so default positions are deliberately
approximate — they are seeded into every new profile, where users fine-tune
them on their own radar image (MVP-13).

### Pool changes

The catalog mirrors the current Active Duty pool (verified at E12 execution:
Ancient, Anubis, Dust 2, Inferno, Mirage, Nuke, Overpass; Cache added
2026-07-10). When Valve rotates the pool, add or remove map folders — a
data-only change (MAP-06).
