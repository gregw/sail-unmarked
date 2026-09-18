/**
 * THE REAL CLIENT — the device, on a phone, fed by the phone.
 *
 * This is `client.js` with the whole left-hand side of it deleted. No chart to steer on, no
 * knobs, no simulated boat, no true track to compare against: the boat is wherever the phone
 * is, and the only thing this file does is turn `navigator.geolocation` into fixes and hand
 * them over. Everything the sailor looks at is the same {@link Device} the rig runs — the join
 * screen, the course overview, the Mark screen, the selectors — imported rather than copied,
 * so what is tested on the desk is what is sailed.
 *
 * <h2>The seam, from the other side</h2>
 * `emit()` in `client.js` reads a fix off `boatsim.js`; this page reads one off `receiver.js`.
 * Both then call `device.feed(fix)` and neither says anything else. That is the claim the
 * architecture rests on, and it is worth noticing what it bought: putting the client on a real
 * phone took a receiver and a page, and changed nothing in `crossing.js`, `raceclient.js`,
 * `markscreen.js` or `device.js` — the four files that decide a race.
 *
 * <h2>Three things a real phone needs that a desk does not</h2>
 * <ul>
 * <li><b>A permission asked for at the right moment.</b> The watch is started by a button on
 *     the join screen, under a sentence saying what it is for. A prompt on load, before
 *     anything has explained itself, is a prompt people refuse — and a refusal is sticky in a
 *     way that takes somebody into browser settings to undo.
 * <li><b>The screen kept awake.</b> A phone that dims and sleeps is not a navigation
 *     instrument, and nobody is going to keep tapping it on a beat. Best effort, because the
 *     API is not everywhere and is dropped whenever the page is hidden.
 * <li><b>A heartbeat.</b> The device redraws on every fix, which is right — nothing changes
 *     between fixes. But when the fixes STOP, something does change and it is the most
 *     important thing on the screen: the readouts are stale and the signal line has to say so
 *     and count. A screen that only redraws on a fix cannot report the absence of one.
 * </ul>
 */

import { Awake, Receiver } from './receiver.js';
import { Device } from './device.js';
import { esc } from './markscreen.js';

const el = (id) => document.getElementById(id);

/** How often the screen is redrawn with no fix to prompt it. See the heartbeat, above. */
const HEARTBEAT_MS = 1000;

const receiver = new Receiver();
const awake = new Awake();

const state = {
  // idle → the permission has not been asked for; waiting → asked, nothing back yet;
  // live → at least one fix; trouble → the receiver said no, and what it said.
  gnss: receiver.available ? 'idle' : 'absent',
  said: null,
};

/* =========================================================== what the receiver says */

/**
 * The receiver's own line on the join screen.
 *
 * Split in two on purpose: the panel's SHAPE changes only when the state does, and the live
 * reading changes on every fix. Re-rendering the join screen at a fix a second would take the
 * caret out of whatever somebody is typing into their sail number — the same hazard the
 * background selector had on the overview, met the same way.
 */
function gnssPanel() {
  return `<div class="gnss ${state.gnss}" id="gnss">
    <h3>This device's position</h3>
    <div class="said">${esc(saying())}</div>
    <div class="fix" id="gnss_fix">${reading()}</div>
    ${state.gnss === 'idle'
      ? '<button class="plain" id="gnss_start">Use my location</button>' : ''}
  </div>
  <!--
    The one link off this page, and it is on the join screen only: once a course is taken the
    screens are being read at a glance from a cockpit, and a navigation link there is both
    clutter and a way to lose a race by a mis-tap.
  -->
  <p class="muted" style="font-size:11px; margin-top:8px">
    <a href="index.html">Courses and publication log</a> &middot;
    <a href="client.html">test rig</a>
  </p>`;
}

function saying() {
  if (state.gnss === 'absent') {
    return 'This browser will not give a position, so there is nothing to sail with. '
      + 'A phone is what this page is for.';
  }
  if (state.gnss === 'trouble') return state.said ?? 'The receiver stopped reporting.';
  if (state.gnss === 'waiting') return 'Looking for satellites. A cold start under a rig can take '
    + 'half a minute; the rest of the form can be filled in meanwhile.';
  if (state.gnss === 'live') {
    return 'Reporting. Every crossing and every instant on this course will come from this '
      + 'device and no other.';
  }
  return 'Your crossings are detected and timed on this phone, from its own GNSS, with no '
    + 'network. Nothing else can do it: a course is sailed to the metre.';
}

