/**
 * A template whose sequence names one line several times expands into ONE line.
 *
 * A windward/leeward's leeward line is start, mark 2 and finish: three steps, one line. The
 * expansion used to take a line across once per OCCURRENCE, so an ad-hoc line came out as
 * three separate copies sitting in the same water with three different ids — indistinguishable
 * on the chart, and three separate edits every time the mark moved afterwards.
 *
 * The fixture's own templates are all built on NAMED lines, where `adopt` happened to be
 * idempotent and the bug did not show. So this driver writes the template it needs: ad-hoc
 * geometry, repeated, in a series other than the one the editor has open.
 */
import { $, H, ok, report, settle } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const list = (id) => $(id).querySelectorAll('.row');
const variants = () => {
  if (!$('rows').innerHTML.includes('list_variant')) H('crumb_variant:click')();
  return list('list_variant');
};
const get = async (p) => (await fetch(p)).json();

const programmes = await get('/api/programmes');
const here = programmes[0];
// Elsewhere, so the editor's in-memory copy of the open series is not what we edited behind
// its back — expandTemplate fetches the SOURCE fresh, which is the whole point of copying.
const away = programmes.find((p) => p.series !== here.series);
ok('the fixture has a second series to put the probe in', !!away);

/* ------------------------------------------------- a template that repeats an ad-hoc line */

const COURSE_ID = 'drive-reuse-probe';
const at = (lat, lon) => ({ latitude: lat, longitude: lon });
const prog = await get(`/api/programmes/${away.club}/${away.series}`);
prog.courses[COURSE_ID] = {
  name: 'Reuse probe',
  variants: {
    shape: {
      name: 'Shape',
      template: true,
      // Ad-hoc: belonging to this design alone, which is the case that broke.
      lines: {
        'probe-low': { port: at(-33.8100, 151.2800), starboard: at(-33.8100, 151.2900) },
        'probe-high': { port: at(-33.7900, 151.2800), starboard: at(-33.7900, 151.2900) },
      },
      // Two laps: low, high, low, high, low. Three crossings of one line, two of the other.
      sequence: [
        { line: 'probe-low', cross: 'forward' },
        { line: 'probe-high', cross: 'forward' },
        { line: 'probe-low', cross: 'reverse' },
        { line: 'probe-high', cross: 'forward' },
        { line: 'probe-low', cross: 'reverse' },
      ],
    },
  },
};
const saved = await (await fetch(`/api/programmes/${away.club}/${away.series}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ points: prog.points, lines: prog.lines, courses: prog.courses }),
})).json();
ok('the probe template is written and reads back', saved.saved === true);

const templates = await get('/api/templates');
const probe = templates.find((t) => t.course === COURSE_ID && t.variant === 'shape');
ok('...and the library offers it like any other', !!probe);

/* -------------------------------------------------------------- expand it into a new course */

H('tab-courses:click')();
await settle();
const was = new Set(list('list_course').map((r) => r.dataset.course));
H('cmd_course_add:click')();
await settle(900);
const INTO = list('list_course').map((r) => r.dataset.course).find((c) => !was.has(c));

const btn = (k) => $('askChoices').querySelectorAll('button').find((b) => b.dataset.key === k);
H('cmd_variant_template:click')();
await settle(800);
for (const step of [`${probe.club}/${probe.series}`, probe.course, probe.variant]) {
  const target = btn(step);
  if (!target) continue;           // that stage had one answer and skipped itself
  target.fire('click');
  await settle(500);
}
await settle(900);
ok('the probe expands into the open course', variants().length === 1);
ok('...as a dated race, not as the shape it came from',
  /^\d{8}-race-\d+$/.test(variants()[0].dataset.variant));

/* ------------------------------------------------------------------------ one line per name */

const after = await get(`/api/programmes/${here.club}/${here.series}`);
const made = after.courses[INTO].variants[variants()[0].dataset.variant];
const named = (made.sequence ?? []).flatMap((s) => (s.gate?.length ? s.gate : [s]))
  .map((a) => a.line).filter(Boolean);

ok('the sequence is the same shape — five crossings, repeats and all', named.length === 5);
ok('...standing on TWO lines, not five', new Set(named).size === 2);
ok('...and two is what was actually created', Object.keys(made.lines ?? {}).length === 2);
ok('...each line still crossed as many times as the template crossed it',
  named.filter((id) => id === named[0]).length === 3);
ok('...and every one of them is stood on by the sequence — nothing orphaned',
  Object.keys(made.lines ?? {}).every((id) => named.includes(id)));

// The copies were at identical coordinates, so a chart could not tell them apart — which is
// why the count above is the test and "they all resolve somewhere" is not.
const ends = Object.values(made.lines ?? {}).map((l) => `${l.port?.latitude},${l.port?.longitude}`);
ok('...and the two that exist are two DIFFERENT places', new Set(ends).size === 2);

report();
