/**
 * A rename reaches the FILE, not only the screen.
 *
 * The bug: a rename re-renders, and the re-render destroys the very input the browser is in
 * the middle of leaving — so the `blur` that would have called endEdit() landed on a detached
 * node or never fired, and the edit stayed in memory. The editor showed the new id while the
 * file and the server kept the old one, which reads as a variant with no length (the lengths
 * come back from the server keyed by the id it knows) and a 404 on the next snapshot:
 *
 *     POST /api/lifecycle/{club}/{series}/snapshots  ->  404 No such course variant
 *
 * These drive the `change` event WITHOUT a following blur, which is the real sequence once
 * the node is gone, so a rename that only works because of the blur fails here.
 */
import { $, H, choose, chosenIn, ok, optionsOf, paneHtml, report, settle, unfold } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const get = async (p) => (await fetch(p)).json();
const [prog] = await get('/api/programmes');
const url = `/api/programmes/${prog.club}/${prog.series}`;

/** Type into a field and let it change, with no blur behind it. */
const retitle = async (field, value) => {
  H(`${field}:focus`)();
  $(field).value = value;
  H(`${field}:change`)({ target: { value } });
  await settle(1100);
};

/* ------------------------------------------------------------------------- a variant */

H('tab-courses:click')();
await settle();
const COURSE = optionsOf('course')[0];
choose('course', optionsOf('course')[0]);
await settle(600);
if (!chosenIn('variant')) choose('variant', optionsOf('variant')[0]);
await settle(700);

const wasVariant = optionsOf('variant')[0];
await retitle('v_id', 'drive-renamed-variant');

const afterVariant = await get(url);
ok('a renamed variant reaches the file, not just the screen',
  'drive-renamed-variant' in afterVariant.courses[COURSE].variants);
ok('...and the old id is gone from it',
  !(wasVariant in afterVariant.courses[COURSE].variants));
ok('...and the editor agrees',
  optionsOf('variant').includes('drive-renamed-variant'));

// The two symptoms the user sees, which are both just "the server never heard about it":
// the length comes back from the server keyed by the id it knows, so a row for an id it has
// never seen shows an em dash — and the snapshot endpoint 404s on the same id.
ok('...so it has a length again, rather than the em dash of an id the server never saw',
  !$('list_variant').innerHTML.includes('&mdash; nm'));

const snap = await fetch(`/api/lifecycle/${prog.club}/${prog.series}/snapshots`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ course: COURSE, variant: 'drive-renamed-variant' }),
});
ok('...and a snapshot of it is no longer a 404', snap.ok);

/* -------------------------------------------------------------------------- a course */

await retitle('c_id', 'drive-renamed-course');
const afterCourse = await get(url);
ok('a renamed course reaches the file too', 'drive-renamed-course' in afterCourse.courses);
ok('...and takes its variants with it',
  'drive-renamed-variant' in afterCourse.courses['drive-renamed-course'].variants);

/* ---------------------------------------------------------------- a line, and a point */

H('tab-lines:click')();
await settle(600);
const LINE = optionsOf('items')[0];
choose('items', LINE);
await settle(600);
await retitle('l_id', 'drive-renamed-line');

const afterLine = await get(url);
ok('a renamed line reaches the file', 'drive-renamed-line' in afterLine.lines);
ok('...and the old name is gone', !(LINE in afterLine.lines));
// The reference follow is the part a rename gets wrong quietly: the sequence names lines.
const stands = Object.values(afterLine.courses).flatMap((c) =>
  Object.values(c.variants ?? {}).flatMap((v) => (v.sequence ?? [])
    .flatMap((s) => (s.gate?.length ? s.gate : [s])).map((a) => a.line)));
ok('...and no course is left standing on the name that no longer exists',
  !stands.includes(LINE));

H('tab-points:click')();
await settle(600);
const POINT = optionsOf('items')[0];
choose('items', POINT);
await settle(600);
await retitle('f_id', 'drive-renamed-point');

const afterPoint = await get(url);
ok('a renamed point reaches the file', 'drive-renamed-point' in afterPoint.points);
ok('...and the old name is gone', !(POINT in afterPoint.points));
const ends = Object.values(afterPoint.lines).flatMap((l) => [l.port?.at, l.starboard?.at]);
ok('...and no line end is left naming it', !ends.includes(POINT));

report();
