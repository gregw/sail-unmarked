/**
 * The pane's levels, and the wiring that keeps their controls alive.
 *
 * The bug this exists for: the series row's controls were wired inside the guard that
 * protects #rows — a different element — so any render that rebuilt #rowSeries while #rows
 * stayed put replaced those controls and left nothing listening. Changing series after
 * editing a course was then impossible. The pane is selectors rather than lists now, and the
 * two containers are still rebuilt on independent conditions, so the bug is still available
 * to anybody who wires one under the other's guard.
 */
import { $, H, choose, chosenIn, ok, optionsOf, paneHtml, report, settle, unfold } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const programmes = await (await fetch('/api/programmes')).json();
ok('the fixture has more than one series to switch between', programmes.length > 1);

H('tab-courses:click')();
await settle();

/* ------------------------------------------------- a level is a label, a selector, commands */

ok('every level of the drill-down is a selector', ['club', 'series', 'course']
  .every((level) => paneHtml().includes(`id="sel_${level}"`)));
ok('...the club among them, split from the series it used to be glued to',
  optionsOf('club').includes(programmes[0].club));
ok('...and the club carries NO commands, being a domain: not created, renamed or deleted here',
  !paneHtml().includes('cmd_club'));

const firstCourse = optionsOf('course')[0];
choose('course', firstCourse);
await settle(600);
ok('choosing a course selects it', chosenIn('course') === firstCourse);

const variants = optionsOf('variant');
ok('...and offers its variants', variants.length > 0);
choose('variant', variants[0]);
await settle(600);
ok('choosing a variant selects it', chosenIn('variant') === variants[0]);

/* ------------------------------------------------------ the wiring survives an edit */

H('c_add:click')();
await settle(900);

ok('the series selector still answers after an edit',
  typeof H('sel_series:change') === 'function');
ok('...and so do its commands, not just the selector',
  ['cmd_series_add', 'cmd_series_clone', 'cmd_series_delete']
    .every((id) => typeof H(`${id}:click`) === 'function'));

const other = optionsOf('series').find((k) => k !== `${programmes[0].club}/${programmes[0].series}`)
  ?? optionsOf('series')[1];
if (!other) {
  ok('a different series can be chosen after editing a course — NONE OFFERED', false);
} else {
  choose('series', other);
  await settle(900);
  ok('a different series can be chosen after editing a course',
    paneHtml().includes(other.split('/')[1]));
}

/* --------------------------------------------------------------- the folds */

// Choosing again, because changing series clears the selection below it — the course ids in
// one programme file mean nothing in another.
choose('course', optionsOf('course')[0]);
await settle(600);
if (!chosenIn('variant')) { choose('variant', optionsOf('variant')[0]); await settle(600); }

ok('a variant opens with its fields unfolded, because the sequence IS the course',
  paneHtml().includes('id="variantForm"'));
unfold('variant');
await settle(400);
ok('...and the chevron folds them away, selector and all still in place',
  !paneHtml().includes('id="variantForm"') && paneHtml().includes('id="sel_variant"'));

report();
