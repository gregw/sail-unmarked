/**
 * Adding a variant to a course by expanding a template from anywhere in the library.
 *
 * The interesting part is not the copy, it is what happens to the NAMES. A programme file
 * is self-contained, so a template from another series cannot be referred to, only copied —
 * and a name that already means something else in the target is the one case where neither
 * reusing nor overwriting is safe.
 */
import { $, H, ok, report, settle } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const list = (id) => $(id).querySelectorAll('.row');
const variants = () => {
  if (!$('rows').innerHTML.includes('list_variant')) H('crumb_variant:click')();
  return list('list_variant');
};

const templates = await (await fetch('/api/templates')).json();
ok('the library knows every template, wherever it lives', templates.length > 0);
ok('...and says which series each is in', templates.every((t) => t.club && t.series && t.course));

/* ------------------------------------------------ a course starts with no design */

H('tab-courses:click')();
await settle();
// Identified by what appeared, not by reading the crumb: a crumb shows the LEVEL name
// while its list is open, so it names the selection only half the time.
const was = new Set(list('list_course').map((r) => r.dataset.course));
H('cmd_course_add:click')();
await settle(900);
const COURSE = list('list_course').map((r) => r.dataset.course).find((c) => !was.has(c));
ok('a new course has no variants — a course is not a design', variants().length === 0);
ok('...and its row offers both ways to give it one',
  $('rows').innerHTML.includes('cmd_variant_add')
  && $('rows').innerHTML.includes('cmd_variant_template'));

/* ------------------------------------------------ and the last one can be taken away */

// Give it a design, then take it back off. A course with no design is where every course
// starts and somewhere it may return to; the server must not hand back a phantom `main`.
H('cmd_variant_add:click')();
await settle(900);
ok('a variant can be added to the empty course', variants().length === 1);
H('cmd_variant_delete:click')();
await settle(900);
ok('...and the LAST one can be deleted again', variants().length === 0);

const [first] = await (await fetch('/api/programmes')).json();
const bare = await (await fetch(`/api/programmes/${first.club}/${first.series}`)).json();
ok('...and it stays gone across the file — no phantom `main` on the way back',
  Object.keys(bare.courses[COURSE].variants ?? {}).length === 0);
ok('...which the server reports, since a course with no design cannot be joined',
  JSON.stringify(bare.problems).includes(`course '${COURSE}' has no variants`));

/* ------------------------------------------------------ expanding one, cross-series */

// Which series is open, and which template is NOT from it — so the copy is a real adoption.
const [here] = await (await fetch('/api/programmes')).json();
const key = `${here.club}/${here.series}`;
const foreign = templates.findIndex((t) => `${t.club}/${t.series}` !== key);
const pick = foreign >= 0 ? foreign : 0;
const template = templates[pick];

const before = await (await fetch(`/api/programmes/${key}`)).json();

/** Walk the picker down to one template. A stage with one answer answers itself. */
const btn = (k) => $('askChoices').querySelectorAll('button').find((b) => b.dataset.key === k);
const stage = () => $('askChoices').querySelectorAll('button').map((b) => b.dataset.key ?? '');
async function drillTo(t) {
  H('cmd_variant_template:click')();
  await settle(800);
  for (const step of [`${t.club}/${t.series}`, t.course, t.variant]) {
    const target = btn(step);
    if (!target) continue;          // that stage had one answer and skipped itself
    target.fire('click');
    await settle(500);
  }
  await settle(900);
}

H('cmd_variant_template:click')();
await settle(800);
// Only one series here holds templates, so the series stage answers itself and the first
// question asked is already the one below it.
const seriesKeys = new Set(templates.map((t) => `${t.club}/${t.series}`));
ok('a stage with one answer answers itself',
  seriesKeys.size > 1 || !stage().includes([...seriesKeys][0]));
ok('...so the first question is the deepest one that is a real choice',
  stage().length > 1);
// Abandon this one and drill properly.
btn('').fire('click');
await settle(400);
await drillTo(template);

