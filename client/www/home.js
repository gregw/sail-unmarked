/*
 * THE FRONT PAGE'S COURSE DISPLAY: every public course that has something published, chosen by
 * club, series and course, and drawn north up on the plain chart, fitted to the course.
 *
 * What is drawn is the PUBLISHED SNAPSHOT — what a boat joining it is handed — and not the file,
 * which may have moved on. A snapshot holds only the lines its course crosses, so there are no
 * unused lines to hide. Drawn by the overview the boat itself uses (`markscreen.overview`), with
 * no boat on it: one drawing of a course.
 */

import { overview } from './markscreen.js';
import { RaceClient } from './raceclient.js';

/** How strongly the chart is drawn here: brighter than on the water, where it sits under a boat. */
const HOME_INK = 0.6;

const el = (id) => document.getElementById(id);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (c) => ESC[c]);

const state = {
  offers: [],      // one per published variant of a public course
  club: null,
  series: null,
  offer: null,     // `${course}/${variant}`
  snapshot: null,
};

/** Each published variant of each public course, flattened: what the third selector lists. */
function flatten(courses) {
  const out = [];
  for (const course of courses) {
    for (const variant of course.published ?? []) {
      out.push({
        club: course.club, series: course.series, course: course.course, variant: variant.variant,
        revision: variant.revision,
        // The variant named only where the course has more than one: a course with a single
        // design is just the course.
        label: (course.published.length > 1
          ? `${course.name ?? course.course} — ${variant.name ?? variant.variant}`
          : (course.name ?? course.course)),
      });
    }
  }
  return out;
}

const unique = (values) => [...new Set(values)];

/** A level's choice kept while it is still on offer, and otherwise the first that is. */
const keep = (chosen, values) => (values.includes(chosen) ? chosen : values[0] ?? null);

function options(values, chosen, label = (v) => v) {
  return values.map((v) => `<option value="${esc(v)}"${v === chosen ? ' selected' : ''}>${esc(label(v))}</option>`).join('');
}

function renderSelectors() {
  const clubs = unique(state.offers.map((o) => o.club));
  state.club = keep(state.club, clubs);
  const series = unique(state.offers.filter((o) => o.club === state.club).map((o) => o.series));
  state.series = keep(state.series, series);
  const here = state.offers.filter((o) => o.club === state.club && o.series === state.series);
  const keys = here.map((o) => `${o.course}/${o.variant}`);
  state.offer = keep(state.offer, keys);
  const byKey = new Map(here.map((o) => [`${o.course}/${o.variant}`, o]));

  const level = (id, values, chosen, label) => {
    el(id).innerHTML = options(values, chosen, label);
    el(id).disabled = values.length === 0;
  };
  level('h_club', clubs, state.club);
  level('h_series', series, state.series);
  level('h_course', keys, state.offer, (k) => byKey.get(k).label);
  return byKey.get(state.offer) ?? null;
}

async function show() {
  const offer = renderSelectors();
  state.snapshot = null;
  if (!offer) {
    el('h_chart').innerHTML = '<p class="muted">No public course has been published yet.</p>';
    return;
  }
  try {
    const response = await fetch(`/api/courses/${encodeURIComponent(offer.revision)}`);
    if (!response.ok) throw new Error(`${response.status}`);
    const snapshot = await response.json();
    // A later choice may have overtaken this read.
    if (renderSelectors() !== offer) return;
    state.snapshot = snapshot;
    draw();
  } catch (error) {
    el('h_chart').innerHTML = `<p class="warn">Could not read the course: ${esc(error.message)}</p>`;
  }
}

function draw() {
  if (!state.snapshot) return;
  const host = el('h_chart');
  let client;
  try {
    client = new RaceClient(state.snapshot);
  } catch (error) {
    host.innerHTML = `<p class="warn">${esc(error.message)}</p>`;
    return;
  }
  const width = Math.max(260, Math.round(host.clientWidth || 600));
  const height = Math.round(Math.min(width * 0.7, 520));
  host.innerHTML = overview(client, {
    width, height, orientation: 'north', basemap: 'chart', basemapInk: HOME_INK,
  });
}

async function load() {
  try {
    state.offers = flatten(await (await fetch('/api/public')).json());
  } catch (error) {
    el('h_chart').innerHTML = `<p class="warn">Could not read the public courses: ${esc(error.message)}</p>`;
    return;
  }
  await show();
}

el('h_club').addEventListener('change', (ev) => { state.club = ev.target.value; show(); });
el('h_series').addEventListener('change', (ev) => { state.series = ev.target.value; show(); });
el('h_course').addEventListener('change', (ev) => { state.offer = ev.target.value; show(); });
// Fitted to the width it has, so drawn again when that changes.
let resizing = null;
globalThis.addEventListener?.('resize', () => {
  clearTimeout(resizing);
  resizing = setTimeout(draw, 150);
});

load();
