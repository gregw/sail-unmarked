/**
 * The pane's rows, and the wiring that keeps their buttons alive.
 *
 * The bug this exists for: the series row's chevron and commands were wired inside the
 * guard that protects #rows — a different element — so any render that rebuilt #rowSeries
 * while #rows stayed put replaced those buttons and left nothing listening. Changing series
 * after editing a course was then impossible.
 */
import { $, H, ok, report, settle } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const list = (id) => $(id).querySelectorAll('.row');
const seriesOpen = () => $('rowSeries').innerHTML.includes('list_series');

const programmes = await (await fetch('/api/programmes')).json();
ok('the fixture has more than one series to switch between', programmes.length > 1);

H('tab-courses:click')();
await settle();

const chevron = () => {
  const fn = H('crumb_series:click');
  if (!fn) return false;
  fn();
  return true;
};

ok('the series chevron answers from the start', chevron());
await settle();
ok('...and opens the list', seriesOpen());
chevron();
await settle();

// Edit a course: this is the render that used to rebuild #rowSeries while #rows stood
// still, replacing the series buttons with ones nothing was listening to.
H(`${list('list_course')[0].id}:click`)();
await settle();
if (!$('rows').innerHTML.includes('list_variant')) { H('crumb_variant:click')(); await settle(); }
H(`${list('list_variant')[0].id}:click`)();
await settle(600);
H('c_add:click')();
await settle(900);

ok('the series chevron still answers after an edit', chevron());
await settle();
ok('...and still opens the list', seriesOpen());

// Guarded, so a dead chevron reports a FAILURE rather than throwing — a crash tells the
// suite nothing about which assertion broke.
const rows = list('list_series');
const other = rows.find((r) => r.dataset.series !== `${programmes[0].club}/${programmes[0].series}`)
  ?? rows[1];
if (!other) {
  ok('a different series can be chosen after editing a course — NO SERIES LISTED', false);
} else {
  H(`${other.id}:click`)();
  await settle(900);
  ok('a different series can be chosen after editing a course',
    $('rowSeries').innerHTML.includes(other.dataset.series.split('/')[1]));
}

ok('and its commands answer too, not just the chevron',
  ['cmd_series_add', 'cmd_series_clone', 'cmd_series_delete']
    .every((id) => typeof H(`${id}:click`) === 'function'));

report();