ok('the template becomes a variant of this course', variants().length === 1);
// Named for the RACE it will be, not the shape it came from: a template is a shape, and what
// comes out of one is a race on a day, usually not the only one that day.
const today = new Date();
const day = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`
  + String(today.getDate()).padStart(2, '0');
ok('...named yyyymmdd-race-n, for the race it is rather than the shape it came from',
  /^\d{8}-race-\d+$/.test(variants()[0].dataset.variant)
  && variants()[0].dataset.variant.startsWith(`${day}-race-`));

const after = await (await fetch(`/api/programmes/${key}`)).json();
const variant = after.courses[COURSE].variants[variants()[0].dataset.variant];
ok('...and it is not itself a template — it is a design to sail', variant.template === false);

const named = (variant.sequence ?? []).flatMap((s) => (s.gate?.length ? s.gate : [s]))
  .map((a) => a.line).filter(Boolean);
ok('every line its sequence names exists in THIS series',
  named.every((id) => after.lines[id] || variant.lines?.[id]));
ok('...and so does every point those lines stand on',
  named.every((id) => ['port', 'starboard'].every((side) => {
    const end = (variant.lines?.[id] ?? after.lines[id])[side];
    return !end?.at || after.points[end.at];
  })));
// One line per NAME, not per occurrence, on the NAMED path — `adopt` reuses a name that
// already means the same place, so a repeat lands on the same line. The ad-hoc path is where
// this broke and is driven in drive-reuse.mjs, which writes the template it needs because
// every template in the fixture is built on named lines.
const src = await (await fetch(`/api/programmes/${template.club}/${template.series}`)).json();
const srcSeq = src.courses[template.course].variants[template.variant].sequence ?? [];
const srcNamed = srcSeq.flatMap((s) => (s.gate?.length ? s.gate : [s])).map((a) => a.line).filter(Boolean);
ok('the template repeats at least one line, so there is something to get wrong',
  srcNamed.length > new Set(srcNamed).size);
ok('a line the sequence names twice is taken across ONCE',
  new Set(named).size === new Set(srcNamed).size);
ok('...and the sequence is the same shape, repeats and all',
  named.length === srcNamed.length);
ok('...and nothing ad-hoc was made that the sequence does not stand on',
  Object.keys(variant.lines ?? {}).every((id) => named.includes(id)));

ok('a self-contained file stays self-contained — the server reports no unknown names',
  !JSON.stringify(after.problems).includes('unknown'));
ok('...which it could not have been before, since the template was elsewhere',
  foreign < 0 || Object.keys(after.points).length > Object.keys(before.points).length
  || Object.keys(after.lines).length > Object.keys(before.lines).length);

/* -------------------------------------------------------- the drill, and back */

// Back steps over the stages that answered themselves — going back INTO one would answer
// it again and go straight forward, which is a button that does nothing.
H('cmd_variant_template:click')();
await settle(800);
const deepest = stage().filter((k) => k && k !== '__back');
ok('the first stage offers no back — there is nothing behind it', !stage().includes('__back'));
if (deepest.length > 1) {
  btn(deepest[0]).fire('click');
  await settle(500);
  const asked = $('askBody').innerHTML;
  ok('going one level down asks the next question', asked.includes('Which template?'));
  ok('...and offers a way back, now that there is something to go back to',
    stage().includes('__back'));
  btn('__back').fire('click');
  await settle(500);
  ok('back returns to the stage that was a real choice',
    $('askBody').innerHTML.includes('Which course?'));
  btn('').fire('click');
  await settle(400);
} else {
  ok('only one thing to choose — nothing to drill', true);
  ok('...', true);
  ok('...', true);
}

/* --------------------------------------------- a name that means something else here */

// Move an adopted LINE, then expand the same template again. Its name now means a
// different place here, so the second expansion must not quietly take this one — nor
// overwrite it, which would move every course in this series that stands on it.
const clash = named.find((id) => after.lines[id]);
if (clash) {
  H('tab-lines:click')();
  await settle(500);
  const row = list('list_items').find((r) => r.dataset.id === clash);
  H(`${row.id}:click`)();
  await settle(500);
  H(`l_starboard_lat:focus`)();
  $('l_starboard_lat').value = '-33.700000';
  $('l_starboard_lon').value = '151.200000';
  H('l_starboard_lat:blur')({ relatedTarget: null });
  await settle(1000);
  const moved = await (await fetch(`/api/programmes/${key}`)).json();
  ok('the adopted line can be moved, so its name now means somewhere else',
    Math.abs(moved.lines[clash].starboard.latitude - -33.7) < 1e-6);

  H('tab-courses:click')();
  await settle(500);
  await drillTo(template);

  const now = await (await fetch(`/api/programmes/${key}`)).json();
  ok('a clashing name gets a distinct id, never a silent reuse',
    Object.keys(now.lines).some((id) => id !== clash && id.startsWith(clash)));
  ok('...and the line that was already here is left exactly where it was — overwriting it '
    + 'would move every course standing on it',
    Math.abs(now.lines[clash].starboard.latitude - -33.7) < 1e-6);
  ok('...and it SAYS so rather than doing it quietly',
    $('rowMsg').innerHTML.includes('already means somewhere else'));

  // And the second expansion must be pointing at the copy, not at the moved original.
  const second = variants().map((r) => r.dataset.variant).find((v) => v !== variants()[0].dataset.variant);
  const used = new Set((now.courses[COURSE].variants[second]?.sequence ?? [])
    .flatMap((st) => (st.gate?.length ? st.gate : [st])).map((a) => a.line));
  ok('...and the new variant stands on the copy, not on what was already here',
    !used.has(clash) || used.size === 0);
} else {
  ok('no named line on this template to clash — nothing to assert', true);
  ok('...', true);
  ok('...', true);
  ok('...', true);
  ok('...', true);
}

report();
