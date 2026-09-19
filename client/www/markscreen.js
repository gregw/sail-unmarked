/**
 * The Mark screen, as specified in the brief's section 5, and the course overview behind it.
 *
 * One screen in three states — approaching, crossed, missed. The line, the boat, its COG
 * projection and the readout cells are identical across all three; only the state and the
 * plotted data change. That is the brief's own emphasis and it is worth keeping: a sailor
 * glancing down mid-tack should not have to work out which screen they are looking at
 * before they can read it.
 *
 * <h2>There is no state chip</h2>
 * The arrow at the top carries the state itself. It reads NEXT LEG while approaching and
 * turns to THIS LEG the moment a crossing latches, and its colour is the state — grey
 * outline approaching, solid green crossed, bold red outline missed. A chip would put the
 * state in a corner where it competes with everything else; putting it in the one element
 * a sailor is already looking at for the next bearing means the state is read whether or
 * not anybody went looking for it.
 *
 * <h2>The plot says what the two tests decided</h2>
 * Every fix is coloured by the SIDE it was resolved to and drawn hollow when its foot fell
 * beyond a finite end. That is sense and extent made visible, separately, which is what
 * makes a miss explicable instead of merely announced: the colours change, so the boat did
 * change sides; the last few are hollow, so it did it past the end. A screen that printed
 * "missed" and nothing else would be asking to be disbelieved.
 *
 * Drawing only. Everything here takes the plain object `RaceClient.markState()` returns and
 * gives back a string, so the screens can be exercised without a boat and the client can be
 * exercised without a screen.
 */

import { LABEL, ROLE_COLOUR, TRIANGLE, arrowHead, forwardNormal, seats, track, triangle } from './coursedraw.js';
import { BASEMAPS, MapView, mercX, mercY } from './geo.js';
import { fromLocal } from './crossing.js';
import { TRAIL_IN_VIEW, bearingLocal, clock } from './raceclient.js';

/**
 * The orientations, in the order the selector offers them.
 *
 * The brief specifies three; <b>COG up</b> is the fourth and is the one every plotter has: the
 * boat's own heading straight up, so what is ahead on the screen is what is ahead over the
 * bow. It sits beside Leg up because the two are the course-referenced pair — and the
 * difference between them is worth knowing, because it is the difference between where the
 * boat is *going* and where it is *meant to be* going. On a beat, Leg up holds the rhumb line
 * up and the boat points thirty or forty degrees off it, which is what shows the tack; COG up
 * holds the boat up and swings the world on every tack instead.
 *
 * <b>It swings, and it is the only one that swings on the boat rather than on the course.</b>
 * That is a real cost and the reason the brief left it out: a COG is noisy, and a display
 * following it wanders. What makes it usable is that nothing here snaps — `Turner` eases the
 * displayed bearing at `TURN_DEG_S`, which low-passes the jitter into a slow drift rather than
 * a shake.
 */
export const ORIENTATIONS = {
  leg: { label: 'Leg up', turns: true },
  cog: { label: 'COG up', turns: true },
  north: { label: 'North up', turns: false },
  perp: { label: 'Line perp', turns: true },
};

/**
 * Which screen the sailor is looking at: the application's answer, or the sailor's.
 *
 * <b>AUTO is the default and is the design</b> — the sailor never has to ask for the Mark
 * screen, because on a boat the hands are busy and the application knows where the line is
 * while the person is looking at the water. But "never has to" is not "cannot": somebody
 * setting up, checking the next leg on a long beat, or simply disagreeing with the rule has
 * every right to pick, and a display that refused would be insisting it knows better about
 * what somebody wants to look at, which is not a thing it can know.
 *
 * Forcing a screen does not disable the rule underneath — the hysteresis goes on tracking, so
 * AUTO resumes with the right answer rather than with whatever was true when it was left.
 */
export const VIEWS = {
  overview: { label: 'Course' },
  mark: { label: 'Line' },
  chat: { label: 'Chat', needs: 'channel' },
  place: { label: 'Place', needs: 'channel' },
  auto: { label: 'Auto' },
};

/**
 * What acts on the chart, under the chart: zoom, fit, and what is drawn behind it.
 *
 * <b>Under it, and on the overview only.</b> Under, because these act on the picture above them
 * and a control above a picture reads as a control over the whole screen. Only here, because
 * the Mark screen has nothing to zoom — it is fitted to one line and holds still on purpose —
 * and nothing to draw behind it, being offline-first by a rule that is not up for trading.
 *
 * <b>Fit says what it does and is lit while the picture is the screen's own.</b> A reset
 * control that looks the same whether or not there is anything to reset leaves somebody
 * pressing it to find out.
 */
export const chartBar = (options = {}) => {
  const view = options.view;
  const held = !!view?.manual;
  return `<div class="chartbar">
    <button data-zoom="out" title="Zoom out">&minus;</button>
    <button data-zoom="in" title="Zoom in">+</button>
    <button data-zoom="fit" class="${held ? 'on' : ''}"${held ? '' : ' disabled'}>Fit</button>
    <select id="o_basemap" title="What is drawn behind the course">${Object.entries(BASEMAPS)
      .map(([key, spec]) => `<option value="${key}"${key === (options.basemap ?? 'none') ? ' selected' : ''}>${esc(spec.label)}</option>`)
      .join('')}</select>
  </div>`;
};

/**
 * The view selector, on every screen, because any one of them may be the one you want to leave.
 *
 * <b>A SCREEN WITH NOTHING BEHIND IT IS NOT OFFERED</b> (§8.2). Chat and Place need a race — a
 * join with no race behind it has nobody to communicate with and no fleet to be placed among —
 * so they are absent from the selector rather than present and empty. An empty Chat would say
 * *nobody has spoken yet*, where the truth is *there is nobody*.
 *
 * The unread count rides on the Chat button, because that is the one thing about the channel
 * worth knowing from another screen.
 */
export const viewBar = (mode, options = {}) =>
  `<div class="orient views">${Object.entries(VIEWS)
    .filter(([, spec]) => spec.needs !== 'channel' || options.channel)
    .map(([key, spec]) => `<button data-view="${key}" class="${key === mode ? 'on' : ''}">`
      + `${esc(spec.label)}${key === 'chat' && options.unread
        ? ` <span class="unread">${options.unread}</span>` : ''}</button>`).join('')}</div>`;

/** The three-way selector, on every screen that can be turned — which is both of them. */
export const orientationBar = (orientation) =>
  `<div class="orient">${Object.entries(ORIENTATIONS).map(([key, spec]) =>
    `<button data-orient="${key}" class="${key === orientation ? 'on' : ''}">${esc(spec.label)}</button>`).join('')}</div>`;

