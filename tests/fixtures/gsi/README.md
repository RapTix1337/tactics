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
    06-comp-rounds/         competitive rounds: freezetime → live → bomb
                            planted → round over (widened capture, SCB.1)
    07-dead-spectate/       own death → spectating a teammate — the `player`
                            block flips from own to other identity
    08-halftime-swap/       rounds around the competitive halftime side swap
    09-match-end/           final round and the gameover phase
    10-wingman/             wingman match incl. its halftime (after round 8)
    11-premier/             Premier match segment (mode-string evidence);
                            may be absent if Premier was unavailable
  malformed/                synthetic invalid payloads (see below)
```

Scenarios `01`–`05` were recorded with the narrow pre-scoreboard capture
config (`provider` + `map` only) and stay untouched as the tolerance
regression for payloads without player data. Scenarios `06`+ use the widened
config below.

Each real fixture is one HTTP POST body, pretty-printed, in arrival order
(`001.json`, `002.json`, …) within its scenario.

## Sanitization guarantees

The capture script sanitizes before writing (ADR-030,
`scripts/gsi-sanitize.mjs` — unit tested); the corpus never contains:

- **SteamIDs** — every `steamid` value is replaced with a placeholder: the
  recorder's own steamid (per `provider.steamid`) becomes
  `76561190000000000`, any other steamid `76561190000000001`. Both are
  fake; the distinction is deliberate — the dead-spectate fixtures must
  visibly flip the `player` block (SCB.1/SCB.5).
- **Auth tokens** — every value inside an `auth` object becomes `REDACTED`.
- **Player names / clan tags** — inside `player` sections (including
  `previously`/`added` fragments), `name` becomes `"Player"` and `clan`
  becomes `"REDACTED"`. The sections themselves are **kept** — they are what
  the scoreboard corpus exists for.
- **Other players** — `allplayers` sections are dropped entirely (the
  capture config never subscribes them; this is defense in depth).

A corpus-wide hygiene test
(`src/modules/gsi/core/payload-schema.test.ts`) re-verifies these
guarantees on every checked-in fixture. Review each file before committing
anyway — the script guards known shapes, the reviewer guards surprises.

## Recording a session

1. Create `gamestate_integration_tactics_capture.cfg` in the CS2 config
   directory (`<Steam>/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg/`)
   with exactly the values the app will generate (ADR-051 component set,
   default timing profile). Copy the **whole** block — the quoted name line
   before the opening brace is part of the KeyValues format; without it CS2
   silently ignores the file:

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
           "map_round_wins" "1"
           "round" "1"
           "player_id" "1"
           "player_state" "1"
           "player_match_stats" "1"
       }
   }
   ```

   Never subscribe `player_position`, `player_weapons`, or any
   `allplayers_*` component (ADR-015/051).

2. From the repository root, run `node scripts/capture-gsi.mjs`. The active
   scenario is switched with the listed keys; `q` stops the capture. Switch
   the scenario **before** triggering the transition it should capture —
   during a freezetime, not mid-round. Every stored payload logs a one-line
   summary (`map mode/phase round, round phase, player:own|other`) plus a
   per-mode coverage counter over the seven scenario-critical states —
   freezetime, live round, bomb planted, round over, dead-spectate,
   halftime swap, match end — e.g. `competitive 4/7 (missing: bomb planted,
   halftime swap, match end)`. Use it to confirm live that the intended
   transition was captured — especially the `mode` string right after
   joining and the `player:other` flip while dead — and only stop recording
   a mode at `7/7`. Missed transitions force re-recording.

   The recording may span multiple sittings: on startup the script replays
   everything already stored under the output root and prints the resumed
   per-mode coverage (`Resumed coverage: competitive 4/7 (…)`), so the
   counter always reflects the whole corpus, not just the current run.
   File numbering continues where it left off.

3. Start CS2 and walk the checklist. CS2 loads GSI configs at game start —
   if CS2 was already running, restart it.

   | Key | Scenario | What to do |
   |---|---|---|
   | `1` | `01-menus` | stay in the main menu ~30 s (expect heartbeats without a `map` section) |
   | `2` | `02-map-load` | press `2`, then start the match on any map |
   | `3` | `03-mid-match` | once loaded, press `3`; play ~60 s including a round end |
   | `4` | `04-map-change` | press `4`, then switch maps (`changelevel` in the console) |
   | `5` | `05-game-exit` | press `5`, return to the menu and quit CS2 |
   | `6` | `06-comp-rounds` | competitive match: capture at least one full round arc — freezetime, live, bomb planted, round over (verify each phase appeared in the log) |
   | `7` | `07-dead-spectate` | while dead, spectate a teammate until the round ends — the log must show `player:other` for at least one payload |
   | `8` | `08-halftime-swap` | press `8` during round 12's freezetime; keep capturing through the side swap into round 13 |
   | `9` | `09-match-end` | press `9` before the (likely) final round; capture through the gameover phase |
   | `0` | `10-wingman` | wingman match (`scrimcomp2v2`): a few rounds **and** its halftime — the swap after round 8 is the evidence for `halftimeAfter` |
   | `a` | `11-premier` | Premier match if queueable — the logged `mode` string is the evidence SCB.5's allowlist needs; skip if unavailable |

   Notes: `05-game-exit` may legitimately contain only a few payloads; the
   observable tests rely on is that traffic *stops*. Scenarios `6`–`9` can
   come from one competitive match (alt-tab during freezetimes to switch
   keys). Verify the logged `mode` string matches the intended mode before
   investing play time — bot/practice lobbies may report a different mode.

4. Stop the capture (`q`), then curate: keep a representative subset per
   scenario (roughly 3–10 files — always the first and last of a transition,
   plus a heartbeat), delete the rest, and renumber if desired. Run
   `pnpm format` so the fixtures pass the formatting check, and `pnpm test`
   — the corpus hygiene test must be green before anything is committed.

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
