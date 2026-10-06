# Sail Unmarked

*Sail racing around virtual marks. The marks are virtual but the racing is real.*

---

## What this is

Racing where the mark you round is a **line checked by GPS** rather than a buoy checked by
eyeball. Fleets already cross start lines this way — often unsighted to one or both ends, often
relying on instruments — and this extends that to every rounding. A boat's phone watches its
position, decides when it crossed each line and which way, and times it.

Two reasons for a line rather than a point:

- **RRS 18 (mark-room) never applies.** There is no zone to reach and no inside or outside
  overlap to adjudicate, so boats meeting near a line fall back on the Part 2 right-of-way rules
  alone. That is a deliberate safety choice.
- **No rounding radius to dispute.** GPS error cannot put a boat inside or outside a circle,
  because there is no circle.

It also removes the work of laying marks, allows courses to go where you can't lay a mark, and makes some new race formats possible:

| Format | What it changes |
|---|---|
| **Practice and record attempts** | A published course is always there to sail. Practice is kept for the boat; a record attempt stands against every other attempt at the same geometry. |
| **Self-timed start** | Each boat's clock starts when it crosses the start line, timed by its own device. A committee may still publish a start time; nobody needs a gun. |
| **Circuit, join anywhere** | A loop with several entry lines: a boat starts at whichever it crosses first and finishes by crossing it again, so clubs can race one circuit from their own waters. |
| **Distance-factor handicap** *(designed, not built)* | The handicap is spent on the course rather than the clock — each boat gets its own line — and first home wins. |

## How it is built

Two parts, and the division between them is the whole architecture:

- **A client on the boat.** Reads GNSS, runs quality control, detects and times crossings, and
  builds its own race record — with no network. Plain HTML and JavaScript, no framework and no
  build step; the same files are served by the server and are meant to be wrapped by Capacitor
  for background geolocation.
- **A server on shore.** Hands out course definitions before the start, carries the race
  committee's side of a race while it runs — starts, flags, a message channel, a live fleet feed —
  and collects records afterwards. Java 21 on embedded Jetty, YAML configuration, JSON files on
  disk: the same approach as [sail-jinx](https://github.com/gregw/sail-jinx) and
  [sailing-pf](https://github.com/gregw/sailing-pf).

> **A boat's own rounding and timing are computed entirely on the device and never wait on a
> server.** The server is outside the rounding path: it distributes, relays and collects; it does
> not adjudicate a crossing, and it does not score.

## What is in it

| Page | For |
|---|---|
| `/editor.html` | the **course editor** — points, lines, courses and races against a chart; snapshot and publish what a fleet is handed |
| `/boat.html` | **the client**, on a phone: join a race or a course, and sail it on the phone's own GNSS |
| `/client.html` | **the test rig**: the same client on a simulated boat with a receiver that lies, steered by clicking a chart |
| `/race.html` | the **race screen** — the committee's starts, flags, course changes, channel and fleet |
| `/results.html` | **results**: races as a finishing order, record attempts by course revision |
| `/*-test.html` | the JavaScript specs, in a browser |

## Running it

Needs Java 21, Maven, and Node (for the JavaScript specs).

```bash
mvn exec:java                                 # serves http://localhost:8083/ from ./data
mvn exec:java -Dunmarked-data=/path/to/data   # from somewhere else
mvn test                                      # Java tests and the JavaScript specs
tools/editor-drive/run.sh                     # every page driven headlessly against a live server
```

Then open `http://localhost:8083/`. The sample series under `data/config/clubs/myc.org.au/` has
courses around Sydney Harbour to try in the test rig. Their positions were placed by eye on a chart;
**nothing in this repository is a survey**, and real positions must be surveyed before anybody races.

With no `data/config/auth.yaml` the editor and the race screen are open to anything that can reach
the port, which is right for a laptop and wrong for anything else. [Deployment](https://github.com/gregw/sail-unmarked/wiki/deployment)
covers the login and installing on a Raspberry Pi.

## Status

A prototype that runs end to end: a race can be defined, published, joined from a phone, started,
sailed, and read back as results. Not built yet: the native wrapper and an offline tile cache, the
picture of the whole fleet at your corrected time (the boat's Place screen is a ranked table), a boat switching to a
course change mid-race, re-posting a record with its full track, and a club entering its fleet's
TCFs in advance.
See [Open questions](https://github.com/gregw/sail-unmarked/wiki/open-questions) for what is undecided.

## Documentation

The documents are the [project wiki](https://github.com/gregw/sail-unmarked/wiki), checked out at `wiki/` as a git submodule. Start with
its [**Home**](https://github.com/gregw/sail-unmarked/wiki/Home) page — how the whole thing works, in one pass, with a map of the rest of
the wiki and a glossary. [`CLAUDE.md`](CLAUDE.md) holds
the working notes for changing the code.