/** The live half — the last fix, in the terms that decide whether to trust it. */
function reading() {
  const fix = receiver.last;
  if (!fix) return '';
  const age = Math.round((Date.now() - fix.time) / 1000);
  return esc([
    `${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}`,
    `±${fix.accuracyM ?? '—'} m`,
    `${age <= 1 ? 'now' : `${age} s ago`}`,
    receiver.count > 1 ? `${receiver.count} fixes` : null,
  ].filter(Boolean).join('  ·  '));
}

/** Update the live half in place, and the shape only if the state moved under it. */
function refreshGnss(shapeChanged = false) {
  if (device.client) return;                       // the device says all this itself once sailing
  if (shapeChanged || !el('gnss')) return device.renderJoin();
  const fix = el('gnss_fix');
  if (fix) fix.innerHTML = reading();
  const panel = el('gnss');
  if (panel) panel.className = `gnss ${state.gnss}`;
  return undefined;
}

function startReceiver() {
  if (!receiver.available) return;
  state.gnss = 'waiting';
  state.said = null;
  refreshGnss(true);
  receiver.start(onFix, (said) => {
    // NOT fatal, and the watch is not torn down: a position lost under a bridge comes back on
    // the other side. Only a refused permission is the end of it, and that is what the
    // sentence says.
    const was = state.gnss;
    state.gnss = 'trouble';
    state.said = said;
    refreshGnss(was !== 'trouble');
  });
}

/* ======================================================================== the seam */

/**
 * ONE FIX, from the phone's receiver to the client. Nothing else crosses.
 *
 * The same two lines as `emit()` in `client.js`, with a real receiver where the simulator was.
 * The verdict is not shown: on a phone there is no room for a trail of decisions and no use
 * for one — what a sailor needs to know about a refused fix is already on the screen, as
 * dashed readouts and the signal line saying how many went in the bin and why.
 */
function onFix(fix) {
  const first = state.gnss !== 'live';
  state.gnss = 'live';
  state.said = null;
  device.feed(fix);
  refreshGnss(first);
}

/* ============================================================== leaving by accident */

/**
 * THE BACK GESTURE, AND WHY IT HAS TO BE INTERCEPTED.
 *
 * On a phone the back gesture is an edge swipe or a button a thumb rests on, and this page is
 * held in a bracket and tapped in a hurry. Leaving is not a small cost: <b>nothing is cached
 * across a reload</b>, so a boat that backs out mid-race comes back to the join screen with the
 * course, the crossings so far and the running clock all gone. That is the one action on this
 * page that is both easy to do by accident and impossible to undo.
 *
 * <b>Two mechanisms, because one gesture is not the only way out.</b> `beforeunload` covers a
 * reload, a closed tab and a typed address, and is the browser's own dialog — we do not get to
 * word it. The back gesture is not an unload at all within one document, so it is caught as a
 * `popstate` against a sentinel entry pushed when the boat joins: the entry is pushed again
 * immediately, which puts the history back where it was, and the question is asked in the
 * page's own words.
 *
 * <b>Only while sailing.</b> On the join screen there is nothing to lose, and a page that
 * argued about being left would be one people close for good. So the guard is armed by
 * `onJoin` and disarmed by `onLeave` — the same two hooks the wake lock uses, for the same
 * reason: they are the moments the page's promises change.
 */
