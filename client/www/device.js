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
  OVERVIEW_ZOOM, OverviewView, PlotView, Turner, esc, markScreen, overviewPanel, viewBar,
} from './markscreen.js';
import { RaceClient } from './raceclient.js';
import { Dialog } from './dialog.js';
import { alertBanner, alertModal, chatPanel, placePanel, startRow } from './screens.js';

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
/**
 * "No race — just sail a course", which is an ANSWER rather than the absence of one.
 *
 * The empty option on every other level means *not yet chosen*; this one means *there is nobody
 * running a race on this*, which is a thing somebody means and is what this system did before
 * there were committees (§8.2). Two different facts need two different values.
 */
export const NO_RACE = '__course';

export const REMEMBERED = 'unmarked.join';

export function recall() {
  try {
    const held = JSON.parse(sessionStorage.getItem(REMEMBERED) ?? '{}');
    return {
      sail: typeof held.sail === 'string' ? held.sail : '',
      name: typeof held.name === 'string' ? held.name : '',
      club: typeof held.club === 'string' ? held.club : null,
      // A LENGTH IS A FACT ABOUT THE BOAT, like its sail number, and does not change between
      // races — so it is remembered with them rather than asked again every afternoon. The TCF
      // is not: a handicap is a decision somebody may revise, and one carried forward silently
      // would be scored against.
      ...(typeof held.lengthM === 'string' && held.lengthM ? { lengthM: held.lengthM } : {}),
    };
  } catch {
    return {};
  }
}

