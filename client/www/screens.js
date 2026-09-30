/**
 * WHAT THE DIALOG ADDS TO THE BOAT'S SCREENS — the start row, the channel, race progress, and
 * the alerts. Section numbers (§) are `wiki/client-server-dialog.md`'s.
 *
 * Kept out of `markscreen.js` because that file is about one thing: the approach plot and the
 * course overview, which are the screens a boat sails by and which work with the server
 * switched off. Everything here needs a channel behind it, and a screen with nothing behind it
 * is not offered at all (§8.2) — so the split in the files is the same split the view selector
 * makes.
 *
 * Markup only, and every one of these takes a plain object rather than the {@link Dialog}
 * itself where it can, for the same reason `markScreen` takes a state: a screen that can be
 * rendered without a conversation can be tested without one.
 */

import { CANNED, ladder } from './dialog.js';
import { BASEMAP_INK, basemapArt, esc, hhmmss, LINE_STATE_COLOUR } from './markscreen.js';
import { toLocal } from './crossing.js';

/** mm:ss, or -mm:ss once a start has gone. A countdown is the one clock read as a duration. */
export function clock(seconds) {
  if (seconds == null) return '—';
  const sign = seconds < 0 ? '-' : '';
  const whole = Math.abs(Math.round(seconds));
  const mm = Math.floor(whole / 60);
  const ss = whole % 60;
  return `${sign}${mm}:${String(ss).padStart(2, '0')}`;
}

/**
 * THE START, at the top of every screen while there is one to count to.
 *
 * <b>Above the screen rather than on one of them</b>, because it is the one thing on this device
 * that is about a moment rather than about a place — and in the five minutes it matters it is
 * the only thing anybody is looking at. A countdown a sailor has to change screens to see is a
 * countdown they will miss.
 *
 * <b>The clock is the BOAT's.</b> The server published an instant and two durations and does not
 * tick (§8.4), so this row is arithmetic against this phone's clock. That costs nothing that
 * matters: what a race is decided on is a difference between two readings of one clock.
 *
 * The colours carry the state, which is the same rule the next-leg arrow follows: green once
 * racing, amber inside the warning, red postponed or abandoned.
 */
export function startRow(dialog, now = Date.now(), client = null) {
  if (!dialog?.live) return '';
  // OCS FIRST, because it is the one thing the boat has to act on: over the line before it opened
  // (or after it closed), nothing registered, and it has to go back and cross again.
  const ocs = client?.ocs && !client.startAt
    ? `<div class="start ocs"><span class="what">OCS</span><span class="said">${client.ocs.why === 'closed'
      ? 'Crossed after the line closed &mdash; it did not count.'
      : 'Over before the line opened &mdash; go back and cross again.'}</span></div>` : '';
  const state = dialog.state(now);
  const held = dialog.held();
  if (state === 'postponed' || state === 'abandoned') {
    return `<div class="start ${state}">
      <span class="what">${state === 'postponed' ? 'AP &mdash; postponed' : 'Abandoned'}</span>
      <span class="said">${esc(held?.flag?.body?.text ?? '')}</span>
    </div>`;
  }
  const plan = dialog.startPlan();
  if (!plan) {
    return held?.timer?.body?.kind === 'allocated'
      ? '<div class="start"><span class="what">Allocated start</span><span class="said">No start time given for this boat.</span></div>'
      : ocs;
  }
  const hm = (ms) => hhmmss(ms).slice(0, 5);
  const inSeconds = (ms) => clock(Math.round((ms - now) / 1000));
  /*
   * AN OPEN START SAYS WHEN THE LINE OPENS, FOR HOW LONG, AND THEN WHEN IT CLOSES — the closing
   * time is the whole of how that start works. A scratch or allocated start is presented the
   * traditional way, as a countdown to the start, and leaves the closing time out, where sailing
   * instructions normally bury it.
   */
  if (plan.kind === 'open') {
    if (now < plan.startAt) {
      const cls = now >= plan.prepAt ? 'prep' : 'warning';
      return ocs + `<div class="start ${now >= plan.warningAt ? cls : ''}">
        <span class="what">Line opens at ${esc(hm(plan.startAt))}</span>
        <span class="value">${esc(inSeconds(plan.startAt))}</span>
        <span class="said">${plan.closesAt ? `Open for ${esc(clock(Math.round((plan.closesAt - plan.startAt) / 1000)))}` : ''}</span>
      </div>`;
    }
    if (plan.closesAt == null || now <= plan.closesAt) {
      return ocs + `<div class="start racing">
        <span class="what">${plan.closesAt ? `Line closes at ${esc(hm(plan.closesAt))}` : 'Line open'}</span>
        <span class="value">${plan.closesAt ? esc(inSeconds(plan.closesAt)) : ''}</span>
        <span class="said">The line is open: start when you cross it.</span>
      </div>`;
    }
    return ocs + `<div class="start closed"><span class="what">Line closed at ${esc(hm(plan.closesAt))}</span></div>`;
  }
  const racing = now >= plan.startAt;
  const cls = racing ? 'racing' : now >= plan.prepAt ? 'prep' : now >= plan.warningAt ? 'warning' : '';
  return ocs + `<div class="start ${cls}">
    <span class="what">${racing ? `Started ${esc(hm(plan.startAt))}` : `Start ${esc(hm(plan.startAt))} in`}</span>
    <span class="value">${esc(racing ? '' : inSeconds(plan.startAt))}</span>
    <span class="said">${esc(plan.kind === 'allocated' ? 'Your allocated start' : held?.timer?.body?.text ?? '')}</span>
  </div>`;
}