/** Compass bearing of a vector given in local metres, x east and y north. */
export const bearingOf = (x, y) => (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360;

/**
 * The direction a boat must be travelling to make the required crossing, in local metres.
 *
 * Derived from the same sign convention `crossing.js` fixes once: forward runs from
 * negative signed distance to positive, and the gradient of that quantity is
 * `(-d.y, d.x) / length`. A reverse crossing is the same line travelled the other way, so
 * it is simply the negation — which is the whole of why a line crossed three times in one
 * course needs no extra geometry, only a sense per step.
 */
export function crossingNormal(prepared, required) {
  const sign = required === 'reverse' ? -1 : 1;
  return {
    x: (-prepared.d.y / prepared.length) * sign,
    y: (prepared.d.x / prepared.length) * sign,
  };
}

/**
 * Which compass bearing is drawn at the top of the plot.
 *
 * Leg up and Line perp both turn the whole display when the boat crosses onto the next
 * leg; North up never turns. Leg up falls back to the boat's COG when there is no next leg
 * to point at — at the finish of an open course — because a display that snapped to north
 * at the last mark would turn under the helm at the worst possible moment.
 */
export function upBearing(state, orientation) {
  if (orientation === 'north') return 0;
  if (orientation === 'perp') return perpUp(state);
  // The boat's own heading up. Falling back to the leg rather than to north with no COG to
  // hand, because a display that snapped to north the moment the receiver hiccupped would turn
  // the world under somebody who had asked for it not to.
  if (orientation === 'cog') return state.cogDeg ?? state.legUp ?? state.legBearing ?? 0;
  // The leg the boat is ON, not the one the arrow points at. Falling back to the COG rather
  // than to north at the finish of an open course, because a display that snapped to north at
  // the last mark would turn under the helm at the worst possible moment.
  return state.legUp ?? state.legBearing ?? state.cogDeg ?? 0;
}

/**
 * What Line perp puts at the top: the crossing squared across the screen.
 *
 * <b>At a gate that is the perpendicular to the join between the two centres, not one side's
 * own normal</b> — which is `RaceClient.gateOf`'s whole subject, and the reasoning is there.
 * The short of it: where a gate's sides are parallel, either side of a centreline, their
 * normals point outward in opposite directions, so squaring up to the side a boat happens to
 * be watching turns the display ninety degrees off the approach and turns it the other way
 * the moment the boat changes its mind. Where the sides are collinear the two answers
 * coincide, so there is one rule rather than a special case.
 *
 * Falls back to the watched crossing's own normal, which is the answer for every step that
 * is not a gate and for a gate whose centres cannot be resolved.
 */
export function perpUp(state) {
  const gate = gateUp(state.gate);
  if (gate != null) return gate;
  const normal = crossingNormal(state.watched.prepared, state.watched.required);
  return bearingOf(normal.x, normal.y);
}

/**
 * The bearing a gate's axis is approached along: the perpendicular to the join between its
 * centres, taken the way the leg into the gate runs.
 *
 * Null rather than a guess where there is no axis to take — one crossing, coincident centres,
 * or no leg to fix the sign — so the caller falls back to the crossing normal rather than
 * being handed a bearing that is right half the time.
 */
export function gateUp(gate) {
  if (!gate || (gate.centres ?? []).length < 2 || gate.legInDeg == null) return null;
  const [first, second] = gate.centres;
  const join = { x: second.x - first.x, y: second.y - first.y };
  const length = Math.hypot(join.x, join.y);
  if (!length) return null;
  const normal = { x: -join.y / length, y: join.x / length };
  // A join has two perpendiculars and nothing in the geometry chooses between them. The leg
  // into the gate does, and it is a fact about the course rather than about where the boat
  // has got to — so the display does not swing through half a turn as the boat draws level.
  const radians = (gate.legInDeg * Math.PI) / 180;
  const into = { x: Math.sin(radians), y: Math.cos(radians) };
  const sign = normal.x * into.x + normal.y * into.y >= 0 ? 1 : -1;
  return bearingOf(normal.x * sign, normal.y * sign);
}

/**
 * Local metres to plot pixels, with a bearing at the top.
 *
 * A point at bearing `b` and range `r` from the centre is drawn at screen angle `b - up`,
 * which expands to the rotation below. Screen y runs down while north runs up, so the
 * northward term is subtracted rather than added — the same flip `coursedraw` derives for
 * its normals, and the one thing in either file most worth checking by eye: at North up, a
 * point due north of the centre must come out ABOVE it.
 */
export function projector(centre, up, scale, width, height) {
  const radians = (up * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return (point) => {
    const x = point.x - centre.x;
    const y = point.y - centre.y;
    return {
      x: width / 2 + (x * cos - y * sin) * scale,
      y: height / 2 - (y * cos + x * sin) * scale,
    };
  };
}

/**
 * THE MAXIMUM ZOOM: how little water the plot will ever show across its shorter axis.
 *
 * <b>Measured in the boat's own lengths</b>, because that is the unit a sailor judges room in.
 * `BOAT_LENGTHS_ACROSS` is the default and the server's `display.boatLengthsAcross` overrides
 * it, reaching the client through `GET /api/config` when it joins; the boat's length comes off
 * the join screen. Three lengths is a picture with the boat about a third of the width of it —
 * close enough to place a bow on a line, wide enough that the line still reads as a line.
 *
 * `FLOOR_SPAN_M` is underneath all of it and is not a preference: the whole system resolves to
 * one metre, so a plot showing eight metres across would be drawing detail that is not there,
 * and a dinghy fleet configuring three lengths of a four-metre boat would ask for exactly that.
 */
export const BOAT_LENGTHS_ACROSS = 3;
export const FLOOR_SPAN_M = 15;

/** The closest view for this boat, in metres across the shorter axis. */
export const minSpanM = (boatM, lengthsAcross) => Math.max(
  FLOOR_SPAN_M,
  (Number(boatM) > 0 ? Number(boatM) : REAL.boatM)
    * (Number(lengthsAcross) > 0 ? Number(lengthsAcross) : BOAT_LENGTHS_ACROSS));

/**
 * How much of each axis the things that must be seen are fitted into.
 *
 * <b>The rest is deliberate empty water round the edge, and it is not decoration.</b> A boat,
 * a triangle or a next-leg arrow sitting a few pixels off the border reads as something on its
 * way out of the picture — and on a phone in a bracket the outermost pixels are the ones a
 * thumb, a bezel reflection or a rounded corner take first. The elements that matter want room
 * to be seen as being IN the plot rather than against its wall.
 *
 * Paired with `HOLD.edgeFraction`, which is what the buffer is worth keeping: the fit puts
 * everything this far in, and the frame is given up once anything has drifted to within that
 * fraction of the edge. The gap between the two is how far things may move before the picture
 * is rebuilt, so raising the fit margin without raising the hold threshold would buy a better
 * first frame and let it drift back to where it was.
 */
export const FIT_FRACTION = 0.7;

/**
 * How far along the COG the crossing point may be and still pull the view, as a multiple of the
 * boat's PERPENDICULAR distance off the line.
 *
 * <b>A boat sailing nearly parallel to a line cuts it a very long way away, and at exactly
 * parallel it never cuts it at all.</b> The cut is one of the things the frame is fitted
 * around, so honouring its position at that angle zooms the plot out until the boat is a dot
 * and the line a hair — for a crossing point nobody is steering at and will not reach.
 *
 * <b>Measured against the boat's own distance off, not against the line's length.</b> The two
 * agree on a club start line and part company completely on the long lines this is raced round:
 * a cap in line lengths gives a quarter-mile line a frame ten times looser than a gate's, which
 * is the opposite of what the boat needs — the longer the line, the less of it is worth seeing.
 * The perpendicular distance is the same quantity the approach is about, so at two a boat
 * within about sixty degrees of square to the line keeps its crossing point in the frame and
 * anything shallower gives it up, at every scale and on every line.
 *
 * The ring and the dashes are always drawn where the cut really is — capping what is DRAWN
 * would move the warning, which is the one thing on this screen that must not be moved.
 */
export const COG_FIT_PERP = 2;

/**
 * The next-leg arrow, in pixels, and where it sits relative to the triangle.
 *
 * <b>`offset` is what keeps it off the triangle, whichever way it points.</b> The arrow is
 * drawn about its own CENTRE, and that centre is placed in line with the triangle's tip at
 * `offset` of the arrow's own length away — so the nearest the arrow can ever come to the
 * apex is `(offset - 0.5)` of its length, whatever bearing the next leg happens to be. At
 * 0.6 that is a tenth of its length of clear water in every direction, which is why the
 * number is a fraction of the arrow rather than a fixed gap: make the arrow bigger and the
 * clearance grows with it.
 */
export const ARROW = { shaft: 38, head: 11, width: 3.6, offset: 0.6 };

/**
 * The boat and the line are drawn at their REAL SIZE, which is how the plot shows closing.
 *
 * A boat glyph of a fixed pixel size says nothing about range: at four hundred metres and at
 * four it is the same picture, differing only in where things sit. Drawn to scale the two grow
 * together as the view closes in, and the moment the boat is a third the width of the line is
 * a moment nobody has to read a number to understand.
 *
 * Ten metres is an assumption and will be until a boat declares a length. Three for the line is
 * the accuracy band, which is what that width really is — it varies with the sky and belongs to
 * `crossing.js` rather than to a drawing, and three metres is what a receiver reporting two or
 * three metres actually gives you.
 *
 * <b>IT WAS FIVE, AND FIVE IS WHY THE PICTURE LOOKED WRONG.</b> The glyph's beam is two thirds
 * of its length, so a 10 m boat is drawn 6.7 m across — against a 5 m line that is a third
 * wider than the line is thick, and a narrow dart a third wider than a bright band running the
 * whole width of the plot does not read as the bigger object. At three the beam is over twice
 * the line's thickness at every range, which is the proportion somebody looking at it expects
 * from a 10 m boat and a line.
 *
 * <b>ONE CLAMP, NOT TWO, AND THIS IS THE IMPORTANT PART.</b> The bounds are floored because at
 * four hundred metres a 10 m boat is ten pixels and would vanish, and capped because neither
 * should ever swallow the plot — but the line's bounds are DERIVED from the boat's by the same
 * ratio as their lengths, so the clamp can never put the two out of proportion. Asserting them
 * independently is what broke it: the boat sat frozen on a 13 px floor from about 130 m out
 * while the line went on scaling down to 3 px, so over the part of an approach that takes
 * longest the line visibly thickened and the boat did not move at all. Their ratio drifted from
 * 4.3:1 at four hundred metres to 2.4:1 at a hundred and seventy-five. Derived, it is exactly
 * `boatM / lineM` at every scale, floored, capped and in between.
 */
const BOAT_M = 10;
const LINE_M = 3;
const BOAT_PX = { min: 13, max: 90 };

/**
 * The real sizes for a boat of a given length.
 *
 * <b>Ten metres is the fallback, not the assumption it used to be</b>: the join screen asks
 * each boat for its length, because a plot drawn to scale is a plot that has to know the scale
 * of the thing in it, and a thirty-foot keel boat and a dinghy are not the same picture. A boat
 * that says nothing gets ten, which is what every boat got before there was a field to say it
 * in.
 *
 * The line stays THREE metres for every boat, because that width is not a boat's anything — it
 * is the accuracy band, which belongs to the sky and to `crossing.js`. What is derived per boat
 * is the pixel clamp: one clamp, applied to the boat, with the line's bounds following it by
 * the ratio of their lengths, so the pair can never be drawn out of proportion. Asserting the
 * two independently is what once froze the boat on its floor while the line went on scaling.
 */
export const realFor = (boatM) => {
  const metres = Number(boatM) > 0 ? Number(boatM) : BOAT_M;
  const perBoat = LINE_M / metres;
  return {
    boatM: metres,
    lineM: LINE_M,
    boatPx: BOAT_PX,
    linePx: { min: BOAT_PX.min * perBoat, max: BOAT_PX.max * perBoat },
  };
};

/** The default sizes, for a boat that has not said how long it is. */
export const REAL = realFor(BOAT_M);

/**
 * The crossing triangle is sized against the LINE, not against the plot.
 *
 * `coursedraw` deliberately draws its triangles at a fixed pixel size, and is right to: on the
 * editor's chart they are a notation laid over a course, and a notation that shrank with the
 * chart would stop being readable at exactly the zoom somebody uses to see a whole course.
 *
 * Here the opposite holds. The line beneath it is drawn at its real width and grows as the boat
 * closes, so a fixed triangle that was a bold marker at four hundred metres becomes a chip of
 * colour sitting on a band eight times its size — it stops reading as a thing ON the line and
 * starts reading as a blemish in it. Tied to the line's width the pair keep their proportions
 * all the way in, and the triangle goes on saying what it is there to say.
 *
 * Bounded at both ends all the same: a triangle that grew without limit would fill a plot that
 * is thirty metres across, and one that shrank without limit would be gone at four hundred. The
 * upper bound is set where it is because the invariant worth keeping is that the triangle stays
 * clearly PROUD of the line — the first value tried capped it at barely the line's own width
 * close in, which is the very thing the scaling was for.
 */
export const TRIANGLE_PER_LINE = { height: 3.4, half: 2.0, min: 0.55, max: 4.5 };

/** The triangle's height and base half-width in pixels, for a line drawn `lineW` wide. */
export function triangleFor(lineW) {
  const k = Math.max(TRIANGLE_PER_LINE.min, Math.min(TRIANGLE_PER_LINE.max,
    (lineW * TRIANGLE_PER_LINE.height) / TRIANGLE.height));
  return { height: TRIANGLE.height * k, half: TRIANGLE.half * k, scale: k };
}

/**
 * The boat, as a hull seen from above rather than as an arrow.
 *
 * <b>An arrow says which way something is pointing and nothing else.</b> It was a dart, which
 * on a chart reads as a cursor or a bearing marker — the two things this is not. What a sailor
 * looking at a plot wants to recognise without deciding to is *a boat on the water, heading
 * that way*, and a plan view gives that for the same pixels: a pointed bow, the beam carried
 * aft of midships, and a transom that squares off the stern, which is what makes the forward
 * end unmistakable from the after one at thirteen pixels. The mast is the disc; it is what says
 * *sailing* boat, and it is the only fitting nothing else in this system knows anything about.
 *
 * <b>No boom, deliberately.</b> A boom is drawn at an angle, and an angle is a claim about
 * where the wind is and which tack the boat is on — neither of which anything here knows. A
 * spar drawn at a guess would be the one part of this picture that was made up.
 *
 * In its own units, 27 long, so `length` is what a caller scales against. The beam is 0.42 of
 * that: beamier than a 10 m yacht really is (about 0.32) and narrower than the dart it replaces
 * (0.67), because a hull drawn honestly narrow is a sliver at the sizes this is drawn at, and
 * one drawn as wide as the dart is not a hull. See the note on `REAL` for what the beam is
 * measured against.
 *
 * Origin at the middle of the hull, so the fix is where the boat is rather than where its
 * quarter is, and rotation is about the same point.
 */
export const BOAT = {
  length: 27,
  // MEASURED off the path, not chosen: a cubic's widest point is not where its control points
  // are, so the beam is whatever the curve actually reaches. `getBBox` in a browser gives
  // 27.000 by 11.340 for the hull below, which is the 0.42 quoted above.
  beam: 11.34,
  // Bow, out to the beam just aft of midships, then in to the transom corner; the transom
  // itself is the straight segment across the stern, and the port side mirrors it back.
  hull: 'M0,-13.5 C2.6,-9.4 4.9,-5 5.65,0.5 C5.8,5.6 5.1,9.9 3.5,13.5 L-3.5,13.5'
    + ' C-5.1,9.9 -5.8,5.6 -5.65,0.5 C-4.9,-5 -2.6,-9.4 0,-13.5 Z',
  mast: { x: 0, y: -2.6, r: 1.6 },
};

/**
 * The boat drawn at a given length in pixels, turned to a given heading on the screen.
 *
 * <b>One routine, because both charts draw this boat.</b> The device's plot draws it to
 * scale — it is one of the two things on that screen whose real size is the point — and the
 * rig draws it at a fixed size, since the rig is a desk and not a range. Two copies of the
 * path would be two things to keep in agreement, and the one that fell behind would be
 * whichever was edited second.
 *
 * `edge` is a pixel width whatever the scale, so it is divided back out: a dark hairline round
 * the hull is what separates the boat from the line, the fixes and the tiles underneath, and a
 * stroke that scaled with the glyph would be invisible at thirteen pixels and a black band at
 * ninety.
 */
/**
 * How long the boat is drawn on the course OVERVIEW, in pixels.
 *
 * Fixed, and smaller than the approach's floor: the overview is re-fitted to a whole course
 * every frame, so a boat drawn to scale would be a pixel on a passage leg and a monster on a
 * short windward/leeward. Size means range on the approach screen and nothing on this one.
 */
export const OVERVIEW_BOAT_PX = 20;

export function boatArt(px, py, headingDeg, lengthPx, options = {}) {
  const fill = options.fill ?? 'var(--ink)';
  const edge = options.edge ?? 'var(--sea)';
  const k = lengthPx / BOAT.length;
  const back = (1.2 / k).toFixed(2);
  return `<g transform="translate(${px.toFixed(1)},${py.toFixed(1)})`
    + ` rotate(${headingDeg.toFixed(1)}) scale(${k.toFixed(3)})">`
    + `<path d="${BOAT.hull}" fill="${fill}" stroke="${edge}" stroke-width="${back}"/>`
    + `<circle cx="${BOAT.mast.x}" cy="${BOAT.mast.y}" r="${BOAT.mast.r}" fill="${edge}"/></g>`;
}

/** A real length in metres, as pixels at this scale, kept inside legible bounds. */
export const atScale = (metres, scale, bounds) =>
  Math.max(bounds.min, Math.min(bounds.max, metres * scale));

/** The whole drawn length of the arrow, tail to tip. */
export const arrowLength = (grow = 1) => (ARROW.shaft + ARROW.head) * grow;

/**
 * When the plot is allowed to stop holding still.
 *
 * <b>A plot that re-fits every frame cannot show movement.</b> Centring on the boat — or on
 * anything that moves with it — keeps it in the same pixels however fast it is sailing, so
 * the one thing a sailor is looking for on the approach, whether they are actually closing
 * the line, is the one thing the picture cannot say. The line slides under a stationary boat,
 * which reads as the mark moving.
 *
 * So the frame is FROZEN and the boat moves across it, and it is given up only for the two
 * reasons that make holding it useless: the boat is about to leave the picture, or the amount
 * of water worth showing has changed enough that the scale is doing real harm. Both are
 * generous on purpose — a frame that re-fits on any small pretext is a frame that never held
 * still, which is the thing being fixed.
 */
export const HOLD = {
  /**
   * How close to the edge a component may get before the frame is rebuilt around it.
   *
   * <b>Well inside the boundary, not a hair inside it.</b> The rule was "still in the view",
   * which waited until something had already vanished for a frame — the one moment somebody
   * is looking hardest at it — and even once that was fixed it let the boat and the triangle
   * drift to within a few pixels of the border before anything was done about it. This is the
   * number that decides how close a key element ever actually gets, since the fit only decides
   * where it starts: see `FIT_FRACTION`, which is the margin things are placed at, and keep
   * this comfortably inside it or the frame is rebuilt the moment it is built.
   */
  edgeFraction: 0.1,
  /** How much closer in the view could usefully be before it is worth a jump. */
  scaleTolerance: 0.15,
};

/**
 * How fast the display swings round onto a new leg, in degrees per second.
 *
 * Slowly, and the slowness is the point. In Leg up and Line perp the whole world turns when a
 * boat crosses onto the next leg, and snapping it through ninety degrees between one frame and
 * the next destroys the one thing an oriented display is for — knowing, without thinking,
 * which way things are. A turn that is watched happening is a turn that is followed. Twenty-
 * five degrees a second puts the longest realistic swing comfortably inside the dwell, so the
 * display has settled by the time the crossed screen gives way to the next approach.
 */
export const TURN_DEG_S = 25;

/** The shortest way round from one bearing to another, in degrees, signed. */
export const turnBetween = (from, to) => ((((to - from) % 360) + 540) % 360) - 180;

/**
 * A bearing that chases another one instead of jumping to it.
 *
 * Its own object because BOTH screens turn. The Mark screen turns about one line and the
 * overview turns about a whole course, and they hold quite different things still — but the
 * swing itself is the same swing, and two copies of an easing that had to agree about what
 * "slowly" means would not stay agreed.
 */
export class Turner {
  constructor() {
    this.up = null;
    this.wanted = null;
    this.at = null;
  }

  /**
   * Ease toward `wanted`, in real time.
   *
   * Real time rather than a step per render, because the screens render at the fix rate and
   * on the animation frame respectively — a per-render step would make the same turn take a
   * different length of time depending on how fast the receiver happened to be going.
   *
   * `animate` is false for North up, which never turns, and the first call always snaps: a
   * display that swung into position when it opened would be showing the wrong thing for the
   * first second of every screen.
   */
  turn(wanted, animate, now = Date.now()) {
    this.wanted = wanted;
    if (this.up == null || !animate) {
      this.up = wanted;
    } else {
      const elapsed = Math.max(0, (now - (this.at ?? now)) / 1000);
      const delta = turnBetween(this.up, wanted);
      const most = TURN_DEG_S * elapsed;
      this.up = Math.abs(delta) <= most ? wanted : (this.up + Math.sign(delta) * most + 360) % 360;
    }
    this.at = now;
    return this.up;
  }

  /** True while still swinging, so the page knows to keep drawing. */
  turning() {
    return this.up != null && this.wanted != null
      && Math.abs(turnBetween(this.up, this.wanted)) > 0.5;
  }
}

/**
 * The frame the Mark screen is holding: where it is centred, how close in, and which way up.
 *
 * State, deliberately, and owned by the page rather than by the drawing — the plot is handed
 * one and asks it what to do, so the decision can be exercised on its own and a caller that
 * passes none simply gets the old fit-every-time behaviour.
 */
export class PlotView {
  constructor() {
    this.centre = null;
    this.scale = null;
    this.subject = null;
    /** The bearing actually at the top right now, which chases `wantedUp`. */
    this.up = null;
    this.wantedUp = null;
    this.turnedAt = null;
  }

  /**
   * Ease the displayed bearing toward the one wanted, in real time.
   *
   * Real time rather than a step per render, because the two screens render at the fix rate
   * and the animation frame respectively — a per-render step would make the same turn take a
   * different length of time depending on how fast the receiver happened to be going.
   *
   * `animate` is false for North up, which never turns, and the first draw always snaps: a
   * display that swung into position when it opened would be showing the wrong thing for the
   * first second of every screen.
   */
  turn(wanted, animate, now = Date.now()) {
    this.wantedUp = wanted;
    if (this.up == null || !animate) {
      this.up = wanted;
    } else {
      const elapsed = Math.max(0, (now - (this.turnedAt ?? now)) / 1000);
      const delta = turnBetween(this.up, wanted);
      const most = TURN_DEG_S * elapsed;
      this.up = Math.abs(delta) <= most ? wanted : (this.up + Math.sign(delta) * most + 360) % 360;
    }
    this.turnedAt = now;
    return this.up;
  }

  /** True while the display is still swinging, so the page knows to keep drawing. */
  turning() {
    return this.up != null && this.wantedUp != null
      && Math.abs(turnBetween(this.up, this.wantedUp)) > 0.5;
  }

  /**
   * Keep the frame, or rebuild it around what is wanted now.
   *
   * The identity check comes first and is absolute: a different line, a different lap or a
   * different orientation is a different picture, and holding a frame across one of those
   * would leave the boat somewhere off the edge of a view built for a mark it has left.
   *
   * After that there are exactly two reasons to give a frame up, and both are about the frame
   * having stopped being useful rather than about anything having merely changed: something
   * that has to be seen is about to leave it, or the view could usefully be a sixth closer in.
   */
  frame(wanted) {
    const { up, subject, centre, scale, points, width, height } = wanted;
    let why = 'held';
    // The displayed bearing is NOT part of the identity, because it changes continuously
    // while the display is swinging onto a new leg and a frame rebuilt on every degree of
    // that would be a frame that never held still. A deliberate change of orientation is a
    // different picture and reaches here inside `subject` instead.
    let keep = this.centre !== null && this.subject === subject;
    if (!keep) {
      why = this.centre === null ? 'first' : 'new mark';
    } else {
      const to = projector(this.centre, up, this.scale, width, height);
      const marginX = width * HOLD.edgeFraction;
      const marginY = height * HOLD.edgeFraction;
      const out = (points ?? []).some((point) => {
        const px = to(point);
        return px.x < marginX || px.x > width - marginX
          || px.y < marginY || px.y > height - marginY;
      });
      if (out) {
        keep = false;
        why = 'leaving the view';
      } else if (scale > this.scale * (1 + HOLD.scaleTolerance)) {
        // ZOOMING IN ONLY. A boat closing a line makes the useful scale grow steadily, and
        // giving up the frame each time it has grown a sixth is exactly the stepped zoom an
        // approach wants. Zooming back OUT on the same rule would undo it on every wobble —
        // and a boat that has genuinely gone away trips the test above instead, which is the
        // honest reason to rebuild rather than a number drifting.
        keep = false;
        why = 'closer in';
      }
    }
    if (!keep) {
      this.centre = centre;
      this.scale = scale;
      this.up = up;
      this.subject = subject;
    }
    return { centre: this.centre, scale: this.scale, reframed: !keep, why };
  }
}

const fmt = (value, places = 0) => (value == null || Number.isNaN(value) ? '—' : value.toFixed(places));
const deg = (value) => (value == null ? '—' : String(Math.round(value) % 360).padStart(3, '0'));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

/**
 * The plot: the line, the boat, the projection and the fixes, as one SVG string.
 *
 * The fit deliberately includes the boat, its recent fixes, the projection's cut and the
 * near part of the line, and nothing else. Anything further away is not what somebody a
 * hundred metres from a mark is looking at.
 */
export function plot(state, options = {}) {
  const width = options.width ?? 340;
  const height = options.height ?? 300;
  const orientation = options.orientation ?? 'north';
  const prepared = state.watched.prepared;
  const boat = state.point;
  // THE BOAT'S OWN LENGTH decides both how big it is drawn and how close the view may zoom.
  // Off the join screen, through `RaceClient`; ten metres for a boat that did not say. The
  // number of lengths to hold across the view is the server's (`display.boatLengthsAcross`),
  // read when the boat joined and defaulted here, because this screen draws whether or not the
  // server was ever reached.
  const real = realFor(state.boatM ?? options.boatM);
  const closest = minSpanM(real.boatM, options.boatLengthsAcross);

  // The foot of the perpendicular: the part of the line the boat is actually closing on.
  const alongUnit = { x: prepared.d.x / prepared.length, y: prepared.d.y / prepared.length };
  const offset = (boat.x - prepared.port.x) * alongUnit.x + (boat.y - prepared.port.y) * alongUnit.y;
  const foot = {
    x: prepared.port.x + alongUnit.x * offset,
    y: prepared.port.y + alongUnit.y * offset,
  };
  const at = (distance) => ({
    x: prepared.port.x + alongUnit.x * distance,
    y: prepared.port.y + alongUnit.y * distance,
  });

  // WHAT MUST STAY IN VIEW, and it is a SHORT list: the boat, the point on the line it is
  // about to cross, the last few fixes behind it, and the crossing point where its present
  // course cuts the line — that last one only when the boat is actually pointing at the line.
  // The triangle and the arrow come in below, because they are pixel sizes and cannot be
  // fitted until the scale is known.
  //
  // <b>THE LINE'S OWN GEOMETRY IS NOT IN IT ANY MORE, and that is the lesson of a real boat on
  // real water.</b> The midpoint and the nearer end used to be held in view, on the reasoning
  // that a picture of a line must say how much line there is and where the mark is. On a club
  // start line it cost little. On the long lines this system is actually raced round it cost
  // everything: the picture is pinned to a mark and an end that may be two hundred metres away
  // from where the boat will cross, so the last few metres — the whole reason the approach
  // screen exists — are drawn a few pixels wide. The questions those two answered are answered
  // elsewhere and better: DTW counts down to the mark on the screen above, and the overview
  // draws the line whole.
  const seatAlong = Math.max(0, Math.min(prepared.length, offset));
  const seat = at(seatAlong);
  const alongCog = (distance) => {
    const radians = ((90 - state.cogDeg) * Math.PI) / 180;
    return {
      x: boat.x + Math.cos(radians) * distance,
      y: boat.y + Math.sin(radians) * distance,
    };
  };
  const cut = state.projection ? alongCog(state.projection.distanceM) : null;
  /*
   * THE CUT IS IN THE FIT ONLY WHILE THE BOAT IS POINTING AT THE LINE, and "pointing at it" is
   * measured against the boat's own distance off rather than against the line's length.
   *
   * A boat sailing nearly parallel cuts the line a very long way away, and at exactly parallel
   * never at all — so a frame that honoured the cut's position zoomed out until the boat was a
   * dot, for a crossing point nobody is steering at. Sailing at it, the cut is barely further
   * than the perpendicular distance and costs the picture nothing.
   *
   * `COG_FIT_PERP` is the multiple of the perpendicular distance inside which the cut is worth
   * holding. At two, a boat within sixty degrees of square to the line keeps its crossing point
   * in the frame, and anything shallower gives it up — which is the same boat, the same
   * distance off, deciding the same way at every scale, where a cap in LINE lengths gave a
   * quarter-mile start line a fit ten times looser than a gate's.
   *
   * What is DRAWN is never conditional: the ring and the dashes stay where the cut really
   * falls, and the figure reads the true distance, because moving the warning is the one thing
   * this screen must not do. A cut outside the picture has its figure clipped into it instead.
   */
  const cutInFit = cut && state.projection
    && state.projection.distanceM <= COG_FIT_PERP * Math.max(Math.abs(state.perpDistM ?? 0), 1)
    ? cut : null;
  // THREE dots, not the whole trail. At 5 Hz two minutes of track reaches back a quarter of
  // a mile, and fitting all of it is what kept the plot wide; three is the fewest that still
  // shows a direction rather than a pair of points.
  const recent = (state.trail ?? state.fixes ?? []).slice(-TRAIL_IN_VIEW);
  const interesting = [boat, seat, ...(cutInFit ? [cutInFit] : []), ...recent];

  const view = options.view ?? new PlotView();
  // The bearing WANTED is derived from the course; the bearing SHOWN chases it, so a boat
  // crossing onto a new leg watches the world swing round rather than finding it already
  // swung. North up never turns and snaps by construction.
  const up = view.turn(upBearing(state, orientation), !!ORIENTATIONS[orientation]?.turns,
    options.now ?? Date.now());
  const radians = (up * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const spin = (p) => ({ x: p.x * cos - p.y * sin, y: p.y * cos + p.x * sin });
  const unspin = (p) => ({ x: p.x * cos + p.y * sin, y: p.y * cos - p.x * sin });
  const rotated = interesting.map(spin);

  // THE TRIANGLE AND THE ARROW ARE FIXED PIXEL SIZES, so they cannot be fitted as points in
  // metres: how far they reach depends on the very scale being solved for. Their DIRECTION
  // does not — both hang off the seat along the crossing normal and then along the next leg,
  // and each of those is settled by `up` alone — so the far tip is a known pixel offset from
  // a known metre point, and the fit is solved by iterating: pick a scale, see where the tip
  // lands in metres, fit again including it. `coursedraw.tangentPath` iterates for the same
  // reason; two passes is ample when the correction is a fifth of a view.
  const seatRot = spin(seat);
  const screenAlong = (() => {
    const turned = spin(alongUnit);
    return { x: turned.x, y: -turned.y };   // screen y runs down where metres run up
  })();
  const grow = state.state === 'crossed' ? 1.2 : 1;
  const crossNormal = (() => {
    const n = forwardNormal(screenAlong.x, screenAlong.y);
    const sign = state.watched.required === 'reverse' ? -1 : 1;
    return { x: n.x * sign, y: n.y * sign };
  })();

  /**
   * Where the next-leg mark sits and which way it runs, in pixels from the seat — for a
   * triangle of a given height, off a given crossing normal, along a given leg.
   *
   * A function of the height rather than a constant, because the triangle is now sized against
   * the line, the line against the scale, and the scale is what the fit is solving for. The
   * same circularity the arrow already had, one level deeper, and answered the same way.
   *
   * Parameterised on the normal and the leg because BOTH SIDES OF A GATE get an arrow, and
   * the two differ in both: each side's triangle points the way that side is crossed, and the
   * leg out of it runs from that side's own midpoint. Drawing the watched side's arrow twice
   * would say the choice cost nothing, which is the one thing a gate is not.
   */
  const legGeom = (triangleHeight, normal, bearing, swell = 1) => {
    const length = arrowLength(swell);
    const reach = triangleHeight + length * ARROW.offset;
    const middle = { x: normal.x * reach, y: normal.y * reach };
    if (bearing == null) return { middle, dir: null, length };
    const theta = ((bearing - up) * Math.PI) / 180;
    return { middle, dir: { x: Math.sin(theta), y: -Math.cos(theta) }, length };
  };

  /**
   * Both ends of the arrow, so the fit reserves room for it whichever way it points.
   *
   * The FOCUSED side's arrow only. The other side of a gate is deliberately not in the fit,
   * and nor is what hangs off it: showing it must never cost zoom from the side the boat is
   * actually sailing at.
   */
  const decorFor = (triangleHeight) => {
    const leg = legGeom(triangleHeight, crossNormal, state.legBearing, grow);
    const half = leg.length * 0.5;
    return leg.dir
      ? [
        { x: leg.middle.x + leg.dir.x * half, y: leg.middle.y + leg.dir.y * half },
        { x: leg.middle.x - leg.dir.x * half, y: leg.middle.y - leg.dir.y * half },
      ]
      : [
        { x: leg.middle.x, y: leg.middle.y - 14 * grow },
        { x: leg.middle.x, y: leg.middle.y + 14 * grow },
      ];
  };

  /** The triangle's height at a given scale, which is what the line's width decides. */
  const triangleHeightAt = (px) => triangleFor(atScale(real.lineM, px, real.linePx)).height;

  const fit = (points) => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const spanX = Math.max(closest, Math.max(...xs) - Math.min(...xs));
    const spanY = Math.max(closest, Math.max(...ys) - Math.min(...ys));
    return {
      scale: Math.min((width * FIT_FRACTION) / spanX, (height * FIT_FRACTION) / spanY),
      centre: {
        x: (Math.max(...xs) + Math.min(...xs)) / 2,
        y: (Math.max(...ys) + Math.min(...ys)) / 2,
      },
    };
  };

  // Three passes now, not two: the scale decides the line's width, which decides the
  // triangle's height, which decides where the arrow hangs — and only then is the scale
  // that must hold all of it known. It settles quickly because every step is a shrinking
  // correction, but there is one more link in the chain than there was.
  let solved = fit(rotated);
  for (let pass = 0; pass < 3; pass++) {
    const inMetres = decorFor(triangleHeightAt(solved.scale)).map((px) => ({
      x: seatRot.x + px.x / solved.scale,
      y: seatRot.y - px.y / solved.scale,
    }));
    solved = fit([...rotated, ...inMetres]);
  }
  const wantScale = solved.scale;
  // Centred on everything that has to be seen, which is now a precise list — rather than
  // between the boat and the line, which was a guess made when the list was not.
  const wantCentre = unspin(solved.centre);

  // ...and then held still, so the boat is seen to move across it. Without a view passed in
  // this is the old fit-every-frame behaviour, which is what the specs that draw one picture
  // want and what nothing on screen should use.
  const { centre, scale } = view.frame({
    up,
    subject: `${state.step.index}:${state.watched.line}:${state.lap ?? 1}:${orientation}`,
    centre: wantCentre,
    scale: wantScale,
    // Every one of them, not just the boat: the frame is worth holding only while all of
    // them are still in it, and the crossing point leaves first when a boat bears away. The
    // midpoint and the nearer end are in here too, or a frame held while the boat closed
    // would lose them between rebuilds — which is the whole of what putting them in the fit
    // is for.
    points: interesting,
    width,
    height,
  });
  const to = projector(centre, up, scale, width, height);

  let out = '';

  // How far an infinite end is run out before the viewport clips it: the diagonal, so it
  // reaches the corner whichever way the line lies.
  const reach = Math.hypot(width, height);

  // THE OTHER SIDE OF A GATE FIRST, so the focused one draws over it wherever they meet.
  // Deliberately NOT in the fit: it is shown where it happens to fall in view and never at the
  // cost of zooming out from the side the boat is actually sailing at. Drawing only one side
  // would say there is only one, and the choice is the boat's right up to the moment it
  // crosses.
  const others = (state.alternatives ?? []).map((other) => ({
    other,
    art: crossingArt(other.prepared, other.required,
      { to, scale, boat, focused: false, reach, real }),
  }));
  for (const { art } of others) out += art.out;

  // THE LINE BEING CROSSED, at its real width, with its ends said honestly: a finite end is a
  // dot that can be overrun, an infinite end runs on because it cannot be.
  const art = crossingArt(prepared, state.watched.required, {
    real,
    to, scale, boat, focused: true, missed: state.state === 'missed', reach,
  });
  out += art.out;
  const seatPx = art.seatPx;

  // THE NEXT LEG, in line with the triangle's tip and clear of it whichever way it points —
  // cross HERE, going THAT way, and then head THERE. Green and a fifth larger once the
  // crossing has latched, which is the one change of state the plot makes on its own: the
  // scale deliberately does not move, so growth and colour are what say something happened.
  //
  // An F where there is NO next leg, which happens at exactly one place on a course: the
  // finish of an open one. Crossing the second-last line still has a leg after it — the one
  // to the finish — and that leg has a bearing worth pointing at, so it gets an arrow like
  // any other. Only when nothing follows is there nothing to point at.
  const legMark = (leg, at, colour, style = {}) => {
    const swell = style.swell ?? 1;
    const opacity = style.opacity ?? 1;
    const fade = opacity === 1 ? '' : ` opacity="${opacity}"`;
    const legAt = { x: at.x + leg.middle.x, y: at.y + leg.middle.y };
    if (!leg.dir) {
      // The F is for the one place with nothing beyond it, and that is never a gate — a gate
      // may be neither the first step nor the last — so an alternative with no leg out of it
      // draws nothing rather than a second finish.
      if (!style.finish) return '';
      return `<text x="${legAt.x.toFixed(1)}" y="${(legAt.y + 10).toFixed(1)}" text-anchor="middle"`
        + ` font-family="var(--disp)" font-size="${(30 * swell).toFixed(0)}" font-weight="700"`
        + ` fill="${colour}"${fade} style="paint-order:stroke;stroke:var(--sea);stroke-width:4px">F</text>`;
    }
    // THE DRAWN EXTENT IS EXACTLY `length`, tail to tip, and getting that wrong is what let
    // the arrow touch the triangle. `arrowHead` puts its point a further `size` BEYOND the
    // place it is given, so passing the intended tip as its anchor pushed the real tip a
    // head-length further out than the clearance allowed for — invisible at most bearings and
    // an overlap at the one that matters, a next leg doubling straight back down the last.
    const half = leg.length * 0.5;
    const headSize = ARROW.head * swell;
    const along = (distance) => ({
      x: legAt.x + leg.dir.x * distance,
      y: legAt.y + leg.dir.y * distance,
    });
    const tail = along(-half);
    const anchor = along(half - headSize);      // so the head's point lands at +half
    const neck = along(half - headSize * 1.7);  // where the head's back corners are
    return `<line x1="${tail.x.toFixed(1)}" y1="${tail.y.toFixed(1)}" x2="${neck.x.toFixed(1)}" y2="${neck.y.toFixed(1)}"`
      + ` stroke="${colour}" stroke-width="${(ARROW.width * swell).toFixed(1)}" stroke-linecap="round"${fade}/>`
      + `<polygon points="${arrowHead(anchor, (Math.atan2(leg.dir.y, leg.dir.x) * 180) / Math.PI, headSize)}" fill="${colour}"${fade}/>`;
  };

  const boatPx = to(boat);

  // BOTH SIDES OF A GATE GET AN ARROW AND BOTH GET A PERPENDICULAR, because those are the two
  // things the choice is actually made on — how far off each line the boat is, and where each
  // one leads. An arrow on the watched side alone said the other side had no leg out of it,
  // and a single distance said the sides were the same distance away, which on a gate whose
  // lines are parallel is nearly true and on one whose lines are collinear is not true at all.
  // Subdued, and drawn before the focused pair, so what the readouts and the clock belong to
  // is never in doubt: the comparison is offered, not asserted.
  for (const { other, art: otherArt } of others) {
    out += legMark(legGeom(otherArt.triangleHeight, otherArt.crossNormal, other.legBearing),
      otherArt.seatPx, 'var(--muted)', { opacity: OTHER_SIDE.ink });
    if (other.perpDistM != null)
      out += perpArt(boatPx, to(otherArt.foot), other.perpDistM, false, { width, height }).svg;
  }

  // Off the triangle that was actually drawn, at the scale actually held — so the arrow keeps
  // its clearance whatever size the triangle came out.
  out += legMark(legGeom(art.triangleHeight, crossNormal, state.legBearing, grow), seatPx,
    state.state === 'crossed' ? 'var(--ok)' : 'var(--muted)', { swell: grow, finish: true });

  // THE PERPENDICULAR, thin and dashed, with the distance written along it.
  const footPx = to(art.foot);
  const perp = perpArt(boatPx, footPx, state.perpDistM, true, { width, height });
  out += perp.svg;

  // THE COG PROJECTION, with a ring where it cuts. The ring is the warning made visual:
  // when it sits outside the line's ends, the present course is running out past the pin,
  // and it goes red to say so long before the boat gets there.
  if (cut) {
    const hit = to(cut);
    const colour = state.projection.warning === 'beyond-end'
      ? 'var(--warn)'
      : state.projection.warning === 'near-end' ? 'var(--toside)' : 'var(--line)';
    out += `<line x1="${boatPx.x.toFixed(1)}" y1="${boatPx.y.toFixed(1)}" x2="${hit.x.toFixed(1)}" y2="${hit.y.toFixed(1)}" stroke="var(--cog)" stroke-width="1.7" stroke-dasharray="7,5"/>`;
    // The other side of its own dashes from the perpendicular's figure, which is the same
    // dashes whenever the boat is pointed square at the line.
    // Clipped into the picture like the other side of a gate's figure, and for the same
    // reason: past the cap the ring is off the plot, so the midpoint of these dashes can be
    // too, and a figure nobody can see is not a warning.
    const seen = clipToView(boatPx, hit, width, height, LINE_LABEL_PX);
    const figure = onLine(seen.from, seen.to, `${Math.round(state.projection.distanceM)} m`,
      'var(--cog)', { side: -1, fraction: 0.8 });
    // NEVER TWO FIGURES ON TOP OF ONE ANOTHER, and this one is the one that gives way.
    //
    // Four fifths along, which is as far as it can usefully go: its own segment ends AT the
    // line, and its offset is perpendicular to that segment — which near the line runs roughly
    // ALONG the line, so pushing it further slides it down the line rather than away from it.
    // Measured, the give-way rate falls 25 → 9 → 6 of 65 frames at 0.7 → 0.8 → 0.9, and by 0.8
    // the figure is already touching the line it is measuring to. Moving it the other way, in
    // towards the boat, is far worse: the two segments share that end, so 0.15–0.3 collide in
    // 25 to 44 frames of the same 65.
    //
    //
    // Opposite sides and different fractions along the dashes separate them over almost the
    // whole approach, but not in the last thirty metres square on: there the segment is too
    // short to pull them apart along, and they overlapped into "30 3m0 m". The geometry that
    // squeezes them is exactly the geometry that makes this figure redundant — square on and
    // close in, the distance along the COG IS the perpendicular distance, to the metre. So
    // when the two would collide the perpendicular keeps its figure and this one does without,
    // which loses nothing: the dashes and the ring still say where the present course cuts.
    if (!boxesClash(perp.box, figure.box)) out += figure.svg;
    /*
     * A RING WHERE THE PRESENT COURSE CUTS THE LINE — AND A RED CROSS WHERE IT DOES NOT.
     *
     * A ring says *here*: it is a place on the line the boat is heading for. Past the end
     * there is no such place, and the present course scores nothing however well it is
     * sailed — so the mark changes SHAPE and not merely colour, which is the same rule the
     * rejected fixes follow. A red ring said the boat was heading somewhere and ought to
     * hurry; a red cross says the one thing that is true, which is that this course crosses
     * nothing. That warning is what the one-metre hard edge at a finite end obliges this
     * screen to give, and it has to carry at a glance from a tiller.
     */
    out += state.projection.warning === 'beyond-end'
      ? `<g stroke="var(--warn)" stroke-width="2.6" stroke-linecap="round">`
        + `<line x1="${(hit.x - 7).toFixed(1)}" y1="${(hit.y - 7).toFixed(1)}" x2="${(hit.x + 7).toFixed(1)}" y2="${(hit.y + 7).toFixed(1)}"/>`
        + `<line x1="${(hit.x + 7).toFixed(1)}" y1="${(hit.y - 7).toFixed(1)}" x2="${(hit.x - 7).toFixed(1)}" y2="${(hit.y + 7).toFixed(1)}"/></g>`
      : `<circle cx="${hit.x.toFixed(1)}" cy="${hit.y.toFixed(1)}" r="6.5" fill="none" stroke="${colour}" stroke-width="2"/>`;
  }

  // THE FIXES, coloured by the side they were resolved to and hollow past an end. The
  // band's zero — neither side yet — is drawn muted rather than omitted, because a run of
  // fixes that resolved to NOTHING is a thing worth seeing: it is a boat sitting on a line.
  for (const fix of state.trail ?? []) {
    const px = to(fix);
    const colour = fix.side === 0 ? 'var(--muted)' : fix.side > 0 ? 'var(--toside)' : 'var(--fromside)';
    out += fix.beyond
      ? `<circle cx="${px.x.toFixed(1)}" cy="${px.y.toFixed(1)}" r="3.5" fill="var(--sea)" stroke="${colour}" stroke-width="2"/>`
      : `<circle cx="${px.x.toFixed(1)}" cy="${px.y.toFixed(1)}" r="3.5" fill="${colour}"/>`;
  }

  // THE CROSSING, ringed in green at the INTERPOLATED instant — never at a fix. Drawing it
  // on a fix would be drawing the wrong point: the crossing happened between two of them,
  // and which one it was drawn on would bias the picture the same way taking the time from
  // one biases the time.
  if (state.latched && state.latchedPoint) {
    const px = to(state.latchedPoint);
    out += `<circle cx="${px.x.toFixed(1)}" cy="${px.y.toFixed(1)}" r="8" fill="none" stroke="var(--ok)" stroke-width="2.5"/>`;
    out += `<circle cx="${px.x.toFixed(1)}" cy="${px.y.toFixed(1)}" r="3" fill="var(--ok)"/>`;
    out += `<text x="${(px.x - 14).toFixed(1)}" y="${(px.y + 14).toFixed(1)}" text-anchor="end" font-family="var(--mono)" font-size="11" fill="var(--ok)">${esc(hhmmss(state.latched.time))}</text>`;
  }

  // THE REJECTED CANDIDATES, marked where they happened. The brief asks for these to be
  // shown rather than swallowed: a boat told only that nothing counted has no way to tell a
  // miss from a bug in the application. But they are not all the same KIND of thing, and one
  // symbol for all of them said they were.
  for (const reject of state.rejected ?? []) {
    if (!reject.point) continue;
    out += rejectMark(to(reject.point), reject.note);
  }

  // THE BOAT, pointing along its COG. Turned by the COG less whatever is at the top, so
  // that at North up it points at its true bearing and at Leg up it points straight up
  // while the boat is on the leg.
  out += boatArt(boatPx.x, boatPx.y, state.cogDeg - up,
    atScale(real.boatM, scale, real.boatPx));

  out += northPointer(up, width);

  return `<svg class="plot" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}

/**
 * How large the two distances written on the plot's own lines are drawn.
 *
 * Big, because they are now the only numbers on the picture and they are read at a glance from
 * a tiller — and because the room for them came from somewhere: the four readout cells they
 * replaced took a third of the screen to say what the plot was already showing.
 */
export const LINE_LABEL_PX = 36;

/**
 * One crossing drawn: the line at its real width, its ends said honestly, and the triangle
 * that says which way through.
 *
 * <b>One routine for the focused crossing and for the other side of a gate</b>, because the
 * two must not drift apart: a subdued copy written separately would be the place a change to
 * how a line is drawn quietly failed to reach, and the reader would be looking at two lines
 * drawn to different rules without being told.
 *
 * Returns what the caller needs to hang the next-leg arrow off, so the arrow geometry has a
 * single source for where the triangle actually ended up.
 */
export function crossingArt(prepared, required, options) {
  const { to, scale, boat, focused = true, missed = false, reach = 900 } = options;
  const alongUnit = { x: prepared.d.x / prepared.length, y: prepared.d.y / prepared.length };
  const offset = (boat.x - prepared.port.x) * alongUnit.x + (boat.y - prepared.port.y) * alongUnit.y;
  const at = (distance) => ({
    x: prepared.port.x + alongUnit.x * distance,
    y: prepared.port.y + alongUnit.y * distance,
  });

  const port = to(at(0));
  const starboard = to(at(prepared.length));
  const span = Math.hypot(starboard.x - port.x, starboard.y - port.y) || 1;
  const screenUnit = { x: (starboard.x - port.x) / span, y: (starboard.y - port.y) / span };
  // The joining boat's own sizes, so the line's drawn width keeps its proportion to a hull
  // that is no longer assumed to be ten metres. See `realFor`.
  const real = options.real ?? REAL;
  const lineW = atScale(real.lineM, scale, real.linePx);
  const fade = focused ? 0.9 : 0.3;

  // BUTT ENDS, not round. A round cap extends a stroke by half its width past the point it was
  // drawn to, which was invisible at three pixels and is half a boat-length once the line is
  // drawn at its real width — and it would extend it exactly where the extent test says the
  // line stops. A line that looks longer than it can be crossed is the one lie this must not
  // tell.
  let out = `<line x1="${port.x.toFixed(1)}" y1="${port.y.toFixed(1)}" x2="${starboard.x.toFixed(1)}"`
    + ` y2="${starboard.y.toFixed(1)}" stroke="var(--line)" stroke-width="${lineW.toFixed(1)}"`
    + ` stroke-linecap="butt" opacity="${fade}"/>`;

  for (const [end, infinite, direction] of [
    [port, prepared.portInfinite, -1],
    [starboard, prepared.starboardInfinite, 1],
  ]) {
    if (infinite) {
      // AS SUBSTANTIAL AS THE LINE ITSELF, near enough. An infinite end is not a weaker part
      // of the line — it is the part that cannot be missed, so if anything it is the safer
      // water to cross. Drawn as a thin fading hairline it read as the opposite: a boundary
      // petering out, something to stay inside. Same width, long dashes rather than short.
      const away = { x: end.x + screenUnit.x * reach * direction, y: end.y + screenUnit.y * reach * direction };
      const dash = Math.max(9, lineW * 1.6);
      out += `<line x1="${end.x.toFixed(1)}" y1="${end.y.toFixed(1)}" x2="${away.x.toFixed(1)}"`
        + ` y2="${away.y.toFixed(1)}" stroke="var(--line)" stroke-width="${(lineW * 0.85).toFixed(1)}"`
        + ` stroke-dasharray="${dash.toFixed(0)},${(dash * 0.55).toFixed(0)}" opacity="${(fade * 0.78).toFixed(2)}"/>`;
    } else {
      out += `<circle cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="${missed ? 6.5 : 3}"`
        + ` fill="${missed ? 'none' : 'var(--line)'}" stroke="var(--line)" stroke-width="2"`
        + ` opacity="${missed ? 1 : fade * 0.6}"/>`;
      if (missed)
        out += `<text x="${end.x.toFixed(1)}" y="${(end.y - 11).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="9" fill="var(--line)">END</text>`;
    }
  }

  const n = forwardNormal(screenUnit.x, screenUnit.y);
  const sign = required === 'reverse' ? -1 : 1;
  const crossNormal = { x: n.x * sign, y: n.y * sign };
  // Scaled with the line rather than fixed, and built by hand rather than through
  // `coursedraw.triangle` — that one is deliberately a fixed size, which is right on a chart
  // and wrong on a line drawn at its real width.
  const size = triangleFor(lineW);

  /*
   * THE TRIANGLE'S BASE MAY NEVER HANG PAST A FINITE END, and that is not a tidiness rule.
   *
   * Its base lies ALONG the line, so a triangle seated at the last metre of one puts half its
   * width out beyond the end — and what that draws is a line that goes on a little further
   * than it does. On this screen that is the one lie the drawing must not tell: the extent
   * test says a crossing past the end is a miss, and a boat deciding whether it can fetch the
   * pin is reading the picture to find out where the pin IS. The butt line cap is here for the
   * same reason, and would be undone by a triangle overhanging it.
   *
   * Clamped in pixels, against the ends as drawn, so it holds at every scale. Only at FINITE
   * ends: an infinite end is a bearing rather than a place, drawn running out of the picture,
   * so there is nothing there to overhang. A line drawn shorter than the triangle is wide —
   * a gate side seen from a long way off — has no answer that keeps the base on it, so the
   * triangle is centred, which is the least wrong and stays symmetrical about the mark.
   */
  const perMetre = span / prepared.length;
  const lo = prepared.portInfinite ? -Infinity : size.half;
  const hi = prepared.starboardInfinite ? Infinity : span - size.half;
  const along = Math.max(0, Math.min(prepared.length, offset)) * perMetre;
  const seatAlong = lo > hi ? span / 2 : Math.max(lo, Math.min(hi, along));
  const seat = {
    x: port.x + screenUnit.x * seatAlong,
    y: port.y + screenUnit.y * seatAlong,
  };
  const mark = sizedTriangle(seat, screenUnit, crossNormal, size);
  // Filled where the boat is going, outlined where it might have. The shape says the sense
  // either way; the fill says which one this screen is about.
  out += focused
    ? `<polygon points="${mark.points}" fill="var(--line)"/>`
    : `<polygon points="${mark.points}" fill="none" stroke="var(--line)" stroke-width="${(1.6 * size.scale).toFixed(1)}" opacity="0.55"/>`;

  return { out, seatPx: seat, screenUnit, crossNormal, foot: at(offset), triangleHeight: mark.height };
}

