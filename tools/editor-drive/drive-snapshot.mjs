/**
 * Snapshots as a level of their own: listed, selected, and acted upon.
 *
 * A snapshot is what a boat was handed, and the whole model rests on it being unable to
 * change — so selecting one puts it in the editor READ ONLY, and what the row offers is
 * what you can do about it, never to it.
 */
import { $, H, choose, chosenIn, ok, optionsOf, paneHtml, report, settle, unfold } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const snaps = () => {
  return optionsOf('snapshot');
};
const variants = () => {
  return optionsOf('variant');
};

H('tab-courses:click')();
await settle();
const [programme] = await (await fetch('/api/programmes')).json();
const KEY = `${programme.club}/${programme.series}`;
const COURSE = optionsOf('course')[0];
choose('course', optionsOf('course')[0]);
await settle();
const VARIANT = variants()[0];
choose('variant', variants()[0]);
await settle(700);

ok('a variant with no captures has no snapshot row at all',
  optionsOf('snapshot').length === 0);

/* ------------------------------------------------------------ take two of them */

H('cmd_snapshot:click')();
await settle(1200);
ok('taking one gives the variant a snapshot level', optionsOf('snapshot').length > 0);
ok('...with its list open, since nothing is chosen yet', snaps().length === 1);

// Change the design so the second capture is a different geometry.
H('c_add:click')();
await settle(1000);
H('cmd_snapshot:click')();
await settle(1200);
ok('a changed design captures as a second, distinct snapshot', snaps().length === 2);

/* ------------------------------------------------------- selecting one, read only */

const firstRev = snaps()[0];

// THE HASH IS SHOWN WHEREVER A SNAPSHOT IS NAMED, because the label is for reading and the
// revision is for CHECKING: it is what a record carries, what `GET /api/courses/{revision}`
// answers to, and what the client prints in its own top bar. Comparing what a fleet is sailing
// against what the editor is showing means comparing those, and a list of labels made the one
// question somebody actually asks — is that the one they have? — unanswerable without clicking
// through to a form.
ok('every snapshot the selector offers is named by its revision',
  snaps().every((rev) => paneHtml().includes(rev)));
ok('...with its label as well, since a hash is not how anybody talks about a capture',
  new RegExp(`<option value="${firstRev}"[^>]*>[^<]+ \u00b7 ${firstRev}`).test(paneHtml()));
choose('snapshot', firstRev);
await settle(1000);

ok('the capture is drawn on the chart in place of the design',
  ($('map').innerHTML.match(/class="cmark"/g) || []).length > 0);
ok('the form shows what it IS, with nothing to type in',
  $('snapshotForm').innerHTML.includes('Revision') && !$('snapshotForm').innerHTML.includes('<input'));
ok('...naming the revision it is', $('snapshotForm').innerHTML.includes(firstRev));
ok('...and the breadcrumb carries it too, so it is readable with the list shut',
  $('rows').innerHTML.includes(firstRev));
ok('nothing about it can be dragged — no line, end or course handles',
  !$('map').innerHTML.includes('class="lmid"')
  && !$('map').innerHTML.includes('class="lend"')
  && !$('map').innerHTML.includes('class="tgrip"'));
ok('and the row offers what you can do ABOUT it',
  ['cmd_snapshot_clone', 'cmd_snapshot_publish', 'cmd_snapshot_delete']
    .every((id) => $('rows').innerHTML.includes(id)));

/* ------------------------------------------------------- and the way back out */

/*
 * THE WAY BACK, WHICH WAS A DEAD END AND WHICH THIS FILE USED TO PASS ON.
 *
 * It was a toggle — choosing the capture already chosen put the design back — and that was
 * right while this level was a list of rows. The moment it became a selector it could never
 * run again, because a `<select>` fires no `change` for the option already selected. The
 * assertion here said it worked and was believed, because `choose()` in the stub fired
 * `change` unconditionally: it modelled a browser behaviour that does not exist.
 *
 * The way back is now an option in the list, and the discriminator below is what the old
 * assertion lacked. `#variantForm` carries `v_id` EITHER WAY — a capture is handed to the
 * drawing and form code as an all-ad-hoc variant, which is the whole trick that makes it
 * render — so asking whether that field is there proved nothing at all. What actually
 * distinguishes the two is the capture's own detail block, and the three view tickboxes,
 * which stand down while what is on screen is a record rather than a draft.
 */
choose('snapshot', firstRev);
await settle(700);
ok('a chosen capture keeps an empty option in its list, which is the way back',
  /<select id="sel_snapshot"[\s\S]*?<option value="">/.test(paneHtml()));
ok('...and re-choosing the one already chosen does nothing at all, as in a browser',
  choose('snapshot', firstRev) === undefined);
ok('...so while it is up, the read-only detail is there and the view tickboxes are not',
  $('rows').innerHTML.includes('snapshotForm')
  && !$('paneBottom').innerHTML.includes('c_move'));

choose('snapshot', '');
await settle(800);
ok('taking the empty option puts the living design back',
  chosenIn('snapshot') === '' && !$('rows').innerHTML.includes('snapshotForm'));
ok('...which IS editable, tickboxes and all',
  $('variantForm').innerHTML.includes('v_id')
  && $('paneBottom').innerHTML.includes('c_move'));

// AND SO DOES GOING TO THE VARIANT SELECTOR AND COMING BACK WITH THE SAME VARIANT. Opening
// that selector is an act of attention on the design level, so whichever design comes back —
// including the one already there — the capture is no longer what was asked for. `change`
// cannot see it, so it is the pointer that opened the list and the blur that closed it.
choose('snapshot', firstRev);
await settle(800);
ok('a capture can be chosen again', $('rows').innerHTML.includes('snapshotForm'));
H('sel_variant:pointerdown')({});
H('sel_variant:blur')({});
await settle(800);
ok('opening the variant selector and landing on the same variant lets the capture go too',
  chosenIn('snapshot') === '' && !$('rows').innerHTML.includes('snapshotForm'));

// A blur with no pointer behind it is somebody tabbing through the pane, which is not a
// decision about the design — and dropping the capture there would be a screen changing under
// a keystroke that meant nothing by it.
choose('snapshot', firstRev);
await settle(800);
H('sel_variant:blur')({});
await settle(500);
ok('...while a blur nobody opened the selector for leaves it alone',
  $('rows').innerHTML.includes('snapshotForm'));

/* -------------------------------------------------------------------- publish */

choose('snapshot', firstRev);
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

const otherRev = snaps().find((rev) => rev !== firstRev);
choose('snapshot', otherRev);
await settle(900);
H('cmd_snapshot_delete:click')();
await settle(1200);
ok('an unpublished one leaves the list', snaps().length === 1);
ok('...but its geometry is KEPT — a record naming it must still be readable',
  (await fetch(`/api/courses/${otherRev}`)).status === 200);

/* ---------------------------------------------------------------------- clone */

choose('snapshot', firstRev);
await settle(900);
const before = variants();
H('cmd_snapshot_clone:click')();
await settle(1200);
const made = variants().find((v) => !before.includes(v));
ok('a capture can start a new variant', !!made);
ok('...named for the design and the day it captured, not for twelve hex characters',
  made && made.startsWith(VARIANT) && !/^[0-9a-f]{12}/.test(made));

const after = await (await fetch(`/api/programmes/${KEY}`)).json();
const clone = after.courses[COURSE].variants[made];
ok('...owning all its geometry outright, since a capture is fully inlined',
  Object.keys(clone.lines ?? {}).length > 0);
ok('...and editable again — the form has fields', $('variantForm').innerHTML.includes('v_id'));

report();
