/**
 * Snapshots as a level of their own: listed, selected, and acted upon.
 *
 * A snapshot is what a boat was handed, and the whole model rests on it being unable to
 * change — so selecting one puts it in the editor READ ONLY, and what the row offers is
 * what you can do about it, never to it.
 */
import { $, H, ok, report, settle } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const list = (id) => $(id).querySelectorAll('.row');
const snaps = () => {
  if (!$('rows').innerHTML.includes('list_snapshot')) H('crumb_snapshot:click')();
  return list('list_snapshot');
};
const variants = () => {
  if (!$('rows').innerHTML.includes('list_variant')) H('crumb_variant:click')();
  return list('list_variant');
};

H('tab-courses:click')();
await settle();
const [programme] = await (await fetch('/api/programmes')).json();
const KEY = `${programme.club}/${programme.series}`;
const COURSE = list('list_course')[0].dataset.course;
H(`${list('list_course')[0].id}:click`)();
await settle();
const VARIANT = variants()[0].dataset.variant;
H(`${variants()[0].id}:click`)();
await settle(700);

ok('a variant with no captures has no snapshot row at all',
  !$('rows').innerHTML.includes('crumb_snapshot'));

/* ------------------------------------------------------------ take two of them */

H('cmd_snapshot:click')();
await settle(1200);
ok('taking one gives the variant a snapshot level', $('rows').innerHTML.includes('crumb_snapshot'));
ok('...with its list open, since nothing is chosen yet', snaps().length === 1);

// Change the design so the second capture is a different geometry.
H('c_add:click')();
await settle(1000);
H('cmd_snapshot:click')();
await settle(1200);
ok('a changed design captures as a second, distinct snapshot', snaps().length === 2);

/* ------------------------------------------------------- selecting one, read only */

const first = snaps()[0];
const firstRev = first.dataset.revision;
H(`${first.id}:click`)();
await settle(1000);

ok('the capture is drawn on the chart in place of the design',
  ($('map').innerHTML.match(/class="cmark"/g) || []).length > 0);
ok('the form shows what it IS, with nothing to type in',
  $('form').innerHTML.includes('Revision') && !$('form').innerHTML.includes('<input'));
ok('...naming the revision it is', $('form').innerHTML.includes(firstRev));
ok('nothing about it can be dragged — no line, end or course handles',
  !$('map').innerHTML.includes('class="lmid"')
  && !$('map').innerHTML.includes('class="lend"')
  && !$('map').innerHTML.includes('class="tgrip"'));
ok('and the row offers what you can do ABOUT it',
  ['cmd_snapshot_clone', 'cmd_snapshot_publish', 'cmd_snapshot_delete']
    .every((id) => $('rows').innerHTML.includes(id)));

// Clicking the chosen one again puts the living design back.
H(`${snaps().find((r) => r.dataset.revision === firstRev).id}:click`)();
await settle(600);
ok('choosing it again returns to the design, which IS editable',
  $('form').innerHTML.includes('<input') && $('map').innerHTML.includes('class="tgrip"') === false
  || $('form').innerHTML.includes('v_id'));

/* -------------------------------------------------------------------- publish */

H(`${snaps().find((r) => r.dataset.revision === firstRev).id}:click`)();
await settle(900);
H('cmd_snapshot_publish:click')();
await settle(1200);
let life = await (await fetch(`/api/lifecycle/${KEY}`)).json();
ok('publishing a chosen snapshot hands boats THAT one, not the latest',
  life.courses[COURSE].variants[VARIANT].published === firstRev);
ok('...so a rollback needs no re-editing — it is a pointer move',
  life.courses[COURSE].variants[VARIANT].publishedIsLatest === false);

/* --------------------------------------------------------------------- forget */

// The published one is refused: deleting what a fleet is being handed is not a keystroke.
H('cmd_snapshot_delete:click')();
await settle(1000);
ok('the published capture cannot be forgotten', snaps().length === 2);
ok('...and it says why', $('rowMsg').innerHTML.includes('published'));

const other = snaps().find((r) => r.dataset.revision !== firstRev);
const otherRev = other.dataset.revision;
H(`${other.id}:click`)();
await settle(900);
H('cmd_snapshot_delete:click')();
await settle(1200);
ok('an unpublished one leaves the list', snaps().length === 1);
ok('...but its geometry is KEPT — a record naming it must still be readable',
  (await fetch(`/api/courses/${otherRev}`)).status === 200);

/* ---------------------------------------------------------------------- clone */

H(`${snaps()[0].id}:click`)();
await settle(900);
const before = variants().map((r) => r.dataset.variant);
H('cmd_snapshot_clone:click')();
await settle(1200);
const made = variants().map((r) => r.dataset.variant).find((v) => !before.includes(v));
ok('a capture can start a new variant', !!made);
ok('...named for the design and the day it captured, not for twelve hex characters',
  made && made.startsWith(VARIANT) && !/^[0-9a-f]{12}/.test(made));

const after = await (await fetch(`/api/programmes/${KEY}`)).json();
const clone = after.courses[COURSE].variants[made];
ok('...owning all its geometry outright, since a capture is fully inlined',
  Object.keys(clone.lines ?? {}).length > 0);
ok('...and editable again — the form has fields', $('form').innerHTML.includes('v_id'));

report();
