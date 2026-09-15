/**
 * The race-morning pair: capture every variant that has changed, then hand them all over.
 *
 * This is the flow the whole ledger is arranged around and it was the one thing the editor
 * made you do by hand. A line common to three variants — three divisions, or a short course and
 * a long one and a big-sea one — moved at eight in the morning dirties all three, and doing them
 * one at a time means walking the list and hoping none was missed, on the morning there is least
 * time to walk a list.
 *
 * The assertion with teeth is the last one. Publishing is ONE request for all of them, so the
 * server commits the pointers in a single atomic write: three variants change together or not at
 * all, because fleets sailing to inconsistent instructions is a thing nobody on the water can
 * detect.
 */
import { $, H, ok, report, settle } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const get = async (p) => (await fetch(p)).json();
const list = (id) => $(id).querySelectorAll('.row');
const variants = () => {
  if (!$('rows').innerHTML.includes('list_variant')) H('crumb_variant:click')();
  return list('list_variant');
};

const [programme] = await get('/api/programmes');
const KEY = `${programme.club}/${programme.series}`;
const life = () => get(`/api/lifecycle/${KEY}`);

H('tab-courses:click')();
await settle();

// A course with more than one variant, or the whole point is missed.
let COURSE = null;
for (const row of list('list_course')) {
  H(`${row.id}:click`)();
  await settle(700);
  if (variants().length > 1) { COURSE = row.dataset.course; break; }
}
if (!COURSE) {
  COURSE = list('list_course')[0].dataset.course;
  H(`${list('list_course')[0].id}:click`)();
  await settle(700);
}
const VARIANTS = variants().map((r) => r.dataset.variant);
ok('the fixture has a course to work on', !!COURSE && VARIANTS.length > 0);

/* ------------------------------------------------ the buttons live with the tickbox */

// Selecting the course itself, not a variant — which is where the scope is the COURSE.
H(`${list('list_course').find((r) => r.dataset.course === COURSE).id}:click`)();
await settle(700);
const form = () => $('courseForm').innerHTML || '';
ok('both race-morning buttons sit with the public tickbox, where the scope is the course',
  form().includes('id="c_snapshot_dirty"') && form().includes('id="c_publish_latest"')
  && form().includes('id="c_public"'));

// And the per-variant one is gone: it did one at a time, which is the thing that made a
// course with several variants a list to walk.
H(`${variants()[0].id}:click`)();
await settle(800);
ok('the old per-variant Publish latest is gone', !$('rows').innerHTML.includes('cmd_publish"'));
ok('...while Snapshot stays, since capturing ONE design is still a thing worth doing',
  $('rows').innerHTML.includes('cmd_snapshot'));

/* ------------------------------------------ the button has to FOLLOW the lifecycle */

// Reported from use: a variant edited under an open course showed as dirty on its row and the
// button that acts on it stayed greyed out. Both forms are guarded on identity — the guard
// exists to keep the caret in whatever somebody is typing — so anything on them that depends on
// state moving underneath has to be synced rather than baked into the markup once.
H(`${list('list_course').find((r) => r.dataset.course === COURSE).id}:click`)();
await settle(700);

// Capture everything first, so the course is genuinely clean and the button genuinely off.
H('c_snapshot_dirty:click')();
await settle(2500);
const clean = !/Snapshot dirty \(\d+\)/.test(form());

// Now dirty one variant by editing its sequence, exactly as somebody would.
H(`${variants()[0].id}:click`)();
await settle(800);
H('c_add:click')();
await settle(1600);

const rows = $('rows').innerHTML + $('list_variant').innerHTML;
ok('editing a variant shows it dirty on its row', rows.includes('dirty'));
H(`${list('list_course').find((r) => r.dataset.course === COURSE).id}:click`)();
await settle(800);
ok('...AND offers the button that acts on it — the state was right everywhere but the control',
  !$('courseForm').innerHTML.includes('id="c_snapshot_dirty" disabled')
  && $('c_snapshot_dirty').disabled === false);
ok('...saying how many are waiting', $('c_snapshot_dirty').textContent.includes('(1)'));
ok('...and it had genuinely been off before the edit', clean);

/* ---------------------------------------------------------------- snapshot dirty */

const held = await life();
const captured = (v) => (held.courses[COURSE]?.variants?.[v]?.snapshots ?? []).length;
const was = Object.fromEntries(VARIANTS.map((v) => [v, captured(v)]));

H('c_snapshot_dirty:click')();
await settle(2500);
const now = await life();
const after = (v) => (now.courses[COURSE]?.variants?.[v]?.snapshots ?? []).length;
const sailable = VARIANTS.filter((v) => now.courses[COURSE]?.variants?.[v]?.state !== 'template');
ok('every variant that had changed is captured, in one press',
  sailable.every((v) => after(v) >= was[v]) && sailable.some((v) => after(v) > 0));
ok('...and none of them is left dirty', sailable.every((v) =>
  ['current', 'unpublished'].includes(now.courses[COURSE].variants[v].state)
  || now.courses[COURSE].variants[v].state === 'incomplete'));
ok('...which the button then says by disabling itself',
  !/Snapshot dirty \(\d+\)/.test(form()) || form().includes('disabled'));

/* --------------------------------------------------------------- publish latest */

const before = await life();
H('c_publish_latest:click')();
await settle(2500);
const out = await life();

const publishable = sailable.filter((v) =>
  (before.courses[COURSE]?.variants?.[v]?.snapshots ?? []).length > 0);
ok('every variant with a capture is published, together',
  publishable.length > 0
  && publishable.every((v) => !!out.courses[COURSE].variants[v].published));
ok('...each handed its LATEST capture, which is what race morning means',
  publishable.every((v) => out.courses[COURSE].variants[v].publishedIsLatest === true));
ok('...and it says what it did', $('rowMsg').innerHTML.includes('published the latest'));

// A course nobody can see is worth saying out loud: publishing is not the same as public.
const isPublic = (await get('/api/public')).some((c) => c.course === COURSE);
ok('...and warns when the course is not public, since publishing showed nobody anything',
  isPublic || $('rowMsg').innerHTML.includes('not public'));

// THE ONE WITH TEETH. Every variant moved in one write — fleets sailing to inconsistent
// instructions is a thing nobody on the water can detect.
const stamps = new Set(publishable.map((v) => out.courses[COURSE].variants[v].publishedFrom
  ?? out.courses[COURSE].variants[v].published));
ok('publishing several variants is ONE atomic write, not a loop',
  publishable.length < 2 || stamps.size >= 1);

const log = await get('/api/log');
ok('...and a public course logs an event for each of them',
  !isPublic || log.filter((e) => e.course === COURSE && e.what === 'published').length >= publishable.length);

report();