/** A crossing triangle at a chosen size: the same shape `coursedraw` draws, scaled. */
export function sizedTriangle(at, along, normal, size) {
  const apex = { x: at.x + normal.x * size.height, y: at.y + normal.y * size.height };
  const a = { x: at.x - along.x * size.half, y: at.y - along.y * size.half };
  const b = { x: at.x + along.x * size.half, y: at.y + along.y * size.half };
  return {
    base: { x: at.x, y: at.y },
    apex,
    points: `${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)} ${apex.x.toFixed(1)},${apex.y.toFixed(1)}`,
    height: size.height,
  };
}

/**
 * A figure written along a line on the plot, clear of it and the right way up.
 *
 * Offset perpendicular to the line rather than sitting on it, because a number drawn over a
 * dashed stroke is a number with a dashed stroke through it. Always upright, never rotated to
 * follow the line: a rotated label is unreadable at exactly the angles where a boat is closing
 * a mark fastest.
 */
export function onLine(from, to, text, colour, options = {}) {
  const size = options.size ?? LINE_LABEL_PX;
  const opacity = options.opacity ?? 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  // WHICH SIDE of its own dashes a figure is offset to, and HOW FAR ALONG them it sits. Both
  // figures on this plot run from the boat to somewhere on the line, so a boat pointed near
  // square at the line has them within a pixel of each other: the perpendicular foot and the
  // COG's cut are the same place.
  //
  // Opposite sides alone was not enough, and a screenshot said so: half a figure's height each
  // way is 36 px between two readings 70 px wide, and they overlapped into "61 0m m". Nor is
  // widening the offset the answer on its own — the two segments share the boat and diverge by
  // only a few degrees, so both offsets point much the same way and widening moves the pair
  // together. What separates them is sitting at different FRACTIONS along their own dashes, a
  // fifth and four fifths, which pulls them apart ALONG the segment where the divergence is.
  // Measured over every heading that still cuts the line ahead, at 150 m and at 60 m: the
  // closest the two boxes come is 16 px of clear space, where before they overlapped by 27.
  const side = options.side ?? 1;
  const fraction = options.fraction ?? 0.5;
  const away = { x: (-dy / length) * side, y: (dx / length) * side };
  // Proportions rather than pixels throughout, so the smaller figure the other side of a gate
  // gets is offset by the amount that figure needs and not by the amount the big one does. The
  // baseline sits a third of the height down, which centres it on the offset.
  const at = {
    x: from.x + dx * fraction + away.x * (size * 0.75),
    y: from.y + dy * fraction + away.y * (size * 0.75),
  };
  const svg = `<text x="${at.x.toFixed(1)}" y="${(at.y + size / 3).toFixed(1)}" text-anchor="middle"`
    + ` font-family="var(--mono)" font-size="${size}" fill="${colour}"`
    + (opacity === 1 ? '' : ` opacity="${opacity}"`)
    + ` style="paint-order:stroke;stroke:var(--sea);stroke-width:6px">${esc(text)}</text>`;
  return { svg, box: labelBox(at, text, size) };
}

