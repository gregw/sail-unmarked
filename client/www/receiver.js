/**
 * THE RECEIVER ON THE WATER — `navigator.geolocation` turned into the one thing that crosses
 * the seam.
 *
 * `boatsim.js` is the other side of this: a simulated boat and a receiver that lies, for the
 * desk. This is the real one, for a phone. They have nothing in common except their output,
 * and that is the whole architecture — a position, a time, a stated accuracy, a satellite
 * count, SOG and COG, which is all either of them may hand over. Nothing in `raceclient.js`,
 * `markscreen.js` or `crossing.js` knows which of the two it is being fed by, and
 * `boatsim-test.js` pins the key set so neither can grow one convenient extra field.
 *
 * <h2>Two things the web API does not give, and what is done about each</h2>
 * <b>Satellite count: nothing.</b> The Geolocation API does not report one and there is no way
 * to find out, so the fix says `null` and the screens print an em dash. Inventing a plausible
 * number would put a lie in the one place a sailor looks to decide whether to trust the rest
 * of the screen. The quality-control gate already treats a missing count as "no evidence
 * either way" rather than as a failure, so a phone is judged on its stated accuracy alone.
 *
 * <b>Speed and heading: DERIVED, and only when they can be.</b> `coords.speed` and
 * `coords.heading` are populated by a phone's GNSS while it is moving and are `null` on a
 * laptop, on a phone getting its position from wifi, and on most devices while stationary. TTL
 * is distance over speed and the boat is drawn pointing along its course, so a client with
 * neither has no approach screen worth the name. Deriving them from consecutive positions is
 * what a plotter does, and it belongs HERE rather than in the client: this file is the
 * receiver, and a receiver is the thing that is allowed to know how its own numbers were
 * arrived at.
 *
 * The derivation refuses in the two cases where it would be making things up:
 *
 * <ul>
 * <li><b>Movement inside the stated accuracy is not movement.</b> Two fixes five metres apart
 *     from a receiver claiming five metres are one position reported twice, and dividing that
 *     by a second gives ten knots for a boat tied to a mooring — a number that would run the
 *     TTL countdown on nothing at all. Below the accuracy the speed reads ZERO and the heading
 *     is HELD, which is what a plotter shows and what is true: we cannot see it moving.
 * <li><b>A long gap derives nothing</b> (`MAX_GAP_S`). A phone that was in a pocket for half a
 *     minute and comes back two hundred metres away may have sailed there or may have sat
 *     still for twenty-five seconds and then moved; the average over the gap is not a speed
 *     anybody is making. The client's own relocation watch is what handles the position side of
 *     that, and it is better served by an honest zero than by a plausible fiction.
 * </ul>
 */

import { toLocal } from './crossing.js';

/**
 * What is asked of the browser.
 *
 * `enableHighAccuracy` is the difference between GNSS and a wifi lookup, so it is not
 * optional here — a course is sailed to the metre. `maximumAge: 0` refuses a cached position:
 * this is a moving boat and a fix from thirty seconds ago is not a fix, it is a memory. The
 * timeout is generous because a cold GNSS start under a rig really does take that long, and a
 * timeout that fires first turns a normal acquisition into an error message.
 */
export const GEO_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 27000 };

/** Beyond this gap between fixes, speed and heading are not derived. See the header. */
export const MAX_GAP_S = 10;

/** Below this gap, two fixes are the same instant as far as a difference is concerned. */
export const MIN_GAP_S = 0.15;

const KN_PER_MS = 1.9438444924406046;

/** What each of the API's three failures means, said in a sentence a sailor can act on. */
export const TROUBLE = {
  1: 'Location permission was refused. The course cannot be sailed without it — '
    + 'allow location for this site and reload.',
  2: 'No position available. Under cover, or the receiver has not found the sky yet.',
  3: 'Taking too long to get a fix. Still trying.',
};

/**
 * One `GeolocationPosition` as a fix, using the previous fix for what the API left out.
 *
 * Pure, and exported on purpose: this is the whole of the translation between the browser and
 * everything that decides a race, so it is the piece that has to be pinned rather than
 * demonstrated. `previous` is the last fix this produced — not the last one the client
 * ACCEPTED, because a receiver does not know which of its readings were believed.
 */
export function fixFrom(position, previous = null) {
  const coords = position?.coords ?? {};
  const time = new Date(Number.isFinite(position?.timestamp) ? position.timestamp : Date.now());

  // Floored at a metre, exactly as the simulator floors it, and for the same reason: a
  // receiver claiming 0.0 m is not a thing that happens, and a zero band would let a boat
  // sitting on a line resolve to a side on noise. Absent rather than guessed if the browser
  // says nothing — the API requires this field, so this is defence rather than a real case.
  const accuracyM = Number.isFinite(coords.accuracy)
    ? Math.max(1, Math.round(coords.accuracy)) : null;

  const fix = {
    latitude: coords.latitude,
    longitude: coords.longitude,
    time,
    accuracyM,
    // The web API does not report it, and a number here would be a lie told in the one place
    // somebody looks to decide whether to trust the screen.
    satellites: null,
    sogKn: Number.isFinite(coords.speed) ? coords.speed * KN_PER_MS : null,
    cogDeg: Number.isFinite(coords.heading) ? coords.heading : null,
  };

  if (fix.sogKn != null && fix.cogDeg != null) return fix;

  const derived = derive(fix, previous);
  fix.sogKn ??= derived.sogKn;
  // Held rather than defaulted to north: a boat that has stopped is still pointing the way it
  // was pointing, and snapping the drawn hull — and with it a COG-up display — to north the
  // moment a receiver stops reporting a heading is the opposite of what is true.
  fix.cogDeg ??= derived.cogDeg ?? previous?.cogDeg ?? null;
  return fix;
}