class LeaveGuard {
  constructor(host) {
    this.host = host;
    this.armed = false;
    window.addEventListener('beforeunload', (event) => {
      if (!this.armed) return undefined;
      // The only two lines a browser honours. The text is the browser's; ours is in the modal.
      event.preventDefault();
      event.returnValue = '';
      return '';
    });
    window.addEventListener('popstate', () => {
      if (!this.armed) return;
      // Put the sentinel back BEFORE asking. The browser has already moved off it, so without
      // this a second back gesture while the question is up would leave with no question at
      // all — which is exactly the accident being guarded against.
      this.push();
      this.ask(true);
    });
    // Shut to begin with, said here as well as in the markup: the page declares it `hidden`,
    // and a guard that only ever opened it would depend on that attribute never being lost.
    this.ask(false);
    el('leave_stay')?.addEventListener('click', () => this.ask(false));
    el('leave_go')?.addEventListener('click', () => {
      this.ask(false);
      this.armed = false;
      // Past the sentinel AND past this page's own entry, which is where the gesture was
      // trying to go. With nothing behind this page — opened from a link or typed in — there
      // is nowhere to send them and the browser does nothing, which is the honest outcome:
      // the question is answered and the boat is still racing.
      window.history.go(-2);
    });
  }

  push() {
    window.history.pushState({ unmarked: 'racing' }, '');
  }

  arm(on) {
    if (on === this.armed) return;
    this.armed = on;
    if (on) this.push();
    else this.ask(false);
  }

  ask(show) {
    if (this.host) this.host.hidden = !show;
  }
}

const leaving = new LeaveGuard(el('leaving'));

/* ====================================================================== the device */

const device = new Device(el('device'), {
  kicker: 'Unmarked Racing',
  note: gnssPanel,
  wireNote: () => el('gnss_start')?.addEventListener('click', startReceiver),
  /*
   * A COURSE IS NOT TAKEN UNTIL THE PHONE HAS PROVED IT CAN SEE THE SKY.
   *
   * The join screen is where somebody is standing still with both hands free, which is the
   * one moment a permission prompt or a receiver that cannot get a fix can be dealt with.
   * Finding out on the start line that location was refused is the same problem an hour later
   * and with nothing that can be done about it. It is named in the button rather than left as
   * a grey rectangle, which is the rule the rest of that form already follows.
   */
  blocked: () => {
    if (state.gnss === 'live') return null;
    if (state.gnss === 'absent') return 'No position from this browser';
    if (state.gnss === 'trouble') return 'Sort the receiver out first';
    return state.gnss === 'waiting' ? 'Waiting for the first fix' : 'Allow location first';
  },
  onJoin: () => {
    // Asked for on joining rather than on load, because this is the first moment the answer
    // is yes for a reason the browser will accept: a wake lock is refused unless the page is
    // visible, and it is granted off the back of somebody pressing something.
    awake.want(true);
    leaving.arm(true);
  },
  onLeave: () => {
    awake.want(false);
    leaving.arm(false);
    // The watch is left running. The permission is already given and a boat that has just
    // finished one course usually starts another; tearing the watch down would mean a cold
    // start over again the second time.
  },
  /*
   * The wake lock is shown because it is a promise the page cannot always keep — the API is
   * missing on some browsers and refused on others — and a screen that quietly slept would
   * look like the app crashing. It is a button as well as an indicator, so somebody who wants
   * the phone to sleep in their pocket can say so.
   */
  extras: () => `<button class="plain awake${awake.held ? ' on' : ''}" id="awake">`
    + `${awake.held ? 'Screen stays on' : 'Let screen sleep'}</button>`,
  wireExtras: () => {
    el('awake')?.addEventListener('click', async () => {
      await awake.want(!awake.wanted);
      device.render();
    });
  },
});

/* ========================================================================== start */

await device.load();
device.renderJoin();

/*
 * The displays SWING rather than snap, and the swing is driven by the clock rather than by the
 * receiver: at one fix a second a ninety-degree turn would arrive in six visible jerks instead
 * of turning. So while one is in progress, and only then, the device is drawn on the animation
 * frame like anything else that moves.
 */
function frame() {
  if (device.turning()) device.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/*
 * THE HEARTBEAT. The device redraws on every fix, which is right — but the one state it must
 * report and cannot be prompted into reporting is the ABSENCE of fixes: the readouts go dashed
 * and the signal line says how long it has been and how many went in the bin. A screen that
 * only redrew on a fix could never say that. It also counts the elapsed clock up between
 * fixes, which would otherwise tick only when the receiver felt like it.
 */
setInterval(() => {
  if (device.client) device.render();
  else if (receiver.last) refreshGnss();
}, HEARTBEAT_MS);

/** Exposed for the headless driver only; nothing in the page reads it. */
export const __boat = { device, receiver, awake, state, leaving };