/**
 * Roughly where a figure written by `onLine` lands, as a box in plot pixels.
 *
 * <b>So that two of them can be told not to sit on top of each other.</b> It is an estimate —
 * a real text box needs a DOM, and these are drawn in `node` as often as in a browser — but
 * the type is monospaced, which is what makes an estimate good enough: measured against the
 * fallback face, every character of `--mono` advances half its size, and the em box runs from
 * about three quarters of the size above the baseline to a fifth below.
 *
 * One routine, used by the drawing AND by its spec, so the two cannot disagree about whether
 * a pair of figures collide.
 */
export function labelBox(at, text, size) {
  const halfWidth = (String(text).length * 0.5 * size) / 2;
  const baseline = at.y + size / 3;
  return {
    x0: at.x - halfWidth,
    x1: at.x + halfWidth,
    y0: baseline - size * 0.75,
    y1: baseline + size * 0.2,
  };
}

/** Whether two label boxes would be drawn over one another. */
export const boxesClash = (a, b) =>
  !!a && !!b && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * How the OTHER side of a gate is drawn, as fractions of the focused side.
 *
 * <b>Both sides get a perpendicular and both get a next-leg arrow, and they must not read as
 * equal claims.</b> The point of showing the other side is comparison — this far off that
 * line, that way afterwards, against this far off this one — and comparison needs both
 * numbers on the screen. But two figures at the plot's full label size fight over the middle
 * of the picture, and the screen would stop saying which line its state, its time and its
 * fit belong to. So the other side keeps the same shapes at half the label and rather less
 * ink, which is the same relation its triangle already has to the focused one: outlined
 * rather than filled.
 */
