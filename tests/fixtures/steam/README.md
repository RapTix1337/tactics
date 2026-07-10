# Steam file fixtures (risk T4)

Sample `libraryfolders.vdf` and `appmanifest_730.acf` files driving the
`steam` core parser tests (E9.1, 10-testing.md §1.1). When a Steam update
changes the file layout, re-capturing `real/` reproduces the breakage as
failing tests.

## Layout

- `real/` — captured from a live Steam installation (2026-07-05, Steam
  client on Windows 11) and **anonymized**: machine- and account-specific
  values (`LastOwner` SteamID, `contentid`, sizes, byte tallies,
  timestamps) are replaced with generic placeholders, and the non-CS2 app
  list is replaced with well-known public app IDs. Structure, key casing,
  tab formatting, and escaping are byte-identical to what Steam writes.
  The capture is a **multi-library** setup (Steam default dir + a second
  library on another drive) — the GSI-01 acceptance case.
- `synthetic/` — hand-written layout variants: a single-library file, the
  **legacy pre-2021 format** (numeric key → path string, metadata
  siblings, `LibraryFolders` casing; note it lists only *additional*
  libraries — the Steam install dir itself is not an entry), and a
  tolerance case with a path-less entry.
- `malformed/` — hand-written broken files: not KeyValues at all (`.txt`),
  unclosed/stray braces, empty file, a KeyValues file with an unexpected
  root key, and a manifest without `installdir`. Parsers must return named
  errors for these, never throw — and the issues must never echo file
  content (the planted fake SteamIDs assert that).

## Re-capturing

Copy `<Steam>/steamapps/libraryfolders.vdf` and
`<Steam>/steamapps/appmanifest_730.acf` into `real/`, then anonymize per
the rules above before committing (ADR-030: SteamIDs never enter the
repository or logs).
