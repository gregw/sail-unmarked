/**
 * THE DEVICE — the whole of what a boat holds, and the only copy of it.
 *
 * There are two pages that put this on a screen and they have nothing in common below it.
 * `client.html` is the test rig: a simulated boat on a chart, a receiver that lies, and the
 * device sitting on the desk beside them. `boat.html` is the real thing: one panel, the
 * phone's own GNSS behind it, and nothing else on the page at all. Both of them import THIS
 * file, because the alternative is two clients and the one that fell behind would be whichever
 * was edited second — and the difference would be discovered on the water, by the only person
 * who cannot do anything about it.
 *
 * <b>What is in here is exactly what would ship.</b> The join screen, the screen-switching,
 * the orientation and view selectors, the overview's chart controls, and `feed` — which takes
 * one fix and gives it to the client. Nothing in this file knows where a fix came from, and
 * that is the seam the architecture rests on: `boatsim.js` and `receiver.js` are
 * interchangeable, and `boatsim-test.js` and `receiver-test.js` each pin the key set of a fix
 * so they cannot drift apart a convenient field at a time.
 *
 * What is NOT in here is anything either page needs and the other does not: the rig's chart,
 * knobs and trail; the phone's wake lock and permission prompt. Those reach the device through
 * the handful of hooks the constructor takes, so a page can add a control without this file
 * learning what a simulator is.
 */

import {
  OVERVIEW_ZOOM, OverviewView, PlotView, Turner, esc, markScreen, overviewPanel,
} from './markscreen.js';
import { RaceClient } from './raceclient.js';

/**
 * The plot's own coordinate space, which is not the panel's width in pixels.
 *
 * Fixed, and the same on both pages, because it is a `viewBox`: the SVG scales to whatever
 * width the panel turns out to be, so this decides the picture's SHAPE and the units the
 * geometry is solved in, not how big it ends up. A number that followed the panel would make
 * every measured thing in `markscreen.js` — label boxes, the border buffer, the boat's pixel
 * bounds — mean something different on every device.
 */
export const PLOT = { width: 400, height: 330 };

/**
 * What the join screen remembers between visits: who the boat is, and whose racing it joins.
 *
 * <b>The boat is the same boat every time; the course is not.</b> A sail number, a name and a
 * club are facts about the person holding the phone and asking for them again on every join is
 * asking them to re-type what has not changed. The series, course and variant are the opposite
 * — they are the decision being made, and a remembered one would be a default nobody chose,
 * which on a race morning is how a boat ends up sailing yesterday's course.
 *
 * `sessionStorage`, deliberately for now: it lasts a session, which is what "the same boat all
 * afternoon" needs, and it does not quietly become a permanent setting on a shared phone. The
 * real home for this is whatever the Capacitor build uses, and that is not built yet.
 *
 * Wrapped, because storage is not always there to be had — a private window, blocked site data
 * — and a join screen that threw rather than opening would be the worst possible trade for
 * remembering a sail number.
 */
export const REMEMBERED = 'unmarkable.join';

export function recall() {
  try {
    const held = JSON.parse(sessionStorage.getItem(REMEMBERED) ?? '{}');
    return {
      sail: typeof held.sail === 'string' ? held.sail : '',
      name: typeof held.name === 'string' ? held.name : '',
      club: typeof held.club === 'string' ? held.club : null,
    };
  } catch {
    return {};
  }
}

export function remember(boat) {
  try {
    sessionStorage.setItem(REMEMBERED, JSON.stringify({
      sail: boat.sail, name: boat.name, club: boat.club ?? null,
    }));
  } catch {
    // Nothing to be done and nothing worth saying: the page works, it just forgets.
  }
}