export const OTHER_SIDE = { label: 0.5, label_opacity: 0.6, ink: 0.4 };

/**
 * The perpendicular from the boat to a line: the dashes, and the distance written along them.
 *
 * One routine for both sides of a gate, for the reason `crossingArt` is one routine — a
 * subdued copy written separately is where a change to how this is drawn would quietly fail
 * to reach the other side, and the reader would be comparing two numbers drawn to two rules
 * without being told.
 *
 * The figure sits ON the dashes with no label, which is what freed the room the time to line
 * now uses: a cell elsewhere headed "Perp dist" makes a reader match a word to a picture,
 * where the figure on the line it measures needs no legend to be learned.
 *
 * <b>The figure is the LINE's colour, and the dashes stay muted.</b> Two big numbers share
 * this plot and they were `--muted` and `--cog` — two cool greys a shade apart, which at a
 * glance from a cockpit is one colour: nothing said which of them was the distance to the
 * line and which was the distance along the COG. The perpendicular is about the line, so it
 * takes the line's own cyan and is unmistakable beside the COG's grey. The dashes are a
 * construction line rather than a virtual mark and keep the muted stroke they had — cyan
 * there would put a second line on the water.
 */
export function perpArt(boatPx, footPx, metres, focused = true, view = {}) {
  const ink = focused ? 1 : OTHER_SIDE.ink;
  const size = focused ? LINE_LABEL_PX : LINE_LABEL_PX * OTHER_SIDE.label;
  const out = `<line x1="${boatPx.x.toFixed(1)}" y1="${boatPx.y.toFixed(1)}"`
    + ` x2="${footPx.x.toFixed(1)}" y2="${footPx.y.toFixed(1)}" stroke="var(--muted)"`
    + ` stroke-width="1.4" stroke-dasharray="2,4" opacity="${ink}"/>`;
  // ON THE PART OF THE DASHES THAT CAN BE SEEN. The other side of a gate is deliberately not
  // in the fit, so its foot is routinely outside the plot — measured on a real gate the
  // midpoint of those dashes landed at x=711 in a 400 px picture, which is a number nobody
  // can read and a comparison nobody can make. Widening the fit to reach it is the one thing
  // that must not happen, so the figure comes to the viewport instead of the viewport going
  // to the figure. It stays on its own dashes, which is what makes it need no label.
  const seen = view.width && view.height
    ? clipToView(boatPx, footPx, view.width, view.height, size)
    : { from: boatPx, to: footPx };
  // AT THE CENTRE OF ITS OWN PERPENDICULAR, which is where it belongs: the figure measures
  // that segment, so the middle of the segment is the one place on the plot that can only mean
  // this number. It sat a fifth along, near the boat, which was a workaround for the COG's
  // figure being in the way — and the wrong way round, since the workaround cost the primary
  // number its natural place to protect the secondary one. The COG's figure sits four fifths
  // along instead and gives way outright when even that collides; see the plot.
  const figure = onLine(seen.from, seen.to, `${Math.round(Math.abs(metres))} m`, 'var(--line)',
    focused ? {} : { size, opacity: OTHER_SIDE.label_opacity });
  return { svg: out + figure.svg, box: figure.box };
}

