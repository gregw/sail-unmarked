/*
 * THE FRONT PAGE'S COURSE DISPLAY: every public course that has something published, and every
 * public template, chosen by club, series and course, and drawn north up on the plain chart,
 * fitted to the course.
 *
 * What is drawn is the PUBLISHED SNAPSHOT — what a boat joining it is handed — and not the file,
 * which may have moved on; a template, which is never published, is drawn as the file has it now.
 * Either holds only the lines its course crosses, so there are no unused lines to hide. Drawn by
 * the overview the boat itself uses (`markscreen.overview`), with no boat on it: one drawing of a
 * course.
 */

import { overview } from './markscreen.js';
import { RaceClient } from './raceclient.js';
import { personalise } from './handicap.js';
import { showWhoami } from './whoami.js';

/** The chart at full strength: here it is the picture, not something under a boat's screen. */
const HOME_INK = 1;

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

/**
 * Each published variant and each template of each public course, flattened: what the third
 * selector lists, with where its geometry is read from.
 */
function flatten(courses) {
  const out = [];
  for (const course of courses) {
    const published = course.published ?? [];
    const templates = course.templates ?? [];
    const named = course.name ?? course.course;
    // The variant named only where the course has more than one: a course with a single design
    // is just the course. A template always says so, being a design nobody can join.
    const many = published.length + templates.length > 1;
    for (const variant of published) {
      out.push({
        club: course.club, series: course.series, course: course.course, variant: variant.variant,
        url: `/api/courses/${encodeURIComponent(variant.revision)}`,
        notes: course.notes ?? null,
        label: many ? `${named} \u2014 ${variant.name ?? variant.variant}` : named,
      });
    }
    for (const variant of templates) {
      out.push({
        club: course.club, series: course.series, course: course.course, variant: variant.variant,
        url: ['/api/public', course.club, course.series, course.course, variant.variant]
          .map((part, i) => (i ? encodeURIComponent(part) : part)).join('/'),
        notes: course.notes ?? null,
        label: `${many ? `${named} \u2014 ${variant.name ?? variant.variant}` : named} (template)`,
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

/** The course's own notes, under the chart, where it has any. */
function showNotes(offer) {
  const notes = el('h_notes');
  if (!notes) return;
  const text = (offer?.notes ?? '').trim();
  notes.hidden = !text;
  notes.textContent = text;
}

async function show() {
  const offer = renderSelectors();
  showNotes(offer);
  state.snapshot = null;
  if (!offer) {
    el('h_chart').innerHTML = '<p class="muted">No public course has been published yet.</p>';
    return;
  }
  try {
    const response = await fetch(offer.url);
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
    /*
     * A HANDICAP LINE AS THE EDITOR SHOWS IT: the striped rectangle every boat's line may lie in,
     * with the midpoint boat's line across it. Placed for the midpoint TCF, which is the one TCF
     * every handicapped course can take.
     */
    const mid = state.snapshot.tcfMid > 0 ? state.snapshot.tcfMid : 1;
    client = new RaceClient(personalise(state.snapshot, mid));
  } catch (error) {
    host.innerHTML = `<p class="warn">${esc(error.message)}</p>`;
    return;
  }
  const width = Math.max(260, Math.round(host.clientWidth || 600));
  // At least the usual proportion, and down to the bottom of the window where it is taller,
  // less whatever stands below it — the course's notes, the footer — so those stay in view.
  // Measured from the top of the PAGE, so it is the same height wherever the page is scrolled.
  const least = Math.round(Math.min(width * 0.7, 520));
  const box = host.getBoundingClientRect?.() ?? {};
  const top = (box.top ?? 0) + (window.scrollY ?? 0);
  const bottom = box.bottom ?? (box.top ?? 0) + (box.height ?? 0);
  // Whatever stands below the chart — its panel's padding and border, the page's own — measured
  // rather than assumed, so a change of style cannot push the page into a scroll.
  const below = Math.max(0, (document.documentElement?.scrollHeight ?? 0) - (bottom + (window.scrollY ?? 0)));
  const room = Math.floor((window.innerHeight ?? 0) - top - below);
  const height = Number.isFinite(room) ? Math.max(least, room) : least;
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
window.addEventListener('resize', () => {
  clearTimeout(resizing);
  resizing = setTimeout(draw, 150);
});

showWhoami();
// The site's own address, under the title: what to type, or pass on, to come back here.
const title = el('h_title');
if (title) title.title = globalThis.location?.origin ?? '';
load();
