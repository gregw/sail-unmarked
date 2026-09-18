/**
 * THE THREE SCREENS THE DIALOG ADDS — the channel, race progress, and the alerts.
 *
 * Kept out of `markscreen.js` because that file is about one thing: the approach plot and the
 * course overview, which are the screens a boat sails by and which work with the server
 * switched off. Everything here needs a channel behind it, and a screen with nothing behind it
 * is not offered at all (dialog document §8.2) — so the split in the files is the same split the
 * view selector makes.
 *
 * Markup only, and every one of these takes a plain object rather than the {@link Dialog}
 * itself where it can, for the same reason `markScreen` takes a state: a screen that can be
 * rendered without a conversation can be tested without one.
 */

import { CANNED, ladder } from './dialog.js';
import { esc, hhmmss } from './markscreen.js';

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
export function startRow(dialog, now = Date.now()) {
  if (!dialog?.live) return '';
  const state = dialog.state(now);
  if (state === 'none') return '';
  const held = dialog.held();
  const seconds = dialog.countdown(now);
  const warning = Number(held?.timer?.body?.warningSeconds ?? 300);

  if (state === 'postponed' || state === 'abandoned') {
    return `<div class="start ${state}">
      <span class="what">${state === 'postponed' ? 'AP &mdash; postponed' : 'Abandoned'}</span>
      <span class="said">${esc(held?.flag?.body?.text ?? '')}</span>
    </div>`;
  }
  const cls = state === 'racing' ? 'racing' : (seconds != null && seconds <= warning ? 'warning' : '');
  return `<div class="start ${cls}">
    <span class="what">${state === 'racing' ? 'Started' : 'Start in'}</span>
    <span class="value">${esc(clock(seconds))}</span>
    <span class="said">${esc(held?.timer?.body?.text ?? '')}</span>
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
 * RACE PROGRESS — the brief's Live place, fed by `fleet` (§9.1).
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