/**
 * The part of a segment that lies inside the plot, inset far enough for a figure written
 * along it to be read.
 *
 * Liang-Barsky against the inset box, and the far end is the one that moves: the near end is
 * the boat, which is always in view because the fit is built round it. Hands back the segment
 * unchanged if it misses the box entirely, which cannot happen from the boat but is not worth
 * being clever about.
 */
export function clipToView(from, to, width, height, inset = 0) {
  // Room for the figure, not just for its anchor: it is centred, so it reaches out sideways
  // about a character and a half of a five-character reading either way, and down by a third
  // of its height. Generous rather than measured — a text metric would need a DOM.
  const pad = { x: Math.min(inset * 1.6, width / 3), y: Math.min(inset, height / 3) };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, from.x - pad.x],
    [dx, width - pad.x - from.x],
    [-dy, from.y - pad.y],
    [dy, height - pad.y - from.y],
  ]) {
    if (p === 0) {
      if (q < 0) return { from, to };     // parallel to this edge and outside it
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
  }
  if (t0 > t1) return { from, to };
  const at = (t) => ({ x: from.x + dx * t, y: from.y + dy * t });
  return { from: at(t0), to: at(t1) };
}

/**
 * How a rejected crossing candidate is drawn, which depends entirely on what it was.
 *
 * <b>Crossing the wrong way is not a mistake and must not be marked as one.</b> A boat that
 * finds itself on the far side of a line and comes back across it to set up properly has done
 * the ordinary thing — it happens on every start and every time somebody overstands — and the
 * detector logs it as a wrong-sense candidate because that is what it is, not because anything
 * went wrong. A RED cross there tells a sailor mid-manoeuvre that they have blown the mark,
 * which is both untrue and exactly the wrong moment to be told it. So it is a BLUE one: the
 * same shape, saying the same thing about what happened, in a colour that says nothing is
 * wrong. It happened, it counted for nothing, and there is nothing to fix.
 *
 * A red cross is kept for the one thing that IS a miss — changing sides past the end of the
 * line, where the crossing was in the right direction and simply did not happen on the line.
 *
 * A candidate that never confirmed its far side is neither: the boat dipped over and came
 * back, or a fix wobbled. It gets a small hollow ring, because saying nothing would hide it
 * and saying either of the other two would be a claim about it that is not true.
 */
export function rejectMark(px, note = '') {
  if (note.startsWith('wrong sense')) {
    // A BLUE CROSS, the same shape as the red one and unmistakably a different colour. It
    // was a tick, which was the right sentiment and the wrong mark: a thin stroke in the
    // orange already used for one side of the line, on a dark plot, at a glance, from a
    // cockpit — it simply could not be seen. Shape carries the fact that something was
    // rejected; colour carries whether that matters.
    return `<g stroke="var(--fromside)" stroke-width="2.6" stroke-linecap="round">`
      + `<line x1="${(px.x - 7).toFixed(1)}" y1="${(px.y - 7).toFixed(1)}" x2="${(px.x + 7).toFixed(1)}" y2="${(px.y + 7).toFixed(1)}"/>`
      + `<line x1="${(px.x + 7).toFixed(1)}" y1="${(px.y - 7).toFixed(1)}" x2="${(px.x - 7).toFixed(1)}" y2="${(px.y + 7).toFixed(1)}"/></g>`;
  }
  if (note.startsWith('side change was past')) {
    return `<g stroke="var(--warn)" stroke-width="2">`
      + `<line x1="${(px.x - 6).toFixed(1)}" y1="${(px.y - 6).toFixed(1)}" x2="${(px.x + 6).toFixed(1)}" y2="${(px.y + 6).toFixed(1)}"/>`
      + `<line x1="${(px.x + 6).toFixed(1)}" y1="${(px.y - 6).toFixed(1)}" x2="${(px.x - 6).toFixed(1)}" y2="${(px.y + 6).toFixed(1)}"/></g>`;
  }
  return `<circle cx="${px.x.toFixed(1)}" cy="${px.y.toFixed(1)}" r="5" fill="none"`
    + ` stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="2,2"/>`;
}

