/**
 * The executable specification for geo.js.
 *
 * Same arrangement as crossing-test.js: one set of assertions, imported by both the
 * browser page and the Maven build rather than copied, so they cannot drift.
 *
 * The projection is lifted from working code, so most of what is worth pinning is the
 * part that is NEW — the inverse, which is what turns a viewer into an editor — and the
 * round-trip property that says the forward and inverse agree.
 */

import {
  BASEMAPS,
  MapView,
  bearingDeg,
  centre,
  distanceM,
  formatPosition,
  invMercLat,
  invMercLon,
  mercX,
  mercY,
  niceStep,
  rotateAbout,
  snap,
  translateBy,
  wheelZoomStep,
  ZOOM_EVENT_LIMIT,
} from './geo.js';

// Sydney Harbour, roughly. Values are for exercising geometry and claim nothing.
const HARBOUR = { latitude: -33.82, longitude: 151.27 };

export function run(check) {
  // ------------------------------------------------------------- the projection
  check('the prime meridian is the middle of the world', mercX(0) === 0.5);
  check('the equator is the middle of the world', Math.abs(mercY(0) - 0.5) < 1e-12);
  check('east is increasing world x', mercX(151) > mercX(150));
  check('north is DECREASING world y, as tile schemes have it', mercY(10) < mercY(0));

  check('longitude round-trips', Math.abs(invMercLon(mercX(151.27)) - 151.27) < 1e-9);
  check('latitude round-trips', Math.abs(invMercLat(mercY(-33.82)) + 33.82) < 1e-9);

  // Mercator is undefined at the poles, so the input is clamped rather than infinite.
  check('the projection is finite at the north pole', isFinite(mercY(90)));
  check('the projection is finite at the south pole', isFinite(mercY(-90)));

  // ---------------------------------------------------------- the view transform
  const view = new MapView(800, 600);
  view.center = { wx: mercX(HARBOUR.longitude), wy: mercY(HARBOUR.latitude) };
  view.zoom = 14;

  const [cx, cy] = view.toPx(HARBOUR);
  check('the centre position lands in the middle of the view', Math.abs(cx - 400) < 0.01 && Math.abs(cy - 300) < 0.01);

  // THE INVERSE. This is the function nemesis-delta never needed, because it only
  // displays; an editor has to turn a click back into a position.
  const back = view.toPosition(400, 300);
  check('the centre pixel inverts to the centre position',
    Math.abs(back.latitude - HARBOUR.latitude) < 1e-9 && Math.abs(back.longitude - HARBOUR.longitude) < 1e-9);

  const somewhere = view.toPosition(613, 197);
  const [rx, ry] = view.toPx(somewhere);
  check('pixel -> position -> pixel round-trips', Math.abs(rx - 613) < 0.01 && Math.abs(ry - 197) < 0.01);

  check('north is up on screen', view.toPosition(400, 100).latitude > view.toPosition(400, 500).latitude);
  check('east is right on screen', view.toPosition(700, 300).longitude > view.toPosition(100, 300).longitude);

  // ------------------------------------------------------------ pan and zoom
  const panned = new MapView(800, 600);
  panned.center = { wx: mercX(151.27), wy: mercY(-33.82) };
  panned.zoom = 14;
  const beforePan = panned.toPosition(400, 300);
  panned.panByPx(100, 0);
  check('dragging right moves the view west', panned.toPosition(400, 300).longitude < beforePan.longitude);

  // Zooming about the cursor must leave the position under the cursor unmoved. This is
  // the property that makes a map feel right, and the easiest one to get subtly wrong.
  const zoomed = new MapView(800, 600);
  zoomed.center = { wx: mercX(151.27), wy: mercY(-33.82) };
  zoomed.zoom = 14;
  const underCursor = zoomed.toPosition(600, 200);
  zoomed.zoomAtPx(600, 200, 1.5);
  const stillUnderCursor = zoomed.toPosition(600, 200);
  check('zooming about a pixel holds that position under the cursor',
    Math.abs(stillUnderCursor.latitude - underCursor.latitude) < 1e-9 &&
    Math.abs(stillUnderCursor.longitude - underCursor.longitude) < 1e-9);
  check('...and actually changed the zoom', zoomed.zoom === 15.5);

  const clamped = new MapView(800, 600);
  clamped.zoomAtPx(400, 300, 99);
  check('zoom is clamped at the top', clamped.zoom === clamped.maxZoom);
  clamped.zoomAtPx(400, 300, -99);
  check('zoom is clamped at the bottom', clamped.zoom === clamped.minZoom);

  // ------------------------------------------------------------ the wheel rate
  // A fixed step per EVENT was what made the chart uncontrollable: a trackpad sends
  // dozens of tiny events for one gesture, so a gentle nudge leapt several zoom levels.
  const notch = wheelZoomStep(-100, 0);
  check('scrolling up zooms in', notch > 0);
  check('scrolling down zooms out', wheelZoomStep(100, 0) < 0);
  check('one mouse notch is a fraction of a zoom level', notch > 0.05 && notch < 0.25);
  check('six notches are about one zoom level', Math.abs(notch * 6 - 1) < 0.05);

  // A trackpad's small deltas must stay proportionally small, and add up smoothly.
  const flick = wheelZoomStep(-5, 0);
  check('a small trackpad delta is a small step', flick > 0 && flick < notch / 10);
  check('...and twenty of them are still gentle', flick * 20 < 0.35);
  check('the response is linear in wheel travel', Math.abs(wheelZoomStep(-50, 0) * 2 - notch) < 1e-9);

  // Devices report deltas in three different units. Firefox's line mode must not end up
  // sixteen times too slow.
  check('line-mode deltas are scaled to pixels', Math.abs(wheelZoomStep(-3, 1) - wheelZoomStep(-48, 0)) < 1e-9);
  check('page-mode deltas are too', Math.abs(wheelZoomStep(-1, 2) - wheelZoomStep(-400, 0)) < 1e-9);
  check('an unknown delta mode is treated as pixels', wheelZoomStep(-100, 9) === wheelZoomStep(-100, 0));

  // Some devices report enormous deltas; one event must never cross the world.
  check('a huge delta is clamped', wheelZoomStep(-100000, 0) === ZOOM_EVENT_LIMIT);
  check('...in both directions', wheelZoomStep(100000, 0) === -ZOOM_EVENT_LIMIT);
  check('the clamp is under half a zoom level', ZOOM_EVENT_LIMIT < 0.5);
  check('no wheel movement, no zoom', wheelZoomStep(0, 0) === 0);

  // ---------------------------------------------------------------- fitting
  const fitted = new MapView(800, 600);
  const nw = { latitude: -33.80, longitude: 151.25 };
  const se = { latitude: -33.84, longitude: 151.29 };
  fitted.fit([nw, se]);

  // Centred ON SCREEN, which is the requirement — and deliberately not centred on the
  // mean latitude, which is a different thing. Mercator is nonlinear in latitude, so
  // the world-space midpoint of these two corners is 33.82°S plus about 26 cm. Asserting
  // the latitude midpoint would be asserting a subtly wrong map.
  const [nwx, nwy] = fitted.toPx(nw);
  const [sex, sey] = fitted.toPx(se);
  check('fitting centres the bounds on screen',
    Math.abs((nwx + sex) / 2 - 400) < 0.01 && Math.abs((nwy + sey) / 2 - 300) < 0.01);
  check('...and both corners are on screen', nwx > 0 && nwx < 800 && nwy > 0 && nwy < 600);
  check('...to within a metre of the latitude midpoint anyway',
    distanceM(fitted.toPosition(400, 300), { latitude: -33.82, longitude: 151.27 }) <= 1);

  const single = new MapView(800, 600);
  single.zoom = 12;
  single.fit([HARBOUR]);
  check('fitting one position centres without changing zoom', single.zoom === 12);
  check('...and centres on it', Math.abs(single.toPosition(400, 300).latitude - HARBOUR.latitude) < 1e-9);

  const nothing = new MapView(800, 600);
  const wasZoom = nothing.zoom;
  nothing.fit([null, { latitude: null, longitude: null }]);
  check('fitting nothing surveyed leaves the view alone', nothing.zoom === wasZoom);

  // ------------------------------------------------------- the one-metre grid
  const snapped = snap({ latitude: -33.8012345678, longitude: 151.2734567891 });
  check('snapping lands on the one-metre grid', distanceM(snapped, { latitude: -33.8012345678, longitude: 151.2734567891 }) <= 1);
  check('snapping is idempotent', snap(snapped).latitude === snapped.latitude);
  check('a snapped coordinate is short enough to read',
    snapped.latitude.toFixed(6).length <= 11);

  // -------------------------------------------------------- distance and bearing
  // One minute of latitude is one nautical mile, near enough, and it is the check a
  // navigator would make.
  const oneMinuteNorth = { latitude: HARBOUR.latitude + 1 / 60, longitude: HARBOUR.longitude };
  check('one minute of latitude is about 1852 m', Math.abs(distanceM(HARBOUR, oneMinuteNorth) - 1852) < 5);
  check('distances are on the one-metre grid', Number.isInteger(distanceM(HARBOUR, oneMinuteNorth)));
  check('a position is no distance from itself', distanceM(HARBOUR, HARBOUR) === 0);

  check('due north is 000', Math.abs(bearingDeg(HARBOUR, oneMinuteNorth)) < 0.01);
  check('due east is 090', Math.abs(bearingDeg(HARBOUR, { ...HARBOUR, longitude: HARBOUR.longitude + 0.01 }) - 90) < 0.1);
  check('due south is 180', Math.abs(bearingDeg(HARBOUR, { ...HARBOUR, latitude: HARBOUR.latitude - 0.01 }) - 180) < 0.01);
  check('bearings are never negative', bearingDeg(HARBOUR, { ...HARBOUR, longitude: HARBOUR.longitude - 0.01 }) > 0);

  // ------------------------------------------------------------------ display
  // Degrees and decimal minutes belongs on screen, in both directions, where a bad
  // transcription can be caught by the person who made it. Never in a file.
  check('a southern latitude reads S', formatPosition({ latitude: -33.8, longitude: 151.2 }).includes('S'));
  check('an eastern longitude reads E', formatPosition({ latitude: -33.8, longitude: 151.2 }).includes('E'));
  check('the format is degrees and decimal minutes', /^\d+° \d\d\.\d\d\d' S/.test(formatPosition({ latitude: -33.8, longitude: 151.2 })));
  check('a northern latitude reads N', formatPosition({ latitude: 33.8, longitude: -151.2 }).includes('N'));
  check('a western longitude reads W', formatPosition({ latitude: 33.8, longitude: -151.2 }).includes('W'));

  // --------------------------------------------------------------- basemaps
  check('the plain basemap fetches nothing', BASEMAPS.plain.layers.length === 0);
  check('the sea chart carries the seamark overlay',
    BASEMAPS.sea.layers.some((l) => l.url(14, 1, 2).includes('openseamap')));
  // The whole point of the second sea basemap: the marks are a separate transparent
  // layer, so leaving it off gives the same chart without the buoys and lights.
  check('sea simple drops the seamarks',
    BASEMAPS.seaSimple.layers.every((l) => !l.url(14, 1, 2).includes('openseamap')));
  check('...but keeps the same ocean base',
    BASEMAPS.seaSimple.layers[0].url(14, 1, 2) === BASEMAPS.sea.layers[0].url(14, 1, 2));
  check('...and is exactly one layer lighter',
    BASEMAPS.seaSimple.layers.length === BASEMAPS.sea.layers.length - 1);
  check('the ocean base is z/y/x, not z/x/y', BASEMAPS.sea.layers[0].url(14, 111, 222).endsWith('/14/222/111'));
  check('every basemap has a label the selector can show',
    Object.values(BASEMAPS).every((b) => typeof b.label === 'string' && b.label.length > 0));

  const tiles = view.tileLayer('sea');
  check('the sea chart emits tiles', tiles.includes('<image'));
  check('sea simple emits fewer of them',
    (view.tileLayer('seaSimple').match(/<image/g) || []).length
      < (tiles.match(/<image/g) || []).length);
  check('the plain basemap emits none', view.tileLayer('plain') === '');
  check('an unknown basemap is plain rather than an error', view.tileLayer('nonsense') === '');

  // A runaway tile count is a hang and a lot of requests, so it is bounded.
  const wide = new MapView(4000, 4000);
  wide.zoom = 19;
  check('the tile count is bounded', (wide.tileLayer('osm').match(/<image/g) || []).length <= 240);

  // ------------------------------------------------------------- the scale bar
  check('the scale bar steps by 1, 2 or 5', [1, 2, 5].includes(niceStep(3) / Math.pow(10, Math.floor(Math.log10(niceStep(3))))));
  check('nice steps round down', niceStep(3) === 2);
  check('...and handle powers of ten', niceStep(0.03) === 0.02);
  check('...and never return zero', niceStep(0) > 0);
  check('the scale bar renders', view.scaleBar().includes('nm'));
}

/**
 * Framing, which is what a selected line uses. Kept apart from the assertions above
 * because it is about the FRACTION rather than about the projection.
 */
export function runFraming(check) {
  const a = { latitude: -33.8100, longitude: 151.2700 };
  const b = { latitude: -33.8140, longitude: 151.2760 };

  for (const fraction of [0.2, 0.5, 0.8]) {
    const view = new MapView(1000, 800);
    view.fit([a, b], fraction);
    const [ax, ay] = view.toPx(a);
    const [bx, by] = view.toPx(b);
    const spanX = Math.abs(bx - ax);
    const spanY = Math.abs(by - ay);
    const widest = Math.max(spanX / view.width, spanY / view.height);
    // The longer axis of the line fills exactly the requested fraction; the shorter one
    // fills less, which is what "fits inside a centred box" means.
    check(`at ${fraction}, the line fills that fraction of the chart`, Math.abs(widest - fraction) < 0.01);
    check(`at ${fraction}, it is centred`, Math.abs((ax + bx) / 2 - 500) < 0.5 && Math.abs((ay + by) / 2 - 400) < 0.5);
    check(`at ${fraction}, both ends are on screen`, ax > 0 && ax < 1000 && bx > 0 && bx < 1000);
  }

  // The point of the change: a fifth shows far more water than four fifths.
  const tight = new MapView(1000, 800);
  tight.fit([a, b], 0.8);
  const wide = new MapView(1000, 800);
  wide.fit([a, b], 0.2);
  check('framing to a fifth is two zoom levels further out', Math.abs((tight.zoom - wide.zoom) - 2) < 0.01);

  // A line whose ends nearly coincide must not zoom to the maximum and show nothing.
  const tiny = new MapView(1000, 800);
  tiny.fit([a, { ...a, latitude: a.latitude + 0.000001 }], 0.2);
  check('a near-zero line is still clamped to a sane zoom', tiny.zoom <= tiny.maxZoom);
}

/**
 * Turning a course about a point.
 *
 * The trap this pins: rotating latitude and longitude directly squashes the shape, because
 * a degree of longitude is shorter than a degree of latitude everywhere but the equator.
 */
export function runTransform(check) {
  const about = { latitude: -33.8, longitude: 151.27 };
  const k = Math.cos((about.latitude * Math.PI) / 180);

  check('the centre is the middle of the extent, not the mean', (() => {
    const c = centre([
      { latitude: -33.9, longitude: 151.2 },
      { latitude: -33.7, longitude: 151.4 },
      { latitude: -33.7, longitude: 151.4 },
    ]);
    return Math.abs(c.latitude - -33.8) < 1e-12 && Math.abs(c.longitude - 151.3) < 1e-12;
  })());

  check('a full turn is the identity', (() => {
    const p = { latitude: -33.7, longitude: 151.4 };
    const back = rotateAbout(p, about, 360);
    return Math.abs(back.latitude - p.latitude) < 1e-9
      && Math.abs(back.longitude - p.longitude) < 1e-9;
  })());

  check('the centre itself does not move',
    Math.abs(rotateAbout(about, about, 37).latitude - about.latitude) < 1e-12);

  // Due north of the centre, turned 90° CLOCKWISE, must end up due east of it.
  const north = { latitude: about.latitude + 0.05, longitude: about.longitude };
  const east = rotateAbout(north, about, 90);
  check('90 degrees clockwise takes north to east',
    Math.abs(east.latitude - about.latitude) < 1e-9 && east.longitude > about.longitude);

  // And at the SAME distance — which is the whole point of the metric frame.
  check('...without squashing the shape',
    Math.abs(distanceM(about, north) - distanceM(about, east)) <= 1);

  check('a degree of longitude is the shorter one, so the frame scales it',
    Math.abs((east.longitude - about.longitude) * k - 0.05) < 1e-9);

  check('turning back undoes it', (() => {
    const p = { latitude: -33.71, longitude: 151.33 };
    const there = rotateAbout(p, about, 47);
    const back = rotateAbout(there, about, -47);
    return Math.abs(back.latitude - p.latitude) < 1e-9
      && Math.abs(back.longitude - p.longitude) < 1e-9;
  })());

  check('a rotation keeps every distance between marks', (() => {
    const a = { latitude: -33.75, longitude: 151.25 };
    const b = { latitude: -33.85, longitude: 151.31 };
    const before = distanceM(a, b);
    const after = distanceM(rotateAbout(a, about, 123), rotateAbout(b, about, 123));
    return Math.abs(before - after) <= 2;
  })());

  check('translation moves both ends by the same amount', (() => {
    const a = translateBy({ latitude: -33.75, longitude: 151.25 }, 0.01, -0.02);
    return Math.abs(a.latitude - -33.74) < 1e-12 && Math.abs(a.longitude - 151.23) < 1e-12;
  })());

  check('an unplaced position survives untouched',
    rotateAbout({ latitude: null, longitude: null }, about, 90).latitude === null);
}

