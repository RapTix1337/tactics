# GSI payload fixture corpus

Real CS2 Game State Integration payloads plus synthetic malformed payloads.
Every GSI processing test (subset validation, state derivation, error cases
per [05-gsi.md](../../../docs/05-gsi.md)) runs against this corpus — it is
the binding T1 measure of [10-testing.md](../../../docs/10-testing.md) §2.
When Valve changes the payload format, re-recording the corpus reproduces
the breakage as failing tests.

## Layout

```
tests/fixtures/gsi/
  real/                     recorded from a real CS2 session, sanitized
    01-menus/               main menu — payloads carry NO `map` section
    02-map-load/            map loading — first payloads after match start
    03-mid-match/           steady in-round traffic and heartbeats
    04-map-change/          transition from one map to another
    05-game-exit/           last payloads before CS2 quits (traffic stops)
  malformed/                synthetic invalid payloads (see below)
```

Each real fixture is one HTTP POST body, pretty-printed, in arrival order
(`001.json`, `002.json`, …) within its scenario.

## Sanitization guarantees

The capture script sanitizes before writing (ADR-030); the corpus never
contains:

- **SteamIDs** — every `steamid` value is replaced with `76561190000000000`.
- **Auth tokens** — every value inside an `auth` object becomes `REDACTED`.
- **Player data** — `player`/`allplayers` sections are dropped entirely
  (the capture config subscribes only `provider` and `map`; this is defense
  in depth).

Review each file before committing anyway — the script guards known shapes,
the reviewer guards surprises.

## Recording a session

1. Create `gamestate_integration_tactics_capture.cfg` in the CS2 config
   directory (`<Steam>/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg/`)
   with exactly the values the app will generate (ADR-031). Copy the
   **whole** block — the quoted name line before the opening brace is part
   of the KeyValues format; without it CS2 silently ignores the file:

   ```
   "TactiCS capture"
   {
       "uri" "http://127.0.0.1:42730"
       "buffer" "0.1"
       "throttle" "0.5"
       "heartbeat" "10.0"
       "auth"
       {
           "token" "capture-session"
       }
       "data"
       {
           "provider" "1"
           "map" "1"
       }
   }
   ```

2. From the repository root, run `node scripts/capture-gsi.mjs`. The active
   scenario is switched with keys `1`–`5`; `q` stops the capture. Switch the
   scenario **before** triggering the transition it should capture.

3. Start CS2 and walk the checklist:

   | Key | Scenario | What to do |
   |---|---|---|
   | `1` | `01-menus` | stay in the main menu ~30 s (expect heartbeats without a `map` section) |
   | `2` | `02-map-load` | press `2`, then start a bot match on any map |
   | `3` | `03-mid-match` | once loaded, press `3`; play ~60 s including a round end |
   | `4` | `04-map-change` | press `4`, then switch maps (`changelevel` in the console) |
   | `5` | `05-game-exit` | press `5`, return to the menu and quit CS2 |

   Note: CS2 loads GSI configs at game start — if CS2 was already running,
   restart it. `05-game-exit` may legitimately contain only a few payloads;
   the observable tests rely on is that traffic *stops*.

4. Stop the capture (`q`), then curate: keep a representative subset per
   scenario (roughly 3–10 files — always the first and last of a transition,
   plus a heartbeat), delete the rest, and renumber if desired. Run
   `pnpm format` so the fixtures pass the formatting check.

5. Remove the capture cfg from the CS2 config directory afterwards —
   otherwise CS2 keeps POSTing to a dead endpoint.

## Malformed set (synthetic)

Hand-written payloads that must yield a **named validation error, never a
throw** (GSI-09, ADR-024):

| File | Defect |
|---|---|
| `root-array.json` | root is an array, not an object |
| `missing-all-sections.json` | empty object — no `provider`, no `map` |
| `provider-missing.json` | `map` section present but no `provider` |
| `provider-timestamp-wrong-type.json` | `provider.timestamp` is a string |
| `map-wrong-type.json` | `map` is a string instead of an object |
| `map-name-wrong-type.json` | `map.name` is a number |
| `not-json.txt` | not parsable as JSON at all (`.txt`: the formatter rejects broken `.json`) |

**Oversized payloads are not checked in**: the per-request size limit is a
parameter of the HTTP intake adapter (E10.4) and its tests generate an
oversized body at run time against the configured limit.