/**
 * THE CHANNEL — one inbox for everything the boat was told (§9.2).
 *
 * Committee messages, chat relayed from other boats, and the state messages too: one inbox, one
 * acknowledgement mechanism, one backlog, one unread count. A boat that joins late reads
 * *postponed at 13:02 · course changed at 13:20 · "shortening at the windward mark" at 13:25*
 * as one story, which is also precisely what somebody reconstructing the afternoon wants.
 *
 * <b>Newest LAST</b>, like every other log people read on the water, with the view scrolled to
 * the bottom by the page. Unacknowledged entries are marked, because whether a boat saw a course
 * change is a thing a protest could turn on.
 */
export function chatPanel(dialog, options = {}) {
  const now = options.now ?? Date.now();
  const entries = dialog.channel;
  return `
    <div class="bar">
      <span class="mono">${esc(hhmmss(now))}</span>
      <span class="sp"></span>
      <strong class="disp">CHANNEL</strong>
      <span class="mono ${dialog.connected ? 'muted' : 'warn'}">${dialog.connected
        ? `${entries.length}` : 'offline'}</span>
    </div>
    ${options.bars ?? ''}
    <div class="log" id="chatLog">
      ${entries.length === 0
        ? '<p class="muted" style="padding:8px 12px">Nothing said yet.</p>'
        : entries.map((entry) => `
          <div class="said ${entry.safety ? 'safety' : ''} ${entry.needsAck
            && !dialog.acked.has(entry.id) ? 'unseen' : ''}">
            <div class="who">
              <span class="mono">${esc(hhmmss(Date.parse(entry.at)))}</span>
              <span class="from">${esc(entry.from)}</span>
              ${entry.type === 'say' ? '' : `<span class="kind mono">${esc(entry.type)}</span>`}
              ${entry.needsAck && !dialog.acked.has(entry.id)
                ? '<span class="badge">unseen</span>' : ''}
            </div>
            <div class="text">${esc(entry.text || '(no words)')}</div>
          </div>`).join('')}
    </div>
    <!--
      TYPING AT A TILLER IS HOSTILE, so the things a sailor actually says are one tap. The
      safety three are set apart because they are not racing messages and must not look like
      racing messages — the channel is the radio, and this is what a radio is for when the
      racing stops mattering.
    -->
    <div class="canned">
      ${CANNED.racing.map((what) =>
        `<button class="plain" data-say="${esc(what)}">${esc(what)}</button>`).join('')}
    </div>
    <div class="canned safety">
      ${CANNED.safety.map((what) =>
        `<button class="plain" data-say="${esc(what)}">${esc(what)}</button>`).join('')}
    </div>
    <div class="compose">
      <input id="sayText" placeholder="Say something to the fleet" autocomplete="off">
      <button class="plain" id="sayGo">Send</button>
    </div>`;
}