export class Device {
  /**
   * @param host the element the device draws into — the whole of it, every render.
   * @param hooks what the page adds. All optional:
   *   `kicker` the line at the head of the join screen;
   *   `note()` HTML above the boat's own fields, for anything the page has to say before a
   *     join — the real client's location permission lives here — with `wireNote()` called
   *     after every render of that screen, since the render replaces whatever it contained;
   *   `blocked()` a sentence naming what the PAGE is still waiting for, which disables the
   *     join button and becomes its label;
   *   `extras()` / `wireExtras()` a row of buttons under the sailing screens;
   *   `onJoin(client)` / `onLeave()` what the page does about a course being taken or dropped.
   */
  constructor(host, hooks = {}) {
    this.host = host;
    this.hooks = hooks;
    this.client = null;
    this.snapshot = null;
    this.courses = [];
    this.message = null;
    this.boat = { sail: '', name: '', tcf: '1.000', mode: 'ANONYMOUS', ...recall() };

    // How the sailor reads a chart, and what is drawn behind it. `none` to start, which
    // fetches nothing: a screen whose whole claim is that it works with the server switched
    // off does not open by asking a tile server for anything.
    this.orientation = 'north';
    this.basemap = 'none';
    // The Mark screen's frame, held across renders so the boat is seen to move across it
    // rather than sitting in the middle of a picture that re-fits itself every frame.
    this.plotView = new PlotView();
    // What the sailor has done to the COURSE overview by hand — zoomed it, moved it.
    this.overview = new OverviewView();
    // The overview turns too, and keeps its own swing: the two screens are looking at
    // different things and arrive at a new leg at different moments, so one shared bearing
    // would have each of them jumping whenever the other one moved.
    this.courseTurn = new Turner();
  }

  /* ======================================================== what can be joined */

  /**
   * What the club made public AND published, which is the only thing that can be joined.
   *
   * A course with nothing published is not offered, because there would be nothing to hand
   * over: what a boat sails is a SNAPSHOT.
   */
  async load() {
    try {
      this.courses = (await (await fetch('/api/public')).json())
        .filter((course) => course.published.length > 0);
    } catch (error) {
      this.message = `Could not read the public courses: ${error.message}`;
    }
    return this.courses;
  }

  /* ============================================================== the screens */

  /** Draw whichever screen the client says the sailor should be looking at. */
  render() {
    if (!this.client) return this.renderJoin();

    /*
     * NOT WHILE SOMEBODY IS CHOOSING A BACKGROUND.
     *
     * This panel is rebuilt from scratch on every fix, and rebuilding it destroys the elements
     * in it — including a `<select>` whose popup is open, which the browser then closes. At a
     * fix a second that made the background unpickable: the list appeared, the next fix
     * arrived, and it vanished before the pointer reached the option. It reads as the menu
     * closing when you move the mouse over it, which is exactly what somebody reported.
     *
     * So the render is held while that control has focus — the same rule the editor follows
     * for a field somebody is typing in, for the same reason. Held on FOCUS rather than on a
     * flag of our own, so it cannot stick: the moment focus goes anywhere else the panel
     * resumes, and nothing has to remember to release it.
     */
    const chooser = this.el('o_basemap');
    if (chooser && document.activeElement === chooser) return undefined;

    const now = Date.now();
    // FORCING the Mark screen can ask for a state there is none of — no fix yet, no surveyed
    // mark — and the honest answer then is the overview, not a blank. So the state is asked
    // for and the screen follows what came back rather than what was requested.
    const mark = this.client.view(now) === 'mark' ? this.client.markState(now) : null;
    const shared = {
      orientation: this.orientation, viewMode: this.client.viewMode, ...PLOT, now,
    };
    this.host.innerHTML = (mark
      ? markScreen(mark, { ...shared, view: this.plotView })
      : overviewPanel(this.client, {
        ...shared, turner: this.courseTurn, view: this.overview, basemap: this.basemap,
      })) + this.bottomRow();
    this.wireOrientation();
    this.wireViews();
    this.wireChart();
    this.wireBottom();
    return undefined;
  }

  el(id) {
    return document.getElementById(id);
  }

  /** True while either display is mid-swing, which is what a page drives its frames off. */
  turning() {
    return !!this.client && (this.plotView.turning() || this.courseTurn.turning());
  }

  /**
   * Leave the course, and hand the page whatever it has to undo.
   *
   * A fresh join rather than a reset in place, everywhere: every detector has to be new —
   * they latch and stand by design — and building a new client is the one way to be sure
   * nothing was left over from the last attempt.
   */
  leave() {
    this.client = null;
    this.snapshot = null;
    this.hooks.onLeave?.();
    this.renderJoin();
  }

  bottomRow() {
    return `
      <div class="deck">
        ${this.hooks.extras?.() ?? ''}
        <button class="plain" id="leave">Leave course</button>
      </div>`;
  }

  wireBottom() {
    this.el('leave')?.addEventListener('click', () => this.leave());
    this.hooks.wireExtras?.();
  }