/** Speed and course over the ground between two fixes, where that can honestly be read. */
function derive(fix, previous) {
  if (!previous?.time || !Number.isFinite(fix.latitude)) return { sogKn: null, cogDeg: null };

  // A STATED ZERO IS A READING, not an absence, and it settles the heading too. iOS reports
  // `speed: 0` with a null heading while stationary, and a position that still moves a little
  // because the fix is wandering. Deriving a course out of that displacement would be arguing
  // with the receiver about whether the boat is moving, and losing: the receiver knows.
  if (fix.sogKn === 0) return { sogKn: null, cogDeg: null };

  const seconds = (fix.time - previous.time) / 1000;
  if (!(seconds > MIN_GAP_S) || seconds > MAX_GAP_S) return { sogKn: null, cogDeg: null };

  const step = toLocal(previous, fix);
  const metres = Math.hypot(step.x, step.y);

  // The threshold is the receiver's OWN stated accuracy, which is the same reasoning the
  // kinematic gate rests on one level up: what the boat could have done plus what the
  // receiver could have made up. Inside it there is nothing to see, so nothing is claimed.
  if (metres <= (fix.accuracyM ?? 0)) return { sogKn: 0, cogDeg: null };

  return {
    sogKn: (metres / seconds) * KN_PER_MS,
    cogDeg: (((Math.atan2(step.x, step.y) * 180) / Math.PI) + 360) % 360,
  };
}

/**
 * A running watch on the device's position, handing out fixes.
 *
 * Wrapped in a class for one reason: the previous fix has to be remembered somewhere for the
 * derivation above, and a page-level variable for it is a page-level variable the next page
 * would have to remember to keep.
 *
 * <b>Started by a gesture, never on load.</b> A permission prompt that appears before anything
 * on screen has said why it is wanted is a prompt people refuse, and a refusal is sticky — the
 * browser remembers it and the only way back is through settings most people will not find. So
 * the page explains itself and the sailor presses the button.
 */
export class Receiver {
  constructor({ geolocation, options } = {}) {
    this.geolocation = geolocation ?? globalThis.navigator?.geolocation ?? null;
    this.options = options ?? GEO_OPTIONS;
    this.watch = null;
    this.last = null;        // the last fix produced, for the derivation
    this.count = 0;
    this.trouble = null;     // the last error, as a sentence
  }

  /** Is there anything to ask? A page has to be able to say so rather than silently fail. */
  get available() {
    return !!this.geolocation?.watchPosition;
  }

  get running() {
    return this.watch != null;
  }

  /**
   * Start watching. `onFix` gets every fix; `onTrouble` gets a sentence and the raw error.
   *
   * Errors are NOT fatal and the watch is not stopped by one — a `POSITION_UNAVAILABLE` under
   * a bridge is followed by a good fix on the other side, and a watch torn down on the first
   * failure would be a client that gives up at the one moment it matters. Only a refused
   * permission is final, and that is the caller's to act on.
   */
  start(onFix, onTrouble) {
    if (!this.available || this.running) return this.running;
    this.watch = this.geolocation.watchPosition(
      (position) => {
        const fix = fixFrom(position, this.last);
        this.last = fix;
        this.count += 1;
        this.trouble = null;
        onFix?.(fix);
      },
      (error) => {
        this.trouble = TROUBLE[error?.code] ?? error?.message ?? 'The receiver stopped reporting.';
        onTrouble?.(this.trouble, error);
      },
      this.options,
    );
    return true;
  }

  stop() {
    if (this.watch != null) this.geolocation?.clearWatch?.(this.watch);
    this.watch = null;
  }
}

/**
 * Keep the screen awake while a course is being sailed, if the browser will.
 *
 * A phone that dims and sleeps stops being a navigation instrument, and on a boat nobody is
 * going to keep tapping it. Best effort by necessity: the Screen Wake Lock API is not
 * everywhere, it is refused when the page is not visible, and it is DROPPED whenever the page
 * is hidden — so it is re-taken on `visibilitychange` rather than assumed to have survived.
 * Nothing here is allowed to throw: a page that failed to open because it could not dim-proof
 * itself would be a poor trade.
 */
export class Awake {
  constructor() {
    this.lock = null;
    this.wanted = false;
    this.listening = false;
  }

  get held() {
    return !!this.lock;
  }

  async want(wanted) {
    this.wanted = wanted;
    if (!wanted) {
      const held = this.lock;
      this.lock = null;
      try { await held?.release?.(); } catch { /* already gone */ }
      return false;
    }
    if (!this.listening && globalThis.document?.addEventListener) {
      this.listening = true;
      document.addEventListener('visibilitychange', () => {
        if (this.wanted && document.visibilityState === 'visible') this.take();
      });
    }
    return this.take();
  }

  async take() {
    if (this.lock || !globalThis.navigator?.wakeLock?.request) return false;
    try {
      this.lock = await navigator.wakeLock.request('screen');
      this.lock.addEventListener?.('release', () => { this.lock = null; });
      return true;
    } catch {
      // Not supported, refused, or the page is hidden. All ordinary, none worth a message.
      return false;
    }
  }
}