/**
 * RACE PROGRESS — the Place screen, fed by `fleet` (§9.1).
 *
 * A ranked table standing in for the brief's Live place (§5), which draws every boat along the
 * course at the moment its corrected time equals yours; that picture is not built.
 *
 * <b>It ages rather than blanks, and says how old it is.</b> The brief specifies that for
 * exactly this reason: live standings are the one thing boats want promptly from the server and
 * therefore the one thing that cannot be had without it. A screen that went empty would be
 * saying the fleet had vanished.
 *
 * <b>And it is never automatic</b> (§9.5). It is somewhere you go to look, not something that
 * should arrive — and it is the screen whose data is most likely to be stale.
 */
export function placePanel(dialog, options = {}) {
  const now = options.now ?? Date.now();
  const mine = options.division ?? false;
  const rows = ladder(dialog.fleet, { tags: mine ? dialog.tags : null, now });
  const age = dialog.fleetAt == null ? null : Math.round((now - dialog.fleetAt) / 1000);
  return `
    <div class="bar">
      <span class="mono">${esc(hhmmss(now))}</span>
      <span class="sp"></span>
      <strong class="disp">PLACE</strong>
      <span class="mono ${age != null && age < 15 ? 'muted' : 'warn'}">${age == null
        ? 'no fleet yet' : `${age} s ago`}</span>
    </div>
    ${options.bars ?? ''}
    <div class="orient">
      <button data-place="all" class="${mine ? '' : 'on'}">Whole fleet</button>
      <button data-place="mine" class="${mine ? 'on' : ''}">My division</button>
    </div>
    ${rows.length === 0 ? '<p class="muted" style="padding:10px 12px">Nobody is reporting yet. '
      + 'This screen is fed by the fleet feed, so it needs the server — and says so rather than '
      + 'going blank.</p>' : `
    <table class="ladder">
      <tr><th></th><th>Boat</th><th>Mark</th><th>Elapsed</th><th>Corrected</th></tr>
      ${rows.map((row) => `
        <tr class="${row.boatId === dialog.boatId ? 'me' : ''} ${row.ageMs != null
          && row.ageMs > 30000 ? 'stale' : ''}">
          <td class="mono place">${row.finishedAt ? row.place : row.place}</td>
          <td>${esc(row.sailNo ?? row.name ?? row.boatId ?? '?')}
            ${row.outcome && row.outcome !== 'racing'
              ? `<span class="mono muted">${esc(row.outcome)}</span>` : ''}</td>
          <td class="mono">${row.step == null ? '—' : row.step + (row.lap > 1
            ? `&middot;${row.lap}` : '')}</td>
          <td class="mono">${esc(duration(row.elapsedMs))}</td>
          <td class="mono">${row.correctedMs == null
            ? '<span class="muted">no TCF</span>' : esc(duration(row.correctedMs))}</td>
        </tr>`).join('')}
    </table>`}
    <p class="status">A view, not a result. Every figure here is arithmetic over what boats
      said about themselves; the club's software is what turns a time into a place.</p>`;
}