export function remember(boat) {
  try {
    sessionStorage.setItem(REMEMBERED, JSON.stringify({
      sail: boat.sail, name: boat.name, club: boat.club ?? null, lengthM: boat.lengthM,
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
    this.boat = { sail: '', name: '', tcf: '1.000', lengthM: '10', mode: 'ANONYMOUS', ...recall() };
    /*
     * HOW CLOSE THE APPROACH PLOT MAY ZOOM, in this boat's lengths — the server's setting, read
     * once with the course list. Defaulted here and never awaited on the sailing path: the Mark
     * screen is offline-first, so a boat whose config fetch failed draws to the built-in three.
     */
    this.display = {};

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

    /*
     * THE CONVERSATION, and it is allowed to be absent.
     *
     * Nothing on the path from a fix to a latch goes through it: the boat detects and times its
     * own crossings with no network, and everything here is either something it tells the fleet
     * or something the committee tells it. So the dialog is constructed, it may never connect,
     * and the screens say which state they are in rather than pretending.
     *
     * `onChange` rather than the device polling it: a message can arrive between fixes — a flag
     * does not wait for the boat to move — and a screen that only redrew on a fix would show an
     * abandonment whenever the next fix happened to turn up.
     */
    this.dialog = new Dialog({ onChange: () => this.render() });
    // Whether a new channel entry has been allowed to take the screen yet. Auto's one new
    // clause fires once per entry: bringing the channel up again every render would make it
    // impossible to look at anything else (§9.5).
    this.offered = 0;
    // `Place` is a screen you go to, so which half of the fleet it shows is a setting on it.
    this.division = false;
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
    /*
     * AND HOW THIS FLEET'S SCREENS ARE TO BE DRAWN, which is one number and a forgiving one.
     * A failure here is not worth a message: the setting has a default, the screens work
     * without it, and a boat that could not reach the server has a larger problem already
     * being reported above.
     */
    try {
      const config = await (await fetch('/api/config')).json();
      this.display = config?.display ?? {};
    } catch {
      this.display = {};
    }
    await this.loadRaces();
    return this.courses;
  }

  /**
   * THE RACES EACH SERIES HAS TODAY, because a boat joins a RACE where there is one.
   *
   * A course can be joined without a race behind it — that is the whole of §8.2 and it is what
   * this system did before there were committees — but where a club is running one, joining the
   * course and hoping to be matched to the race is the wrong way round: it works only while one
   * division sails one course, and it leaves the boat unable to say which division it is in.
   *
   * <b>Today's races only.</b> A race defined for next Saturday is not something a boat can join
   * this afternoon, and offering it would be offering a mistake. Where a series has races but
   * none today, the screen says so rather than showing an empty list, because *no races* and *no
   * races today* are different facts and only the second is worth acting on.
   *
   * Read over REST like everything else the join screen needs: it is online by definition, and
   * these are cacheable reads that work before there is a session (§8.1).
   */
  async loadRaces() {
    this.races = {};
    const series = [...new Set(this.courses.map((c) => `${c.club}/${c.series}`))];
    await Promise.all(series.map(async (key) => {
      try {
        const held = await (await fetch(`/api/races/${key}`)).json();
        this.races[key] = Object.entries(held ?? {})
          .map(([id, race]) => ({ id, ...race }));
      } catch {
        // No races, or an older server with no such endpoint. Either way the screen falls back
        // to choosing a course, which is what it did before there were races at all.
        this.races[key] = [];
      }
    }));
    return this.races;
  }

  /** Today in the boat's own reckoning, which is the day a race is offered on. */
  static today() {
    return new Date().toLocaleDateString('en-CA');
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
    /*
     * AUTO'S ONE NEW CLAUSE, and the test is the one that already exists: if the Line screen
     * would be taken, chat does not take it (§9.5). Offered once per entry rather than while
     * there is an unread one, or a boat with something unread could never look at its course.
     */
    const news = this.dialog.live && this.dialog.channel.length > this.offered;
    const wanted = this.client.view(now, { channel: news });
    if (news && wanted === 'chat') this.offered = this.dialog.channel.length;

    // FORCING the Mark screen can ask for a state there is none of — no fix yet, no surveyed
    // mark — and the honest answer then is the overview, not a blank. So the state is asked
    // for and the screen follows what came back rather than what was requested.
    const mark = wanted === 'mark' ? this.client.markState(now) : null;
    const shared = {
      orientation: this.orientation, viewMode: this.client.viewMode, ...PLOT, now,
      // The club's closest zoom, in this boat's lengths. Passed on every render rather than
      // held by the plot, so a setting read after a join still reaches the next frame.
      boatLengthsAcross: this.display?.boatLengthsAcross,
      // A screen with nothing behind it is not offered: Chat and Place are absent from the
      // selector unless there is a race to have a channel (§8.2).
      channel: this.dialog.live, unread: this.dialog.unread,
    };

    /*
     * NOTHING INTERRUPTS AN APPROACH (§9.3). While the Mark screen has the display the alert
     * shows as a banner and the modal waits — a sailor thirty metres off a line at nine knots
     * is doing the one thing on this boat that cannot be interrupted, and a dialog over the plot
     * at that moment is worse than any news it could be carrying.
     */
    const alert = this.dialog.alert;
    const approaching = mark != null;

    /*
     * CHAT AND PLACE CARRY THE VIEW BAR TOO, and leaving it off trapped a boat on them.
     *
     * The Mark screen and the overview each emit their own — they have an orientation bar to
     * put it beside — so it was easy to believe every screen had one. These two have no chart
     * and no orientation, so nothing drew the selector and there was no way off them but a
     * reload, which on the water costs the joined race. The rule the selector exists for is
     * the rule that was broken: it is on EVERY screen, because any one of them may be the one
     * you want to leave.
     */
    const bars = viewBar(this.client.viewMode, shared);

    let screen;
    if (mark) screen = markScreen(mark, { ...shared, view: this.plotView })
      + (alert ? alertBanner(alert) : '');
    else if (wanted === 'chat') screen = chatPanel(this.dialog, { ...shared, bars });
    else if (wanted === 'place') screen = placePanel(this.dialog,
      { ...shared, bars, division: this.division });
    else screen = overviewPanel(this.client, {
      ...shared, turner: this.courseTurn, view: this.overview, basemap: this.basemap,
    });

    this.host.innerHTML = startRow(this.dialog, now)
      + screen
      + this.bottomRow()
      + (alert && !approaching ? alertModal(alert) : '');
    this.wireOrientation();
    this.wireViews();
    this.wireChart();
    this.wireChannel();
    this.wireBottom();
    // Being on the channel screen IS reading it — and NOT notified, because this is a render
    // and `changed()` is a request for one.
    if (wanted === 'chat') this.dialog.markRead(false);
    return undefined;
  }

  /**
   * The channel's own controls: what a boat says, and the one gesture that acknowledges.
   *
   * <b>Dismissing the alert IS the acknowledgement</b> (§9.3) — one gesture, not two. A dialog
   * offering *Dismiss* and a separate *Acknowledge* would be asking somebody at a tiller to
   * agree that they had read a thing they had just closed.
   */
  wireChannel() {
    this.el('alertOk')?.addEventListener('click', () => {
      this.dialog.ack(this.dialog.alert?.id, this.dialog.alert?.type);
      this.render();
    });
    for (const button of this.host.querySelectorAll('[data-say]')) {
      button.addEventListener('click', () => {
        this.dialog.say(button.dataset.say);
        this.render();
      });
    }
    for (const button of this.host.querySelectorAll('[data-place]')) {
      button.addEventListener('click', () => {
        this.division = button.dataset.place === 'mine';
        this.render();
      });
    }
    this.el('sayGo')?.addEventListener('click', () => {
      const field = this.el('sayText');
      if (this.dialog.say(field?.value)) {
        if (field) field.value = '';
        this.render();
      }
    });
    // The log is read bottom-up like every other log on the water, so it opens at the bottom.
    const log = this.el('chatLog');
    if (log) log.scrollTop = log.scrollHeight;
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
    // Goodbye on the wire as well, so the fleet list stops showing a boat that has gone home.
    // Not awaited: leaving is a thing that has happened, not a request.
    this.dialog.leave().catch(() => null);
    this.hooks.onLeave?.();
    this.renderJoin();
  }

  bottomRow() {
    /*
     * PRACTICE GETS TO STEP THROUGH THE COURSE, AND A RACE DOES NOT.
     *
     * Practising is sailing one mark over and over, then the next one — and without these the
     * only way to put mark 4 live is to round three marks first. The client refuses the skip
     * outright unless the boat joined as practice (`RaceClient.resolveSkip`), so this is the
     * screen agreeing with a rule rather than the rule being a screen that happens not to draw
     * a button.
     *
     * They NAME THE MARK THEY GO TO rather than saying "prev" and "next", because the whole
     * point of pressing one is to arrive at a particular mark, and a boat that can see where a
     * button lands does not have to press it to find out. Absent rather than disabled at the
     * ends of the sequence: a dead control on a five-button row is ink that says nothing, and
     * the sequence's ends are obvious from the letters themselves.
     */
    const back = this.client?.skipTarget(-1) ?? null;
    const on = this.client?.skipTarget(1) ?? null;
    return `
      <div class="deck">
        ${back ? `<button class="plain skip" id="skip_back">&lsaquo; ${esc(back.letter)}</button>` : ''}
        ${on ? `<button class="plain skip" id="skip_on">${esc(on.letter)} &rsaquo;</button>` : ''}
        ${this.hooks.extras?.() ?? ''}
        ${this.dialog.live && !this.dialog.outcome
          // RETIRING IS NEVER INFERRED (§8.6): a boat retires because a sailor pressed retire,
          // and the software does not work it out from a boat that stopped reporting.
          ? '<button class="plain" id="retire">Retire</button>' : ''}
        <button class="plain" id="leave">Leave course</button>
      </div>`;
  }

  wireBottom() {
    for (const [id, delta] of [['skip_back', -1], ['skip_on', 1]]) {
      this.el(id)?.addEventListener('click', () => {
        this.client.skip(delta);
        // A different mark is a different picture: the held frame is a fit around the one the
        // boat was approaching, and carrying it over would open the new one at the old scale.
        this.plotView = new PlotView();
        this.render();
      });
    }
    this.el('leave')?.addEventListener('click', () => this.leave());
    this.el('retire')?.addEventListener('click', () => {
      this.dialog.retire('retired');
      this.dialog.outcome = 'retired';
      this.render();
    });
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
     * NO LEVEL IS DEFAULTED, BUT A LEVEL WITH ONE ANSWER ANSWERS ITSELF.
     *
     * Those are two rules and the difference between them is the whole point. Defaulting to the
     * FIRST of several reads as a suggestion, and on a race morning a suggestion nobody made is
     * how a boat sails yesterday's course — worse, "first" is whatever the map happened to
     * iterate: not the club's main race, not the nearest, not the most recent. So several
     * answers is a question, asked with an empty field.
     *
     * One answer is not a question at all. A club with a single series, a series running a
     * single race today, a race with a single division, a course with one published design: in
     * every case the field would open, show one line and close again having changed nothing,
     * and the button under it would have said "Choose a series" about a series nobody could
     * choose differently. It is the same rule the editor's template picker follows (`stageOf`)
     * and for the same reason — a hierarchy is worth having because it collapses to nothing
     * when there is nothing to choose.
     *
     * Settled here rather than in the markup, because the answer has to reach `this.boat`: the
     * join reads its course from there, and a level that merely LOOKED chosen would hand the
     * server nothing.
     *
     * The CLUB is remembered as well as settled — see `recall` — because it is a fact about the
     * boat rather than a decision about today. A remembered club that is no longer on offer
     * falls back to unchosen, since a `<select>` whose value matches no option shows blank.
     */
    const settle = (field, values, valueOf = (v) => v) => {
      if (!this.boat[field] && values.length === 1) this.boat[field] = valueOf(values[0]);
      return this.boat[field];
    };

    const clubs = [...new Set(this.courses.map((c) => c.club))];
    // Guarded on there BEING clubs: this screen is drawn before `/api/public` has answered, and
    // wiping a remembered club against an empty list would forget the boat for a moment.
    if (clubs.length && !clubs.includes(this.boat.club)) this.boat.club = null;
    const club = settle('club', clubs) ?? '';
    const series = club
      ? [...new Set(this.courses.filter((c) => c.club === club).map((c) => c.series))] : [];
    if (this.boat.series && !series.includes(this.boat.series)) this.boat.series = null;
    const chosenSeries = settle('series', series) ?? '';
    /*
     * A BOAT JOINS A RACE WHERE THERE IS ONE, and a course only where there is not.
     *
     * Joining the course and letting the server work out which race that is works only while
     * one division sails one course, and it leaves the boat unable to say which division it is
     * in — which is the gap `ask` exists for (§8.2). Naming the race and the division closes it
     * from the other end, and costs one selector.
     *
     * `NO_RACE` is a real answer rather than an absent one, which is why it is a value and not
     * the empty placeholder: *I am sailing this course with nobody running a race on it* is a
     * thing somebody means, and it is what this system did before there were committees.
     */
    const today = Device.today();
    const all = (this.races?.[`${club}/${chosenSeries}`] ?? []);
    const racesToday = all.filter((race) => race.date === today);
    /*
     * ONE RACE TODAY IS ONE ANSWER, and `NO_RACE` does not make it two.
     *
     * That option is not another race, it is opting out of the question — *there is nobody
     * running a race on this* — so counting it would mean a club running its one Saturday race
     * never got the benefit of the rule. It stays in the list, so a boat that wants to sail the
     * course without the committee still says so in one gesture.
     */
    settle('race', racesToday, (race) => race.id);
    const chosenRace = racesToday.find((r) => r.id === this.boat.race) ?? null;
    const courseOnly = this.boat.race === NO_RACE || racesToday.length === 0;

    // A race's divisions, each already naming what it sails — so choosing one chooses the
    // course and the variant, and the boat never picks geometry it was not entered for.
    const divisions = Object.entries(chosenRace?.divisions ?? {})
      .map(([name, division]) => ({ name, ...division }));
    // A one-division race is the ordinary club race, and asking which division a boat is in
    // when there is only one is asking somebody to agree with a fact.
    if (chosenRace) settle('division', divisions, (d) => d.name);
    const chosenDivision = divisions.find((d) => d.name === this.boat.division) ?? null;

    // What the race says this division sails, crossed with what is actually published: a
    // division naming a course nobody published is a race nobody can join, and saying so here
    // is better than a refusal after the button.
    const raceCourse = chosenDivision
      ? this.courses.find((c) => c.club === club && c.series === chosenSeries
        && c.course === chosenDivision.course) ?? null
      : null;
    const racePublished = raceCourse?.published?.find((p) => !chosenDivision.variant
      || p.variant === chosenDivision.variant) ?? null;

    const courses = chosenSeries && courseOnly
      ? this.courses.filter((c) => c.club === club && c.series === chosenSeries) : [];
    settle('course', courses, (c) => c.course);
    const chosenCourse = courses.find((c) => c.course === this.boat.course) ?? null;
    const variants = chosenCourse?.published ?? [];
    // The single published design is the one thing this course can hand over — which is exactly
    // what a race's division means by leaving its variant unsaid, decided here the same way.
    if (chosenCourse) settle('variant', variants, (v) => v.variant);
    const chosenVariant = variants.find((v) => v.variant === this.boat.variant) ?? null;
    const blocked = this.hooks.blocked?.() ?? null;

    const ready = !!(club && chosenSeries && !blocked
      && (courseOnly ? (chosenCourse && chosenVariant) : (chosenRace && chosenDivision
        && racePublished)));

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

        <h2>What you are sailing</h2>
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

          <!--
            THE RACE COMES FIRST WHERE THERE IS ONE. Joining a course and letting the server
            work out which race that is works only while one division sails one course, and it
            leaves the boat unable to say which division it is in. Naming the race and then the
            division settles both, and the course follows from the division rather than being
            picked again — a boat does not choose the geometry it was entered for.
          -->
          ${racesToday.length === 0 ? `${all.length && chosenSeries
            ? `<p class="muted" style="font-size:11.5px; margin-top:8px">This series has
                ${all.length} race${all.length === 1 ? '' : 's'} defined, none today
                (${esc(today)}) &mdash; so there is a course to sail and nobody running a race
                on it.</p>` : ''}` : `
            <label for="j_race">Race</label>
            <select id="j_race"${chosenSeries ? '' : ' disabled'}>${level([
              ...racesToday.map((r) => ({
                value: r.id,
                label: `${r.name ?? r.id}${r.format ? ` — ${r.format}` : ''}`,
              })),
              // A REAL ANSWER, not an absent one: "nobody is running a race on this" is a thing
              // somebody means, and it is what this system did before there were committees.
              { value: NO_RACE, label: 'No race — just sail a course' },
            ], this.boat.race, 'Choose a race', 'Choose a series first')}</select>
            ${chosenRace ? `
              <label for="j_division">Division</label>
              <select id="j_division">${level(divisions.map((d) => ({
                value: d.name,
                label: `${d.name} — ${d.course}${d.variant ? `/${d.variant}` : ''}`,
              })), chosenDivision?.name, 'Choose a division', 'This race has no divisions')}</select>
              ${chosenDivision && !racePublished ? `<p class="warn" style="font-size:11.5px">
                Nothing is published for ${esc(chosenDivision.course)}${chosenDivision.variant
                  ? `/${esc(chosenDivision.variant)}` : ''}, so this division has no course to
                hand you yet. The club publishes it from the editor.</p>` : ''}
              ${racePublished ? `<p class="muted mono" style="font-size:11px; margin-top:6px">
                ${esc(chosenDivision.course)}${chosenDivision.variant
                  ? `/${esc(chosenDivision.variant)}` : ''}
                &middot; revision ${esc(racePublished.revision)}
                &middot; ${racePublished.steps ?? '?'} marks</p>` : ''}` : ''}`}

          ${!courseOnly ? '' : `
            <label for="j_course">Course</label>
            <select id="j_course"${chosenSeries ? '' : ' disabled'}>${level(courses.map((c) =>
              ({ value: c.course, label: c.name && c.name !== c.course ? `${c.name} (${c.course})` : c.course })),
              chosenCourse?.course, 'Choose a course', 'Choose a series first')}</select>
            <label for="j_variant">Variant</label>
            <select id="j_variant"${chosenCourse ? '' : ' disabled'}>${level(variants.map((v) =>
              ({ value: v.variant, label: `${v.name ?? v.variant}${v.lengthNm == null ? '' : ` — ${v.lengthNm.toFixed(2)} nm`}${v.closed ? ', cycle' : ''}` })),
              chosenVariant?.variant, 'Choose a variant', 'Choose a course first')}</select>
            ${chosenVariant ? `<p class="muted mono" style="font-size:11px; margin-top:6px">
              revision ${esc(chosenVariant.revision)} &middot; ${chosenVariant.steps ?? '?'} marks</p>` : ''}`}

          <h2>How you are sailing</h2>
          <label for="j_mode">This counts as</label>
          <select id="j_mode">${options([
            { value: 'ANONYMOUS', label: 'Practice — kept for you, published to nobody' },
            { value: 'RACE', label: 'Race — goes to the club, which scores it' },
            { value: 'RECORD', label: 'Record attempt — stands against every other' },
          ], this.boat.mode)}</select>
          <div class="pair">
            <div><label for="j_tcf">TCF</label>
              <input id="j_tcf" value="${esc(this.boat.tcf)}"></div>
            <!--
              THE LENGTH IS ASKED FOR BECAUSE THE APPROACH PLOT DRAWS TO SCALE. The hull is
              drawn at its real size — that is how the picture says how close the line is
              without a number — and the closest the plot will ever zoom is measured in this
              boat's own lengths, since how much room there is at a start line is a question
              answered in boats rather than in metres. Ten metres until somebody says
              otherwise, which is what every boat was drawn as before there was a field.
            -->
            <div><label for="j_length">Length (m)</label>
              <input id="j_length" value="${esc(this.boat.lengthM)}" inputmode="decimal"></div>
          </div>
          <p class="muted" style="font-size:11px; margin-top:4px">
            The handicap is carried, not applied. Turning a TCF into a distance is
            <span class="mono">CLAUDE.md</span> open question 5 and is not answered yet, so no
            sub-line is being computed for you. The length is drawn and zoomed to, and goes on
            the record.</p>

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
                  : !courseOnly ? (!chosenRace ? 'Choose a race'
                    : !chosenDivision ? 'Choose a division'
                      : 'That division has no published course')
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
    keep('j_length', 'lengthM', true);
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
    redraw('club', 'series', 'race', 'division', 'course', 'variant');
    redraw('series', 'race', 'division', 'course', 'variant');
    // Choosing a race drops the division under it, and any course chosen while there was no
    // race to have one: the two paths are alternatives, not layers.
    redraw('race', 'division', 'course', 'variant');
    redraw('division');
    redraw('course', 'variant');
    redraw('variant');

    // Guarded as well as disabled: `disabled` is a property of a rendered button, and this
    // handler is the thing that would be asked to join a course nobody has finished choosing.
    this.el('j_go')?.addEventListener('click', () => {
      if (!ready) return;
      // A RACE JOIN NAMES THE RACE AND THE DIVISION; the course comes from the division rather
      // than from a second question, because it is not a second decision.
      if (courseOnly) {
        this.join(club, chosenSeries, chosenCourse.course, chosenVariant.variant);
      } else {
        this.join(club, chosenSeries, chosenDivision.course, chosenDivision.variant
          ?? racePublished.variant, { race: chosenRace.id, division: chosenDivision.name });
      }
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
  async join(club, series, course, variant, entered = {}) {
    this.message = null;
    if (!course || !variant) return;
    const request = {
      sailNo: this.boat.sail, name: this.boat.name, club, series, course, variant,
      tcf: Number(this.boat.tcf) > 0 ? Number(this.boat.tcf) : null,
      lengthM: Number(this.boat.lengthM) > 0 ? Number(this.boat.lengthM) : null,
      // NAMED where the sailor named them, absent where they did not. The server still finds a
      // race from the course and the day for a client that says nothing — which is what an
      // older client does, and §5 rule 1 is why that goes on working.
      ...(entered.race ? { race: entered.race } : {}),
      ...(entered.division ? { division: entered.division } : {}),
    };
    try {
      /*
       * OVER THE DIALOG, which is what §8.2 specifies — and the one message answers both
       * questions: it hands back the snapshot to sail AND says whether there is a race behind
       * it. A join with no race gets no channel, no fleet and no fixes, and the absence of
       * `fixSeconds` is how the boat is told.
       */
      const joined = await this.dialog.join(request);
      this.snapshot = joined.course;
      this.dialog.revision = joined.revision ?? this.snapshot?.revision ?? null;
      this.start();
      return;
    } catch (error) {
      this.message = `Could not join: ${error.message}`;
    }
    /*
     * AND IF THERE IS NO CONVERSATION TO BE HAD, SAIL ANYWAY.
     *
     * The REST join is the "query and sail" path (§8.2) and it is what a server too old to
     * hold a dialog offers. Falling back to it is the whole architecture in one gesture: the
     * conversation is the optional half, so failing to have one must cost the channel and
     * nothing else. The message above stays on the screen, because a boat sailing without a
     * committee should know that is what it is doing.
     */
    try {
      const response = await fetch(
        `/api/join/${encodeURIComponent(club)}/${encodeURIComponent(series)}/${encodeURIComponent(course)}`
        + `?variant=${encodeURIComponent(variant)}`, { method: 'POST' });
      if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
      this.snapshot = await response.json();
      this.message = `${this.message} — sailing the course with no race behind it.`;
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

    /*
     * AND THEN TELL THE FLEET — which is a side effect of the fix having been accepted, never a
     * step on the way to accepting it. Ordered deliberately: the client has already decided
     * everything that matters by the time anything is queued for the server, so a dialog that
     * throws, blocks or is simply absent cannot reach the decision.
     *
     * Only ACCEPTED fixes are reported. A fix the quality gate refused is not a position, and
     * putting one on a fleet screen would draw a boat where it never was.
     */
    if (verdict.accepted && !verdict.relocated) this.dialog.report(fix);
    if (verdict.latched) {
      const step = verdict.step;
      this.dialog.crossing(verdict.latched, {
        step: step?.index,
        lap: this.client.lap,
        letter: step?.letter,
        finish: this.client.finished,
        revision: this.client.snapshot?.revision,
        confirmFixes: this.client.confirmFixes,
      });
      // THE ARTEFACT, once there is one. The live crossings were advisory; this is the file a
      // protest could be argued from, and it is posted the moment the course is complete rather
      // than being left for somebody to remember (§8.3).
      if (this.client.finished) this.dialog.record(this.client.record?.() ?? null);
    }
    this.render();
    return verdict;
  }
}
