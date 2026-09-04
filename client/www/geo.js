/**
 * Web Mercator projection, tile layers and a pannable/zoomable view, for drawing
 * course geometry over a chart.
 *
 * Lifted from the Geo panel of nemesis-delta, which solves this without a mapping
 * library: world coordinates in [0,1] so that OSM-scheme tiles align with plotted
 * positions, tiles emitted as plain SVG <image> elements, and the whole map rendered
 * as one SVG string per frame. There is no Leaflet here and there should not be — the
 * entire requirement is "put a chart behind some lines I am drawing myself", and a
 * mapping library would bring a second geometry model to disagree with the one in
 * crossing.js.
 *
 * WHAT IS NEW HERE is the inverse: {@link MapView#toPosition}. nemesis-delta only ever
 * projects forward, because it only displays. An editor has to turn a pixel the user
 * clicked back into a position, and that is the whole difference between a viewer and
 * an editor.
 *
 * NETWORK BOUNDARY. Tiles are fetched from the internet. That is fine here, because
 * the course editor is a shore-side activity at a desk. It must never leak into the
 * Mark screen, which is offline-first and non-negotiable: on the water, lines are drawn
 * on empty water or on pre-cached tiles, never a live fetch.
 */

import { RESOLUTION_M, resolve } from './crossing.js';

const M_PER_DEG_LAT = 111320;
const M_PER_NM = 1852;
const TILE_PX = 256;

const d2r = (d) => (d * Math.PI) / 180;
const r2d = (r) => (r * 180) / Math.PI;

/** Longitude to world x in [0,1]. */
export const mercX = (lon) => lon / 360 + 0.5;

/** Latitude to world y in [0,1]. Clamped to the Mercator limit. */
export function mercY(lat) {
  const s = Math.sin(d2r(Math.max(-85, Math.min(85, lat))));
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** World y back to latitude. */
export const invMercLat = (wy) => r2d(2 * Math.atan(Math.exp((0.5 - wy) * 2 * Math.PI)) - Math.PI / 2);

/** World x back to longitude. */
export const invMercLon = (wx) => (wx - 0.5) * 360;

/**
 * Round a position onto the system's one-metre grid.
 *
 * The resolution is declared in crossing.js and applies to every distance the system
 * computes; snapping stored coordinates to the same grid is its corollary. It also
 * makes the exported YAML readable — a surveyed mark written to twelve decimal places
 * claims a precision nobody has, and invites somebody to "tidy" a digit that matters.
 */
export function snap(position) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(d2r(position.latitude));
  const latStep = RESOLUTION_M / M_PER_DEG_LAT;
  const lonStep = RESOLUTION_M / (mPerDegLon || M_PER_DEG_LAT);
  return {
    latitude: Math.round(position.latitude / latStep) * latStep,
    longitude: Math.round(position.longitude / lonStep) * lonStep,
  };
}