/** h:mm:ss from milliseconds, or an em dash. */
export function duration(ms) {
  if (ms == null) return '—';
  const whole = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * THE ALERT — a course change or a flag, which changes what the boat is doing.
 *
 * <b>Dismissing it IS the acknowledgement</b> the server is waiting for (§9.3). One gesture, not
 * two: a dialog with *Dismiss* and a separate *Acknowledge* would be asking somebody at a tiller
 * to agree that they had read something they had just closed.
 */
export function alertModal(entry) {
  if (!entry) return '';
  return `<div class="alert" id="alertBox">
    <div class="box">
      <div class="kind mono">${esc(entry.type === 'course' ? 'COURSE CHANGE'
        : entry.type === 'flag' ? 'FLAG' : entry.type.toUpperCase())}</div>
      <div class="text">${esc(entry.text || '(no words)')}</div>
      <div class="when mono">${esc(entry.from)} &middot; ${esc(hhmmss(Date.parse(entry.at)))}</div>
      <button class="go" id="alertOk">Got it</button>
    </div>
  </div>`;
}

/**
 * The same news, as a strip, for the one moment a modal must not open.
 *
 * <b>NOTHING INTERRUPTS AN APPROACH</b> (§9.3). A sailor thirty metres off a line at nine knots
 * is doing the one thing on this boat that cannot be interrupted, and a dialog over the plot at
 * that moment is worse than any news it could be carrying. So it shows as this, and the modal is
 * raised the moment the approach ends.
 *
 * It is not a quiet failure: it says what kind of thing arrived and it stays until it is read.
 * An abandonment seen twenty seconds late costs nothing; a plot covered at the moment of a
 * crossing costs the crossing.
 */
export function alertBanner(entry) {
  if (!entry) return '';
  return `<div class="banner">
    <span class="mono kind">${esc(entry.type === 'course' ? 'COURSE' : entry.type.toUpperCase())}</span>
    <span class="text">${esc(entry.text || '(no words)')}</span>
    <span class="mono after">after the line</span>
  </div>`;
}

/**
 * How far the waiting zone reaches beyond the start line's ends. Somewhere to wait rather than
 * a boundary anybody is held to: nothing is detected against it.
 */
export const WAIT_ZONE_M = 100;

/**
 * IN THE RACE, WITH NO COURSE YET: the start line as the programme has it now, a zone around it
 * to wait in, the boat, and the word to wait. North up and fitted to the zone and the boat —
 * the course overview needs a course, and there is none until it is published.
 *
 * <b>Over a chart</b>, the course screen's own when one is chosen and the plain chart when not:
 * a circle on an empty sea says nothing about where to go, and the land and the harbour under it
 * are what say where it is. Tiles as on the overview, so a dead network costs the background only.
 *
 * @param waiting the `joined` body's `waiting`: `text`, and `startLine` with its two ends
 * @param fix the latest fix, or null
 */
export function waitingPanel(waiting, fix = null, options = {}) {
  const line = waiting?.startLine;
  const text = `<div class="waiting">
      <h2>${esc(options.raceName ?? 'The race')}: wait for the course</h2>
      <p>${esc(waiting?.text ?? 'Wait for the course details.')}</p>
    </div>`;
  if (!line?.port || !line?.starboard) return text;
  const origin = {
    latitude: (line.port.latitude + line.starboard.latitude) / 2,
    longitude: (line.port.longitude + line.starboard.longitude) / 2,
  };
  // Metres east and north of the line's middle, the way the rest of the boat measures.
  const local = (p) => toLocal(origin, p);
  const a = local(line.port);
  const b = local(line.starboard);
  const radius = Math.hypot(a.x - b.x, a.y - b.y) / 2 + WAIT_ZONE_M;
  const boat = fix && Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude)
    ? local(fix) : null;
  const reach = Math.max(radius, boat ? Math.hypot(boat.x, boat.y) : 0) * 1.15;
  const size = 320;
  const scale = size / 2 / reach;
  const px = (p) => ({ x: size / 2 + p.x * scale, y: size / 2 - p.y * scale });
  const pa = px(a);
  const pb = px(b);
  // In `style`, not attributes: the colour is a CSS variable, which a presentation attribute
  // does not resolve.
  const colour = LINE_STATE_COLOUR.closed;
  const at = boat ? px(boat) : null;
  const basemap = options.basemap && options.basemap !== 'none' ? options.basemap : 'chart';
  const chart = basemapArt(basemap, { x: 0, y: 0 }, origin, scale, size, size, 0,
    options.basemapInk ?? BASEMAP_INK);
  const away = boat ? Math.round(Math.hypot(boat.x, boat.y)) : null;
  return `${text}
    <svg class="waitzone" viewBox="0 0 ${size} ${size}" width="100%" style="max-height:60vh">
      ${chart}
      <circle cx="${size / 2}" cy="${size / 2}" r="${(radius * scale).toFixed(1)}"
        fill="rgba(80,160,255,0.12)" stroke="#50a0ff" stroke-width="2" stroke-dasharray="8 6"/>
      <line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}"
        style="stroke:${colour}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="${pa.x.toFixed(1)}" cy="${pa.y.toFixed(1)}" r="5" style="fill:${colour}"/>
      <circle cx="${pb.x.toFixed(1)}" cy="${pb.y.toFixed(1)}" r="5" style="fill:${colour}"/>
      ${at ? `<circle cx="${at.x.toFixed(1)}" cy="${at.y.toFixed(1)}" r="7" fill="#fff" stroke="#000"
        stroke-width="2"/>` : ''}
      <text x="8" y="20" font-size="14" fill="currentColor">N &uarr;</text>
    </svg>
    <p class="muted" style="font-size:12px">${away == null ? 'No position yet.'
    : away <= radius ? 'You are in the waiting zone.' : `${away} m from the start line.`}</p>`;
}
