# Sail Unmarked

*Sail racing around virtual marks. Every mark is a line to be crossed, not a point to be
rounded.*

---

## What this is

Racing where the mark you round is a **line checked by GPS** rather than a buoy checked by
eyeball. Fleets already cross start lines this way — often unsighted to one or both ends,
often relying on instruments — and this extends that to every rounding.

Two reasons for a line rather than a point:

- **RRS 18 (mark-room) never applies.** There is no zone to reach and no inside or outside
  overlap to adjudicate, so boats meeting near a line fall back on the Part 2
  right-of-way rules alone. That is a deliberate safety choice.
- **No rounding radius to dispute.** GPS error cannot put a boat inside or outside a
  circle, because there is no circle.

It also removes the work of laying marks, and makes some formats possible that were not:

| Format | What it changes |
|---|---|
| **Self-timed rolling start** | Each boat starts in its own time inside a window; its clock starts when it crosses. No start-line scrum, no committee-boat sightline. |
| **Distance-factor handicap** | The handicap is spent on the course rather than the clock — each boat gets its own parallel line, and first home wins. Handicap becomes raceable on the water instead of arithmetic done to you afterwards. |
| **Circuit, join anywhere** | Boats join a loop at any point, finish where they entered, and are ranked live. Different clubs sail it on their own evening without travelling to a common start. |

## How it is built

Two parts, and the division between them is the whole architecture:

- **A client on the boat.** Reads GPS, detects crossings, times them, and stores its own
  race record. Works with no network. HTML/CSS/JavaScript, to be wrapped with Capacitor
  for background geolocation.
- **A server on shore.** Distributes course definitions before the start and aggregates
  records afterwards. Java on embedded Jetty, YAML configuration, JSON files — the same
  approach as [sail-jinx](https://github.com/gregw/sail-jinx) and
  [sailing-pf](https://github.com/gregw/sailing-pf).

> **A boat's own rounding and timing are computed entirely on the device and never wait on
> a server.** The server is explicitly outside the rounding path: it distributes and
> aggregates, it does not adjudicate a crossing.

## Running it

```bash
mvn exec:java     # http://localhost:8083/
mvn test          # Java tests, plus the crossing detector's spec
```

Courses are YAML, one file per club and series, under
`data/config/clubs/<club domain>/<series>.yaml`.

**No coordinates are supplied.** Every position in this repository is `null`, waiting on a
survey — the design brief is explicit that real positions are to be supplied and not
guessed, and the server reports each unsurveyed point as a problem rather than pretending.

## Status

Early. The **crossing detector** — sense, extent, fix quality control, and the N-and-N
latch — is built and has an executable specification that runs in the build. The **server**
loads and validates courses, serves them, and stores race records. The **course editor**
authors them against a chart and publishes what a fleet is handed.

There is now a **prototype client** at `/client.html`: a simulated boat on one side of the
page and the boat's own screens on the other, with nothing passing between them but a GPS
fix. Steer it at a line and the Mark screen takes over on its own as it closes. It is a
prototype — not on a phone, not offline, and it posts no records yet. **Live place** is not
built at all.

See [`wiki/unmarked-racing-brief.html`](wiki/unmarked-racing-brief.html) for the design
brief, [`wiki/course-model.md`](wiki/course-model.md) for what a course is made of, and
[`CLAUDE.md`](CLAUDE.md) for the working notes and the rest of the wiki's index.