/** Great-circle distance in metres, on the same one-metre grid as everything else. */
export function distanceM(a, b) {
  const R = 6371008.8;
  const lat1 = d2r(a.latitude);
  const lat2 = d2r(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = d2r(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return resolve(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Initial bearing in degrees true. */
export function bearingDeg(from, to) {
  const lat1 = d2r(from.latitude);
  const lat2 = d2r(to.latitude);
  const dLon = d2r(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (r2d(Math.atan2(y, x)) + 360) % 360;
}

/** Degrees and decimal minutes, which is what a chart and a plotter show. */
export function formatPosition(position) {
  const part = (value, positive, negative) => {
    const hemisphere = value >= 0 ? positive : negative;
    const abs = Math.abs(value);
    const degrees = Math.floor(abs);
    const minutes = (abs - degrees) * 60;
    return `${degrees}° ${minutes.toFixed(3).padStart(6, '0')}' ${hemisphere}`;
  };
  return `${part(position.latitude, 'N', 'S')}  ${part(position.longitude, 'E', 'W')}`;
}

/**
 * Bathymetry, coastline and shelf shading. Note this one is z/y/x, not z/x/y.
 *
 * Pulled out as its own constant because two basemaps are built from it: the seamark
 * overlay is a separate transparent layer stacked on top, so it can simply be left off.
 */
const OCEAN_BASE = {
  maxZoom: 13,
  url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/${z}/${y}/${x}`,
};

/**
 * Every navigation mark, light, beacon and buoy, as a transparent overlay.
 *
 * Invaluable when placing a virtual line — it shows the real marks and reefs the line is
 * defined relative to, and Sow and Pigs is on it. It is also a great deal of ink, and
 * once the marks are placed it competes with the course being drawn over the top. Hence
 * the two sea basemaps.
 */
const SEAMARKS = {
  maxZoom: 16,
  url: (z, x, y) => `https://tiles.openseamap.org/seamark/${z}/${x}/${y}.png`,
};

/**
 * The basemaps, in the order the selector offers them.
 *
 * `plain` draws nothing and fetches nothing, which is what the on-water screens use: the
 * Mark screen is offline-first and must never depend on a tile server.
 */
export const BASEMAPS = {
  sea: { label: 'Sea chart', layers: [OCEAN_BASE, SEAMARKS] },
  seaSimple: { label: 'Sea simple', layers: [OCEAN_BASE] },
  osm: { label: 'OSM', layers: [{ maxZoom: 18, url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` }] },
  plain: { label: 'Plain', layers: [] },
};

/**
 * A pannable, zoomable view onto the world, sized in pixels.
 *
 * Holds only view state — where we are looking and how closely. It knows nothing about
 * points, lines or courses, so the editor can render whatever it likes through it.
 */
export class MapView {
  constructor(width = 700, height = 500) {
    this.width = width;
    this.height = height;
    this.center = { wx: 0.5, wy: 0.5 };
    this.zoom = 13;
    this.minZoom = 3;
    this.maxZoom = 19;
  }

  /** Pixels per world unit. */
  scale() {
    return TILE_PX * Math.pow(2, this.zoom);
  }

  /** Position to pixels within the view. */
  toPx(position) {
    const s = this.scale();
    return [
      (mercX(position.longitude) - this.center.wx) * s + this.width / 2,
      (mercY(position.latitude) - this.center.wy) * s + this.height / 2,
    ];
  }

  /**
   * Pixels back to a position. The inverse nemesis-delta never needed.
   *
   * Not snapped: snapping is the caller's decision, because a drag in progress wants
   * the true position and only the committed value belongs on the grid.
   */
  toPosition(px, py) {
    const s = this.scale();
    const wx = (px - this.width / 2) / s + this.center.wx;
    const wy = (py - this.height / 2) / s + this.center.wy;
    return { latitude: invMercLat(wy), longitude: invMercLon(wx) };
  }

  /** Pixels per nautical mile at the centre latitude, for the scale bar. */
  pxPerNm() {
    const lat = invMercLat(this.center.wy);
    return Math.abs(mercY(lat + 1 / 60) - mercY(lat)) * this.scale();
  }

  /** Shift the view by a pixel delta — the drag handler. */
  panByPx(dx, dy) {
    const s = this.scale();
    this.center = { wx: this.center.wx - dx / s, wy: this.center.wy - dy / s };
  }

  /** Zoom about a pixel, so the position under the cursor stays under the cursor. */
  zoomAtPx(px, py, delta) {
    const before = this.toPosition(px, py);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + delta));
    const after = this.toPosition(px, py);
    this.center = {
      wx: this.center.wx + (mercX(before.longitude) - mercX(after.longitude)),
      wy: this.center.wy + (mercY(before.latitude) - mercY(after.latitude)),
    };
  }

  /** Frame a set of positions with a margin. A single position just centres. */
  fit(positions, margin = 0.8) {
    const usable = positions.filter((p) => p && p.latitude != null && p.longitude != null);
    if (usable.length === 0) return;
    const xs = usable.map((p) => mercX(p.longitude));
    const ys = usable.map((p) => mercY(p.latitude));
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    this.center = { wx: (x0 + x1) / 2, wy: (y0 + y1) / 2 };
    if (usable.length === 1) return;
    const spanX = Math.max(1e-9, x1 - x0);
    const spanY = Math.max(1e-9, y1 - y0);
    this.zoom = Math.max(
      this.minZoom,
      Math.min(
        this.maxZoom,
        Math.min(
          Math.log2((this.width * margin) / (TILE_PX * spanX)),
          Math.log2((this.height * margin) / (TILE_PX * spanY))
        )
      )
    );
  }

  /** The tile <image> elements for one layer, as an SVG string. */
  tileImages(layer, limit = 240) {
    const z = Math.max(2, Math.min(layer.maxZoom, Math.round(this.zoom)));
    const s = this.scale();
    const n = Math.pow(2, z);
    const radius = Math.hypot(this.width, this.height) / 2;
    const [wx0, wx1] = [this.center.wx - radius / s, this.center.wx + radius / s];
    const [wy0, wy1] = [this.center.wy - radius / s, this.center.wy + radius / s];
    const size = s / n;
    let out = '';
    let count = 0;
    for (let tx = Math.floor(wx0 * n); tx <= Math.floor(wx1 * n); tx++) {
      for (let ty = Math.floor(wy0 * n); ty <= Math.floor(wy1 * n); ty++) {
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
        if (++count > limit) return out;
        const px = (tx / n - this.center.wx) * s + this.width / 2;
        const py = (ty / n - this.center.wy) * s + this.height / 2;
        out += `<image href="${layer.url(z, tx, ty)}" x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${(size + 0.5).toFixed(2)}" height="${(size + 0.5).toFixed(2)}"/>`;
      }
    }
    return out;
  }

  /** Every layer of a basemap, in order. */
  tileLayer(basemap) {
    const spec = BASEMAPS[basemap] ?? BASEMAPS.plain;
    return spec.layers.map((layer) => this.tileImages(layer)).join('');
  }

  /** A scale bar in the bottom-left, in nautical miles. */
  scaleBar() {
    const ppn = this.pxPerNm();
    if (!isFinite(ppn) || ppn <= 0) return '';
    const nm = niceStep((this.width * 0.25) / ppn);
    const w = nm * ppn;
    const x = 14;
    const y = this.height - 16;
    const tick = (at) => `<line x1="${at}" y1="${y - 3}" x2="${at}" y2="${y + 3}" stroke="var(--muted)" stroke-width="2"/>`;
    return (
      `<line x1="${x}" y1="${y}" x2="${(x + w).toFixed(1)}" y2="${y}" stroke="var(--muted)" stroke-width="2"/>` +
      tick(x) +
      tick((x + w).toFixed(1)) +
      `<text x="${(x + w / 2).toFixed(1)}" y="${y - 6}" text-anchor="middle" font-family="var(--mono)" font-size="10" fill="var(--muted)">${+nm.toFixed(nm < 1 ? 2 : 0)} nm</text>`
    );
  }
}

/**
 * How far one wheel event should move the zoom.
 *
 * Taking a fixed step per EVENT is what made the chart uncontrollable: a mouse notch and
 * a trackpad flick are wildly different amounts of intent, and a trackpad sends dozens of
 * tiny events for one gesture, so a gentle two-finger nudge leapt several zoom levels.
 * Scaling by how far the wheel actually moved makes a notch a small repeatable step and a
 * trackpad glide smooth.
 *
 * Deltas arrive in three units, so they are normalised to pixels first. The result is
 * clamped so that a device reporting an enormous delta — some do — cannot jump the chart
 * across the world in one event.
 *
 * Positive is zoom IN: scrolling up (a negative deltaY) moves closer.
 */
export function wheelZoomStep(deltaY, deltaMode = 0) {
  const pixels = deltaY * (WHEEL_TO_PIXELS[deltaMode] ?? 1);
  return Math.max(-ZOOM_EVENT_LIMIT, Math.min(ZOOM_EVENT_LIMIT, -pixels * ZOOM_PER_PIXEL));
}

/**
 * Zoom levels per pixel of wheel travel. At 1/600 a typical mouse notch (100 px) is about
 * a sixth of a level, so six notches double the scale; a trackpad's 3-10 px events are
 * finer still.
 */
export const ZOOM_PER_PIXEL = 1 / 600;

/** The most one event may move the zoom, whatever the device claims. */
export const ZOOM_EVENT_LIMIT = 0.4;

/** DOM_DELTA_PIXEL, DOM_DELTA_LINE, DOM_DELTA_PAGE, as pixels. */
const WHEEL_TO_PIXELS = [1, 16, 400];

/** 1, 2 or 5 times a power of ten — the steps a scale bar is allowed to take. */
export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const scaled = raw / power;
  return (scaled >= 5 ? 5 : scaled >= 2 ? 2 : 1) * power;
}

export { M_PER_NM, TILE_PX };