  /**
   * Zoom, fit, background and the drag that pans — the overview's own controls.
   *
   * <b>The drag is followed on the DOCUMENT, not on the chart.</b> This panel is rebuilt on
   * every fix, so the element a drag started on is gone a fraction of a second later and a
   * `pointermove` wired to it would stop arriving halfway through the gesture — the chart
   * would follow the finger and then stick. The document outlives every render, so the drag
   * does too.
   */
  wireChart() {
    for (const button of this.host.querySelectorAll('[data-zoom]')) {
      button.addEventListener('click', () => {
        const what = button.dataset.zoom;
        if (what === 'fit') this.overview.reset();
        else this.overview.zoomBy(what === 'in' ? OVERVIEW_ZOOM.step : 1 / OVERVIEW_ZOOM.step);
        this.render();
      });
    }
    this.el('o_basemap')?.addEventListener('change', (ev) => {
      this.basemap = ev.target.value;
      // Blurred first, or the hold above would keep the panel frozen on the very render that
      // is meant to show what was just chosen: a `<select>` keeps focus after it is used.
      ev.target.blur?.();
      this.render();
    });

    const chart = this.host.querySelector?.('.plot');
    chart?.addEventListener('pointerdown', (ev) => {
      // Only the overview pans: the Mark screen's frame is held on purpose and dragging it
      // would be arguing with the one thing that screen does.
      if (!this.client || this.client.view(Date.now()) === 'mark') return;
      let at = { x: ev.clientX, y: ev.clientY };
      const move = (m) => {
        this.overview.panByPx(m.clientX - at.x, m.clientY - at.y);
        at = { x: m.clientX, y: m.clientY };
        this.render();
      };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  /**
   * The view selector, on both screens for the same reason the orientation one is: either
   * screen may be the one you want to leave.
   *
   * It sets the mode on the CLIENT rather than on the page, because `RaceClient.view()` is the
   * single answer to "which screen" and a page holding its own copy would be a second rule.
   */
  wireViews() {
    for (const button of this.host.querySelectorAll('[data-view]')) {
      button.addEventListener('click', () => {
        this.client.setViewMode(button.dataset.view);
        // The frame is a picture of one mark at one scale; coming back to the approach after
        // looking at the course is a fresh approach, so it is not held across.
        this.plotView = new PlotView();
        this.render();
      });
    }
  }

  /**
   * The orientation selector is on BOTH screens and sets one setting.
   *
   * The choice is about how somebody reads a chart, not about which screen happens to be up,
   * and a selector that only existed on the approach would mean the setting could not be
   * changed from the screen a boat spends most of its time looking at.
   */
  wireOrientation() {
    for (const button of this.host.querySelectorAll('[data-orient]')) {
      button.addEventListener('click', () => {
        this.orientation = button.dataset.orient;
        this.render();
      });
    }
  }

  /* ================================================================= the join */

  /**
   * The join screen: who the boat is, then club, series, course and variant.
   *
   * The drill is the shape of the answer somebody actually holds — "the Saturday sprints, the
   * short course" — and it is built from `/api/public`, so what can be joined here is exactly
   * what the club made public and published.
   */
  renderJoin() {
    const options = (values, chosen) => values.map((v) =>
      `<option value="${esc(v.value)}"${v.value === chosen ? ' selected' : ''}>${esc(v.label)}</option>`).join('');

    /*
     * NOTHING BELOW THE CLUB IS CHOSEN FOR YOU, and each level is empty until the one above it
     * has been answered.
     *
     * It used to default every level to the first thing in the list, so the screen opened with
     * a complete course already selected — which reads as a suggestion, and on a race morning
     * a suggestion nobody made is how a boat sails yesterday's course. Worse, the first item is
     * whatever the map happened to iterate first: not the club's main race, not the nearest,
     * not the most recent. An empty field asks the question; a filled one answers it wrongly
     * and quietly.
     *
     * The CLUB is the exception, and is remembered rather than defaulted — see `recall`. It is
     * a fact about the boat, not a decision about today.
     *
     * A remembered club that is no longer on offer falls back to unchosen: a `<select>` whose
     * value matches no option shows blank, which would be a screen saying nothing and blaming
     * nobody.
     */
    const clubs = [...new Set(this.courses.map((c) => c.club))];
    const club = clubs.includes(this.boat.club) ? this.boat.club : '';
    const series = club
      ? [...new Set(this.courses.filter((c) => c.club === club).map((c) => c.series))] : [];
    const chosenSeries = series.includes(this.boat.series) ? this.boat.series : '';
    const courses = chosenSeries
      ? this.courses.filter((c) => c.club === club && c.series === chosenSeries) : [];
    const chosenCourse = courses.find((c) => c.course === this.boat.course) ?? null;
    const variants = chosenCourse?.published ?? [];
    const chosenVariant = variants.find((v) => v.variant === this.boat.variant) ?? null;
    const blocked = this.hooks.blocked?.() ?? null;
    const ready = !!(club && chosenSeries && chosenCourse && chosenVariant) && !blocked;

    /**
     * A level's options, headed by the question itself.
     *
     * The placeholder is not an option — it carries no value, so it cannot be submitted — it
     * is what the field says while it is still a question. A level with nothing above it
     * answered says so in the placeholder and is disabled, because an empty dropdown that
     * opens and shows nothing tells you there is nothing, where the truth is *not yet*.
     */
    const level = (values, chosen, asking, waiting) => {
      const has = values.length > 0;
      return `${has && chosen ? '' : `<option value="" selected>${esc(has ? asking : waiting)}</option>`}`
        + options(values, chosen);
    };

    this.host.innerHTML = `
      <div class="join">
        <p class="kicker">${esc(this.hooks.kicker ?? 'Prototype client')}</p>
        ${this.hooks.note?.() ?? ''}
        <h2>Your boat</h2>
        <div class="pair">
          <div><label for="j_sail">Sail no.</label>
            <input id="j_sail" value="${esc(this.boat.sail)}" placeholder="AUS 1234"></div>
          <div><label for="j_name">Boat name</label>
            <input id="j_name" value="${esc(this.boat.name)}" placeholder="Bombora"></div>
        </div>

        <h2>Course</h2>
        ${this.courses.length === 0 ? `<p class="muted" style="font-size:13px">
          Nothing to join. A course appears here once it is ticked <strong>public</strong>
          and has a published snapshot &mdash; both, because what a boat is handed is a
          snapshot. Use the <a href="editor.html">editor</a>.</p>` : `
          <label for="j_club">Club</label>
          <select id="j_club">${level(clubs.map((v) => ({ value: v, label: v })), club,
            'Choose a club', 'No clubs')}</select>
          <label for="j_series">Series</label>
          <select id="j_series"${club ? '' : ' disabled'}>${level(
            series.map((v) => ({ value: v, label: v })), chosenSeries,
            'Choose a series', 'Choose a club first')}</select>
          <label for="j_course">Course</label>
          <select id="j_course"${chosenSeries ? '' : ' disabled'}>${level(courses.map((c) =>
            ({ value: c.course, label: c.name && c.name !== c.course ? `${c.name} (${c.course})` : c.course })),
            chosenCourse?.course, 'Choose a course', 'Choose a series first')}</select>
          <label for="j_variant">Variant</label>
          <select id="j_variant"${chosenCourse ? '' : ' disabled'}>${level(variants.map((v) =>
            ({ value: v.variant, label: `${v.name ?? v.variant}${v.lengthNm == null ? '' : ` — ${v.lengthNm.toFixed(2)} nm`}${v.closed ? ', cycle' : ''}` })),
            chosenVariant?.variant, 'Choose a variant', 'Choose a course first')}</select>
          ${chosenVariant ? `<p class="muted mono" style="font-size:11px; margin-top:6px">
            revision ${esc(chosenVariant.revision)} &middot; ${chosenVariant.steps ?? '?'} marks</p>` : ''}

          <h2>How you are sailing</h2>
          <label for="j_mode">This counts as</label>
          <select id="j_mode">${options([
            { value: 'ANONYMOUS', label: 'Practice — kept for you, published to nobody' },
            { value: 'RACE', label: 'Race — goes to the club, which scores it' },
            { value: 'RECORD', label: 'Record attempt — stands against every other' },
          ], this.boat.mode)}</select>
          <label for="j_tcf">TCF</label>
          <input id="j_tcf" value="${esc(this.boat.tcf)}">
          <p class="muted" style="font-size:11px; margin-top:4px">
            The handicap is carried, not applied. Turning a TCF into a distance is
            <span class="mono">CLAUDE.md</span> open question 5 and is not answered yet, so no
            sub-line is being computed for you.</p>

          <!--
            The button SAYS WHAT IS MISSING rather than sitting greyed out with no explanation.
            A disabled control with the same label as an enabled one is a dead end: it invites
            somebody to press it again harder. Naming the next unanswered level turns it into
            the last line of the form.

            WHAT THE PAGE ITSELF IS WAITING FOR IS NAMED FIRST, ahead of any unanswered level:
            a location permission is asked for at the top of this form, it is the one thing
            here that can take half a minute to come good, and it is a precondition for all of
            it rather than another field. Naming a club that has not been chosen while the
            phone cannot see the sky would send somebody to answer the wrong question.
          -->
          <button class="go" id="j_go"${ready ? '' : ' disabled'}>${esc(ready ? 'Join and sail'
            : blocked ? blocked
              : !club ? 'Choose a club'
                : !chosenSeries ? 'Choose a series'
                  : !chosenCourse ? 'Choose a course' : 'Choose a variant')}</button>`}
        ${this.message ? `<p class="warn" style="font-size:12.5px; margin-top:10px">${esc(this.message)}</p>` : ''}
      </div>`;

    const keep = (id, field, held = false) => this.el(id)?.addEventListener('input', (ev) => {
      this.boat[field] = ev.target.value;
      // Written as it is typed, not on join: somebody who fills in a sail number and then goes
      // to look at the editor should not come back to an empty field.
      if (held) remember(this.boat);
    });
    keep('j_sail', 'sail', true);
    keep('j_name', 'name', true);
    keep('j_tcf', 'tcf');
    keep('j_mode', 'mode');

    // The drill resets everything BELOW the level that changed. Keeping a course id chosen
    // under a different series would offer something that is not there.
    const redraw = (field, ...clear) => this.el(`j_${field}`)?.addEventListener('change', (ev) => {
      // The placeholder's empty value is "unchosen", not a club called "": stored as null so
      // every level tests the same way.
      this.boat[field] = ev.target.value || null;
      for (const lower of clear) this.boat[lower] = null;
      if (field === 'club') remember(this.boat);
      this.renderJoin();
    });
    redraw('club', 'series', 'course', 'variant');
    redraw('series', 'course', 'variant');
    redraw('course', 'variant');
    redraw('variant');

    // Guarded as well as disabled: `disabled` is a property of a rendered button, and this
    // handler is the thing that would be asked to join a course nobody has finished choosing.
    this.el('j_go')?.addEventListener('click', () => {
      if (ready) this.join(club, chosenSeries, chosenCourse.course, chosenVariant.variant);
    });

    // Whatever the page put in `note()` has just been rebuilt with everything else, so its
    // controls are wired HERE rather than once at start-up — a handler attached to a node a
    // later render replaced is the one bug this pane keeps producing.
    this.hooks.wireNote?.();
    return undefined;
  }

  /**
   * Take the course.
   *
   * This is the one network call the client makes in anger, and it is a real one: the same
   * `POST /api/join` a boat on the water would make, answering with the snapshot that was
   * published rather than whatever the editor currently holds. After it returns, the server
   * can be switched off and nothing on this page will notice.
   */
  async join(club, series, course, variant) {
    this.message = null;
    if (!course || !variant) return;
    try {
      const response = await fetch(
        `/api/join/${encodeURIComponent(club)}/${encodeURIComponent(series)}/${encodeURIComponent(course)}`
        + `?variant=${encodeURIComponent(variant)}`, { method: 'POST' });
      if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
      this.snapshot = await response.json();
      this.start();
    } catch (error) {
      this.message = `Could not join: ${error.message}`;
      this.renderJoin();
    }
  }

  /**
   * Begin — or begin again — on the snapshot already in hand.
   *
   * Every attempt gets a NEW client, because the detectors latch and stand by design, so the
   * only way to be sure nothing was left over from the last one is not to keep any of it.
   */
  start() {
    this.client = new RaceClient(this.snapshot, {
      boat: { ...this.boat }, joinMode: this.boat.mode,
    });
    this.plotView = new PlotView();
    this.courseTurn = new Turner();
    this.hooks.onJoin?.(this.client);
    this.render();
    return this.client;
  }

  /* ================================================================== the seam */

  /**
   * ONE FIX, from whatever receiver the page has, to the client. Nothing else crosses.
   *
   * The rig hands this the output of `boatsim.js` and the real client hands it the output of
   * `receiver.js`, and this method could not tell you which — which is the entire claim. The
   * verdict goes back so a page can say what became of the fix; the rig prints it in its
   * trail and the phone shows only the trouble.
   */
  feed(fix) {
    if (!this.client) return null;
    const verdict = this.client.accept(fix);
    this.render();
    return verdict;
  }
}