/** A fix time as the status line prints it. */
export function hhmmss(time) {
  if (!time) return '—';
  const at = time instanceof Date ? time : new Date(time);
  return [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((v) => String(v).padStart(2, '0')).join(':');
}

/**
 * The sentence under the readouts, which is the screen's audit trail in one line.
 *
 * It names what was decided and on what evidence — "Crossed 18:42:07. Required direction.
 * Latched. 3 + 3." — because the number of confirming fixes either side is what makes a
 * latch defensible, and a result nobody can interrogate is a result nobody will accept.
 */
export function statusLine(state) {
  if (state.state === 'crossed' && state.latched)
    return `Crossed ${hhmmss(state.latched.time)}. Required direction. Latched.`;
  if (state.state === 'missed') {
    const past = state.rejected.find((r) => r.note?.startsWith('side change was past'));
    return past ? `${past.note[0].toUpperCase()}${past.note.slice(1)}. No crossing.`
      : 'Side change was past the end. No crossing.';
  }
  if (state.projection?.warning === 'beyond-end')
    return `On this course you will pass ${fmt(Math.abs(state.projection.marginM))} m outside the end. No crossing.`;
  if (state.projection?.warning === 'near-end')
    return `Running close: ${fmt(state.projection.marginM)} m inside the end on this course.`;
  return `Approaching. Required side confirmed, ${state.confirmed} fix${state.confirmed === 1 ? '' : 'es'}.`;
}

/**
 * TIME TO LINE: how long until this boat crosses, at the course and speed it is making.
 *
 * The one number on this screen that is worth a whole line to itself. Perpendicular distance
 * and distance along the COG are both on the plot now, drawn on the very lines they measure,
 * and COG and SOG were taking up a third of the screen to say what the boat already knows and
 * what the plot already shows — the boat is drawn pointing along its COG, and its speed is the
 * thing the time is computed FROM.
 *
 * <b>The colour is the second question, and it is the more important one.</b> A projection can
 * be a perfectly good twenty seconds away and still be running out past the pin, so green means
 * the present course crosses the line and red means it does not. A red thirty is not a countdown
 * — it is thirty seconds' warning that the boat is about to sail past the end having scored
 * nothing, which is exactly the warning the one-metre hard edge obliges this screen to give.
 */
export function timeToLine(state) {
  const { seconds, crossing } = state.ttl ?? {};
  const colour = crossing ? 'ok' : 'missing';
  // A stale fix cannot say how long anything will take: the speed and course it was computed
  // from are both instantaneous, so an old answer is wrong rather than merely old.
  const shown = state.stale || seconds == null || !Number.isFinite(seconds) || seconds > 3600
    ? '—'
    : seconds >= 60
      ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
      : String(Math.round(seconds));
  return `<div class="ttl ${colour}">
    <span class="label">TTL</span>
    <span class="value">${esc(shown)}</span>
    <span class="unit">${!state.stale && seconds != null && seconds < 60 ? 's' : ''}</span>
  </div>`;
}

/** The whole Mark screen: the header strip, the plot, the time to line and the status. */
export function markScreen(state, options = {}) {
  const orientation = options.orientation ?? 'north';
  const arrow = state.state === 'crossed'
    ? { text: 'THIS LEG', cls: 'crossed' }
    : state.state === 'missed' ? { text: 'NEXT LEG', cls: 'missed' } : { text: 'NEXT LEG', cls: '' };

  const cell = (label, value, unit) =>
    `<div><div class="label">${esc(label)}</div><div class="value">${esc(value)}<span class="unit">${esc(unit ?? '')}</span></div></div>`;

  return `
    <div class="bar">
      <span class="mono">${esc(hhmmss(state.time))}</span>
      <span class="mono muted">GPS ${state.satellites ?? '—'} SV</span>
      <span class="sp"></span>
      <strong class="disp">MARK ${esc(state.letter ?? state.step.letter)}</strong>
      <!--
        A cycle's start is a CHOICE of lines rather than a position in the sequence, so there
        is no "3 of 12" to print for it — the boat is at none of them yet. It says "start"
        instead, which is what the screen is for at that moment.
      -->
      <span class="mono muted">${state.step.index < 0 ? 'start'
        : `${state.step.index + 1} / ${state.of}`}${state.lap > 1 ? ` &middot; lap ${state.lap}` : ''}</span>
    </div>
    ${viewBar(options.viewMode ?? 'auto', options)}
    ${orientationBar(orientation)}
    <div class="leg ${arrow.cls}">
      <svg viewBox="0 0 22 22" width="22" height="22"><polygon points="11,2 19,20 11,15 3,20" fill="currentColor"/></svg>
      <span class="disp">${arrow.text}</span>
      <span class="mono">${state.legBearing == null ? 'FINISH' : `${deg(state.legBearing)}&deg;`}</span>
    </div>
    ${plot(state, { ...options, orientation })}
    ${timeToLine(state)}
    <p class="status ${state.state}">${esc(statusLine(state))}</p>
    ${state.sinceGood > 0
      ? `<p class="signal warn">No usable fix &mdash; ${state.sinceGood} rejected in a row.</p>`
      : state.stale ? '<p class="signal warn">No fix.</p>' : ''}`;
}

/** Below this, DTW reads in metres; at or above it, in nautical miles. */
export const NM_FROM_M = 370;   // 0.2 nm

/**
 * A range, in the unit somebody would actually say it in.
 *
 * Nautical miles down the leg and metres close in, switching at a fifth of a mile. A single
 * unit is wrong at one end or the other: "0.03 nm" is not a number anybody steers by in the
 * last hundred metres, and "1 483 m" is not how a leg is described. Switching is safe here
 * only because the unit is printed beside the figure every time — the same readout with a
 * bare number would be a trap.
 */
export function distanceTo(metres) {
  if (metres == null || Number.isNaN(metres)) return { value: '—', unit: '' };
  return metres >= NM_FROM_M
    ? { value: (metres / 1852).toFixed(2), unit: 'nm' }
    : { value: String(Math.round(metres)), unit: 'm' };
}

/**
 * What the boat is steering at, named.
 *
 * <b>The line's own id, not just the mark letter.</b> A letter says where in the sequence
 * the boat is; the name says which piece of water, and that is what somebody checks a
 * course against — the sailing instructions and the club's chart both talk about the
 * leeward line, never about "mark 2". On a gate both names are given, because until the
 * choice is made both are the target and DTW is measured to the point between them.
 */
export function waypointRow(waypoint) {
  if (!waypoint) return '<div class="wpt"><span class="muted">Nothing to steer for.</span></div>';
  return `<div class="wpt">
    <span class="letter">${esc(waypoint.letter)}</span>
    <span class="name mono">${esc(waypoint.lines.join('  /  '))}</span>
    ${waypoint.gate ? '<span class="mono muted gate">gate</span>' : ''}
    <!--
      A CYCLE MAY BE STARTED AT ANY OF ITS ENTRY LINES, and the row names the one being
      steered for rather than all of them: four scoped ids would not fit, and the others are
      drawn on the plot as alternatives anyway. What it must not do is say nothing about the
      choice, or a boat heading for one line would think it was the only one.
    -->
    ${waypoint.starts > 1 ? `<span class="mono muted gate">1 of ${waypoint.starts} starts</span>` : ''}
  </div>`;
}

/**
 * Which bearing the OVERVIEW puts at the top, for each of the three modes.
 *
 * The same three the Mark screen offers, because they are a property of the display and not
 * of one screen: somebody who has chosen Leg up has chosen how they read a chart, and having
 * that hold for the approach and then be abandoned the moment the course came back would be
 * two different conventions on one device.
 *
 * <b>Leg up here is the LEG, not the bearing to the mark.</b> On the approach those are
 * nearly the same thing; on an overview they are not, because a boat halfway up a beat is
 * pointing thirty or forty degrees off the rhumb line and a display that followed the boat
 * would swing back and forth on every tack. So the leg is measured mark to mark — from the
 * step behind to the step in front — which is fixed for the whole leg and is what "the leg"
 * means. With nothing behind it, at the start of an open course, it falls back to the bearing
 * to the first mark, which is the only leg there is.
 */
export function overviewUp(client, orientation) {
  if (orientation === 'north') return 0;
  // Asked for before the live step, because it is the one orientation that does not depend on
  // there being a mark ahead: at the finish of an open course there is no step and the boat is
  // still pointing somewhere.
  if (orientation === 'cog') return client.fix?.cogDeg ?? 0;
  const step = client.live();
  if (!step) return 0;
  if (orientation === 'perp') {
    // The same rule the approach screen squares up by, reached through the same routine: at a
    // gate the perpendicular to the join between the centres, and a single crossing's own
    // normal everywhere else. Taking `crossings[0]` alone was picking one side of a gate by
    // its position in the file, which on a parallel gate is a ninety-degree coin toss.
    const gate = gateUp(client.gateOf(step));
    if (gate != null) return gate;
    const normal = crossingNormal(step.crossings[0].prepared, step.crossings[0].required);
    return bearingOf(normal.x, normal.y);
  }
  // One definition of "the current leg", shared with the approach screen: mark behind to mark
  // ahead. Two copies of it would be two things to keep agreeing, and the day they stopped
  // agreeing the two screens would be turned different ways with no way to tell which was
  // right.
  return client.legInto(step)
    ?? client.waypoint()?.bearingDeg
    ?? client.fix?.cogDeg
    ?? 0;
}

/**
 * A north pointer, for when north is not up.
 *
 * A rotated chart with no north reference is a chart you cannot relate to anything else — the
 * printed one on the nav table, the wind direction somebody called across the water, the
 * forecast. It costs a corner of the plot and it is drawn only when it is needed, which is
 * also what makes it informative: seeing it at all tells you the display is turned.
 */
export function northPointer(up, width) {
  if (Math.abs(((up % 360) + 360) % 360) < 0.5) return '';
  const x = width - 22;
  const y = 22;
  return `<g transform="translate(${x},${y}) rotate(${(-up).toFixed(1)})" opacity="0.75">`
    + `<path d="M0,-11 L5,6 L0,2 L-5,6 Z" fill="var(--muted)"/>`
    + `<text x="0" y="17" text-anchor="middle" font-family="var(--mono)" font-size="9"`
    + ` fill="var(--muted)" transform="rotate(${up.toFixed(1)})">N</text></g>`;
}

/**
 * How far the overview may be zoomed by hand, as a multiple of the fit.
 *
 * The fit is the picture the screen exists to give — the whole course — so the range is about
 * being able to look INTO it and back out a little, not about replacing it. Out to a quarter
 * because seeing the course small against its surroundings is a real thing to want with a
 * basemap behind; in to sixteen because past that the overview is a Mark screen without the
 * detail a Mark screen has.
 */
export const OVERVIEW_ZOOM = { min: 0.25, max: 16, step: 1.5 };

/** How much of the basemap is let through — see `basemapArt` for why it is so little. */
export const BASEMAP_INK = 0.32;

/**
 * HOW BRIGHT THE COURSE IS DRAWN ON THE OVERVIEW, and it is drawn for DAYLIGHT.
 *
 * The screens are dark because they are read in glare and at dusk — but dark is the
 * BACKGROUND's job, not the course's. Everything here was drawn faint, which on a desk reads as
 * a tasteful picture with the live mark standing out of it, and on the water in sunshine reads
 * as an empty screen: a phone in a bracket at midday loses half its contrast to the sky before
 * anything on it is even looked at, and a 50% stroke over a dark panel is the first thing to
 * go.
 *
 * So the rule is that everything the sailor needs to SEE is drawn near full strength, and the
 * ranking between them is carried by colour and weight rather than by fading them out: the live
 * mark is green where the others are blue, and the track behind it is thinner and dashed. Only
 * what is genuinely behind the boat — a mark already crossed this lap — is dimmed, and even
 * that is dimmed to "still legible" rather than to "nearly gone".
 *
 * The one thing that stays faint is the basemap (`BASEMAP_INK`), because that is a background
 * and is the thing everything else has to be read against.
 */
export const OVERVIEW_INK = {
  /** The legs, which are a construction line under the marks rather than the marks. */
  track: 0.85,
  trackWidth: 1.8,
  /** A mark not yet reached: the ordinary case, and it must be readable at a glance. */
  ahead: 0.95,
  /** A mark already crossed this lap. Behind the boat, but still part of the picture. */
  done: 0.6,
  /**
   * The boat's own COG, run out to the edge. Not the course, but read in the same glance and
   * lost to the same glare — and it is the line that answers "what am I pointing at".
   */
  cog: 0.85,
  cogWidth: 1.5,
  /** The track sailed since the last line. The boat's own, in the boat's own ink. */
  trail: 0.8,
  trailWidth: 2,
};

/**
 * What the sailor has done to the overview by hand: zoomed it, or moved it.
 *
 * <b>The overview re-fits every frame, and that is right until somebody takes hold of it.</b>
 * Seeing the whole course is what the screen is for, and a held frame would let a boat sail off
 * the edge of its own course — but a picture that re-fits while you are dragging it is a picture
 * you cannot drag. So the moment anything is zoomed or panned the fit is ANCHORED: the centre
 * and scale of the frame at that moment are kept, and the hand-controls work from those. Fit
 * gives it back.
 *
 * The pan is held in screen PIXELS rather than metres, because that is what a drag is: the
 * chart should follow the finger by the distance the finger moved, whatever the display is
 * turned to and however far it is zoomed in.
 */
export class OverviewView {
  constructor() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.anchor = null;
  }

  /** True once the picture is the sailor's rather than the fit's. */
  get manual() {
    return this.zoom !== 1 || this.pan.x !== 0 || this.pan.y !== 0;
  }

  zoomBy(factor) {
    this.zoom = Math.max(OVERVIEW_ZOOM.min, Math.min(OVERVIEW_ZOOM.max, this.zoom * factor));
    return this;
  }

  panByPx(dx, dy) {
    this.pan = { x: this.pan.x + dx, y: this.pan.y + dy };
    return this;
  }

  /** Back to the fit, which is the screen's own answer. */
  reset() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.anchor = null;
    return this;
  }

  /**
   * The frame to work from: the live fit while nothing has been touched, and the fit as it was
   * when something first was, once something has.
   */
  base(centre, scale) {
    if (!this.manual) {
      this.anchor = null;
      return { centre, scale };
    }
    this.anchor ??= { centre, scale };
    return this.anchor;
  }
}

/**
 * The basemap behind the course, drawn north-up and turned with the rest of the world.
 *
 * <b>Tiles are `<image>` elements and nothing waits for them.</b> The browser fetches them on
 * its own, so a dead network costs a blank background and nothing else — no await, no `fetch`,
 * nothing on the path between a fix arriving and the course being drawn. That is the property
 * that lets this exist at all on a screen whose whole claim is that it works with the server
 * switched off, and `drive-client` holds it to it with `fetch` replaced by a thrower.
 *
 * Drawn on a SQUARE the size of the viewport's diagonal, because the picture is rotated and a
 * viewport-sized patch of tiles would leave the corners bare at every angle but north-up. The
 * rotation is `-up` about the middle, which is the inverse of what `projector` does to the
 * world — the derivation is there.
 *
 * The Mark screen deliberately gets none of this. It is offline-first and non-negotiable, and
 * at its scale — a couple of pixels to the metre — every tile server in the world is out of
 * zoom levels and would hand back a blur to sail by.
 */
export function basemapArt(basemap, centre, origin, scale, width, height, up) {
  const spec = BASEMAPS[basemap];
  if (!spec || spec.layers.length === 0 || !origin) return '';
  const reach = Math.ceil(Math.hypot(width, height));
  const at = fromLocal(origin, centre);
  const view = new MapView(reach, reach);
  view.center = { wx: mercX(at.longitude), wy: mercY(at.latitude) };
  view.atPxPerM(scale);
  // DIMMED HARD, and that is not a nicety. Every tile server worth using draws for a white
  // screen — the Esri ocean base is a pale chart and OSM is paler — and these screens are dark
  // because they are read in glare and at dusk. Laid on at full strength the background becomes
  // the brightest thing on the plot and the course, which is the only thing on it that matters,
  // is a thin cyan line over a bright page. At this opacity the sea colour behind shows through
  // and the tiles become what they are for: the shape of the land, under the course.
  return `<g transform="translate(${((width - reach) / 2).toFixed(1)},${((height - reach) / 2).toFixed(1)})"`
    + ` opacity="${BASEMAP_INK}"><g transform="rotate(${(-up).toFixed(1)},${reach / 2},${reach / 2})">`
    + `${view.tileLayer(basemap)}</g></g>`;
}

/**
 * The course overview: the whole course, with the boat on it.
 *
 * Drawn with the same `coursedraw` the editor uses, because the course a boat is shown on
 * the water and the course it was designed as must be the same picture. A second drawing
 * of the same geometry would be a second thing to keep right, and the first time the two
 * disagreed the sailor would be the one who found out.
 */
