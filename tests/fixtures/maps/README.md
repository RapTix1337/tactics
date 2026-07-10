# Map Fixtures

Deterministic map image and callout data for tests (E14 map view, E22
upload/profile pipeline).

## `de_dust2/`

The E12.1 reference callout dataset (32 curated callouts) with a neutral
placeholder image, moved here when ADR-045 dropped bundled map imagery
(E12.2):

- `main.svg` — a small, valid, **abstract** SVG (no real map layout); stands
  in for a user-provided radar image in upload and rendering tests, which
  only assert that a valid image renders (`naturalWidth > 0`), never its
  content.
- `map.json` — the dataset in its **pre-ADR-045 shape** (levels, bomb sites,
  spawns, viewBox coordinates). It does not match the current `map.json`
  schema and is not loaded by the app; tests use it as a deterministic
  callout source. The E12.3 Dust 2 default layout is seeded by normalizing
  these 32 callouts (viewBox 0 0 1000 1000 → divide by 1000).