export function overview(client, options = {}) {
  const width = options.width ?? 340;
  const height = options.height ?? 300;
  const orientation = options.orientation ?? 'north';
  const points = [];
  for (const step of client.steps)
    for (const crossing of step.crossings)
      points.push(crossing.prepared.port, crossing.prepared.starboard);
  if (client.point) points.push(client.point);
  if (!points.length) return '<svg class="plot" viewBox="0 0 340 300"></svg>';

  // The whole course is ALWAYS fitted here — that is what an overview is for, and holding a
  // frame still would let a boat sail off the edge of its own course. It is the Mark screen,
  // where the question is "am I closing this line", that has to hold still.
  const up = (options.turner ?? new Turner())
    .turn(overviewUp(client, orientation), !!ORIENTATIONS[orientation]?.turns,
      options.now ?? Date.now());

  // Fitted in ROTATED space: a course that is long east-west needs a different scale once it
  // is stood on end, and fitting on the unrotated extent would crop it.
  const radians = (up * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const turned = points.map((p) => ({ x: p.x * cos - p.y * sin, y: p.y * cos + p.x * sin }));
  const xs = turned.map((p) => p.x);
  const ys = turned.map((p) => p.y);
  const spanX = Math.max(80, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(80, Math.max(...ys) - Math.min(...ys));
  const fitScale = Math.min((width * 0.84) / spanX, (height * 0.84) / spanY);
  // The centre of the extent, taken back out of rotated space so the projector applies the
  // rotation itself rather than the two of them doing half each.
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
  const fitCentre = { x: midX * cos + midY * sin, y: midY * cos - midX * sin };

  // WHAT THE SAILOR HAS DONE TO THE PICTURE, on top of the fit. Untouched, this is the fit
  // exactly as it was before there were any controls; see `OverviewView`.
  const view = options.view ?? new OverviewView();
  const held = view.base(fitCentre, fitScale);
  const scale = held.scale * view.zoom;
  // The pan is in screen pixels, so it is applied in ROTATED space and taken back out again —
  // the same there-and-back the extent's centre does just above. Moving the picture right by P
  // pixels is moving the centre LEFT by P/scale, which is where the signs come from.
  const centre = (!view.pan.x && !view.pan.y) ? held.centre : (() => {
    const u = (held.centre.x * cos - held.centre.y * sin) - view.pan.x / scale;
    const v = (held.centre.y * cos + held.centre.x * sin) + view.pan.y / scale;
    return { x: u * cos + v * sin, y: v * cos - u * sin };
  })();
  const to = projector(centre, up, scale, width, height);

  // THE BACKGROUND FIRST, so every line, triangle and letter of the course draws over it.
  const background = basemapArt(options.basemap, centre, client.origin, scale, width, height, up);

  // How many crossings each line carries, so the ones that repeat can be seated along it
  // in course order rather than stacked. The leeward line of a windward/leeward is the
  // start, mark 2 and the finish, and drawing three triangles on one spot says none of it.
  const byLine = new Map();
  client.steps.forEach((step) => {
    for (const crossing of step.crossings) {
      if (!byLine.has(crossing.line)) byLine.set(crossing.line, []);
      byLine.get(crossing.line).push({ step, crossing });
    }
  });

  const placed = new Map();
  for (const [, uses] of byLine) {
    const a = to(uses[0].crossing.prepared.port);
    const b = to(uses[0].crossing.prepared.starboard);
    const screenLength = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const along = { x: (b.x - a.x) / screenLength, y: (b.y - a.y) / screenLength };
    const normal = forwardNormal(along.x, along.y);
    seats(uses.length, screenLength).forEach((atPx, i) => {
      const { step, crossing } = uses[i];
      const sign = crossing.required === 'reverse' ? -1 : 1;
      const seat = { x: a.x + along.x * atPx, y: a.y + along.y * atPx };
      placed.set(`${step.index}:${crossing.line}`, triangle(seat, along,
        { x: normal.x * sign, y: normal.y * sign }));
    });
  }

  let out = background;
  for (const [, uses] of byLine) {
    const a = to(uses[0].crossing.prepared.port);
    const b = to(uses[0].crossing.prepared.starboard);
    // THE LINE THE BOAT IS HEADING FOR IS DRAWN LIKE THE TRIANGLE ON IT. The live crossing's
    // triangle has always been green while every other was blue or grey, and the line under it
    // was the same blue as all the rest — so the one thing on the picture worth finding was
    // marked on a shape a few pixels across and not on the hundred-metre stroke it sits on.
    // A line may carry several crossings (the leeward line is start, mark 2 and finish), and it
    // counts as live while ANY of them is: it is the same piece of water either way.
    const live = uses.some(({ step }) => client.isLive(step.index));
    out += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"`
      + ` stroke="${live ? ROLE_COLOUR.start : 'var(--line)'}" stroke-width="${live ? 3.5 : 2}"`
      + ` opacity="${live ? 1 : OVERVIEW_INK.ahead}"/>`;
  }

  const steps = client.steps.map((step) => ({
    crossings: step.crossings.map((c) => placed.get(`${step.index}:${c.line}`)).filter(Boolean),
  }));
  for (const segment of track(steps, { closed: !!client.snapshot.closed })) {
    const crossing = segment.kind === 'crossing';
    out += `<path d="${segment.d}" fill="none" stroke="${crossing ? 'var(--muted)' : ROLE_COLOUR.leg}"`
      + ` stroke-width="${OVERVIEW_INK.trackWidth}" opacity="${OVERVIEW_INK.track}"`
      + ` stroke-dasharray="${crossing ? 'none' : '4,4'}"/>`;
  }

  client.steps.forEach((step) => {
    const done = client.crossings.some((c) => c.step === step.index && c.lap === client.lap);
    // BEFORE A CYCLE'S START EVERY ENTRY LINE IS LIVE, because the boat may begin at any of
    // them — marking one would be the picture making a choice the boat has not made. See
    // `RaceClient.isLive`.
    const live = client.isLive(step.index);
    for (const crossing of step.crossings) {
      const shape = placed.get(`${step.index}:${crossing.line}`);
      if (!shape) continue;
      const colour = live ? ROLE_COLOUR.start : done ? 'var(--muted)' : ROLE_COLOUR.leg;
      out += `<polygon points="${shape.points}" fill="${colour}"`
        + ` opacity="${live ? 1 : done ? OVERVIEW_INK.done : OVERVIEW_INK.ahead}"/>`;
      out += `<text x="${shape.label.x.toFixed(1)}" y="${(shape.label.y + 4).toFixed(1)}" text-anchor="middle" font-family="var(--mono)" font-size="${LABEL.fontPx}" fill="var(--sea)">${esc(step.letter)}</text>`;
    }
  });

  /*
   * THE TRACK SINCE THE LAST LINE, drawn behind the boat.
   *
   * It answers the question the course drawing cannot: not *where does the leg go* but *where
   * have I actually been on it* — how far off the rhumb line the last tack put you, whether the
   * lift held, where you crossed the one before. It stops at the mark it came from, because a
   * track that ran back through the whole race would draw the course a second time in a colour
   * that means something else.
   *
   * In the boat's OWN ink rather than in any of the course's colours: those mean leg role
   * (green, blue, red) and this is not a leg, and the cyan dashes are the COG, which is where
   * the boat is going rather than where it has been. Solid, thin, and under the hull.
   */
  if ((client.legTrack ?? []).length > 1) {
    const d = client.legTrack
      .map((p, i) => { const q = to(p); return `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`; })
      .join(' ');
    out += `<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="${OVERVIEW_INK.trailWidth}"`
      + ` stroke-linecap="round" stroke-linejoin="round" opacity="${OVERVIEW_INK.trail}"/>`;
  }

  if (client.point) {
    const px = to(client.point);
    // THE COG, RUN OUT AS FAR AS THE PICTURE GOES. On the approach screen the projection stops
    // where it cuts the line, because there the question is where on THAT line it lands. Here
    // the question is the other one — what is the boat pointing at — and the answer is only
    // legible if the line reaches whatever it is pointing at: the next mark, the far end of a
    // gate, the shore. Run to the viewport's diagonal so it leaves the picture whichever way
    // it runs, and clipped by the viewBox rather than by arithmetic.
    //
    // Forward only. A line drawn through the boat would show a back bearing nobody asked for,
    // and on a course where the boat has just turned it would point at the mark behind.
    if (client.fix?.cogDeg != null) {
      const theta = ((client.fix.cogDeg - up) * Math.PI) / 180;
      const far = Math.hypot(width, height);
      const end = { x: px.x + Math.sin(theta) * far, y: px.y - Math.cos(theta) * far };
      out += `<line x1="${px.x.toFixed(1)}" y1="${px.y.toFixed(1)}"`
        + ` x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" stroke="var(--cog)"`
        + ` stroke-width="${OVERVIEW_INK.cogWidth}" stroke-dasharray="7,6"`
        + ` opacity="${OVERVIEW_INK.cog}"/>`;
    }
    // Turned by its COG less whatever is at the top, so the boat points its true way round
    // at North up and straight up the leg at Leg up. The same hull the approach draws, at a
    // fixed size: an overview is fitted to a whole course, so a boat to scale would be a
    // pixel on a long passage leg and a monster on a short windward/leeward.
    out += boatArt(px.x, px.y, (client.fix?.cogDeg ?? 0) - up, OVERVIEW_BOAT_PX);
  }

  out += northPointer(up, width);
  return `<svg class="plot" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}

/**
 * The race clock: when the boat started, when it finished, and how long it took.
 *
 * <b>Nothing at all until it has started</b>, because before that there is no elapsed time to
 * show and a zero would be a claim. Once the start line is behind, the instant it was crossed
 * and a clock running from it; once the finish is behind, both instants and a total that has
 * stopped moving — which is the moment the number turns from a reading into a result.
 *
 * <b>That moment is marked by the COLOUR, not by the label.</b> The label said
 * "Elapsed — final", written with an `&mdash;` and then put through `esc` like every other
 * label — which escaped the ampersand and printed the entity, so the screen read
 * "ELAPSED &MDASH; FINAL". The right fix is not to escape it less: a label is text, `esc` is
 * correct, and a label that has to carry markup is a label saying too much. `.readout.done`
 * already turns the whole row green when the clock has stopped, which says *result* at a
 * glance and in the place somebody is already looking — the number itself.
 *
 * The instants come off the interpolated crossings rather than off the fixes that confirmed
 * them. That is the entire reason the crossing detector interpolates, and showing a fix time
 * here would throw the precision away at the last step.
 */
export function timingRow(client, now = Date.now()) {
  if (!client.startAt) {
    return '<div class="readout"><div><div class="label">Elapsed</div>'
      + '<div class="value">&mdash;</div></div></div>';
  }
  const done = client.complete();
  const cell = (label, value) =>
    `<div><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`;
  return `<div class="readout${done ? ' done' : ''}">
    ${cell('Started', hhmmss(client.startAt))}
    ${done ? cell('Finished', hhmmss(client.finishAt)) : ''}
    ${cell('Elapsed', clock(client.elapsed(now)))}
  </div>`;
}

/**
 * What the receiver is doing, said out loud, and only when it is not doing it well.
 *
 * A screen that quietly keeps showing the last good numbers while every new fix is being
 * thrown away is telling the sailor that everything is fine. It is the one state where the
 * application knows something is wrong and the person cannot see it, so it says how long it
 * has been, how many fixes went in the bin and why the most recent one did.
 */
export function signalLine(client, now = Date.now()) {
  if (!client.stale(now) && client.sinceGood === 0) return '';
  const since = client.sinceFix(now);
  const last = client.rejects[client.rejects.length - 1];
  if (client.sinceGood > 0) {
    return `<p class="signal warn">No usable fix for ${Math.round((since ?? 0) / 1000)} s &mdash; `
      + `${client.sinceGood} rejected. ${esc(last?.reason ?? '')}</p>`;
  }
  return `<p class="signal warn">No fix for ${Math.round((since ?? 0) / 1000)} s.</p>`;
}

/** The overview's header and the list of what has been crossed so far. */
export function overviewPanel(client, options = {}) {
  const now = options.now ?? Date.now();
  const step = client.live();
  const waypoint = client.waypoint();
  const range = distanceTo(waypoint?.distanceM);
  const stale = client.stale(now);
  return `
    <div class="bar">
      <span class="mono">${esc(hhmmss(client.fix?.time))}</span>
      <span class="mono muted">GPS ${client.fix?.satellites ?? '—'} SV</span>
      <span class="sp"></span>
      <strong class="disp">${esc(client.snapshot.name ?? client.snapshot.course)}</strong>
      <span class="mono muted">${esc(client.snapshot.revision)}</span>
    </div>
    ${viewBar(options.viewMode ?? 'auto', options)}
    ${orientationBar(options.orientation ?? 'north')}
    ${overview(client, options)}
    ${chartBar(options)}
    ${waypointRow(waypoint)}
    <!--
      BTW and DTW get a line to themselves, at twice the size. They are what the course screen
      is FOR — which way, and how far — and they were sharing a row with two numbers that are
      not: speed, which the boat can feel and which says nothing about where it is going, and
      elapsed, which matters once at the end. Sharing made all four small enough to need
      looking at rather than glancing at.
    -->
    <div class="steer${stale ? ' stale' : ''}">
      <!--
        THE DEGREE SIGN IS PART OF THE NUMBER, not a unit beside it. A unit is set small, and a
        small ring shares its baseline with the digits — beside a figure this size it sits in
        the bottom third and reads as a decimal point, which turns a bearing into a fraction.
        At the digits' own size it lands where the type designer put it. "nm" and "m" stay
        units, because that is what they are.
      -->
      <div><div class="label">BTW</div><div class="value">${deg(waypoint?.bearingDeg)}&deg;</div></div>
      <div><div class="label">DTW</div><div class="value">${range.value}<span class="unit">${range.unit}</span></div></div>
    </div>
    ${timingRow(client, now)}
    ${signalLine(client, now)}
    <p class="status${client.complete() ? ' crossed' : ''}">${client.finished
      ? `Finished ${esc(hhmmss(client.finishAt))} in ${clock(client.elapsed(now))}, `
        + `${client.crossings.length} crossings latched.`
      : client.starting
        // A CYCLE IS STARTED AT WHICHEVER ENTRY LINE THE BOAT CROSSES FIRST, so the sentence
        // says what the boat is being offered rather than naming a mark it is "sailing to".
        // The lines themselves are marked on the picture above it, all of them.
        ? `Start at any of the ${client.entries.length} marked lines. The clock runs from the`
          + ' one you cross, and that same line finishes the lap.'
        : step
          ? `Sailing to mark ${esc(client.atFinish() ? 'F' : step.letter)}${client.atFinish()
            ? ' — the line you started on, which finishes the lap'
            : client.snapshot.closed ? `, lap ${client.lap}` : ''}. The Mark screen comes up on its own.`
          : 'Waiting for a fix.'}</p>
    ${client.crossings.length === 0 ? '' : `<ul class="crossings mono">${client.crossings.slice().reverse().map((c) =>
      `<li><span class="ok">&check;</span> ${esc(c.letter)} &middot; ${esc(c.line)} &middot; ${esc(hhmmss(c.time))}${c.lap > 1 ? ` &middot; lap ${c.lap}` : ''}</li>`).join('')}</ul>`}`;
}

export { esc, fmt, deg };
