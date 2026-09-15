/**
 * Line ends, and the handles they are dragged by.
 */
import { $, H, ok, report, settle } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const svg = () => $('map').innerHTML;

H('tab-lines:click')();
await settle();

// A line loose at both ends: two clicks on open water, naming nothing.
H('cmd_item_add:click')();
await settle(600);
for (const [x, y] of [[300, 200], [420, 280]]) {
  H('map:mousedown')({ clientX: x, clientY: y });
  H('window:mouseup')({ clientX: x, clientY: y });
  await settle(600);
}

// The line just made, by id — the fixture has other fully-inline lines and they all get
// handles too, so counting them proves nothing.
// Read off the form markup: the stub's .value only reflects what was assigned to it, and
// this field's value came from the render rather than from a keystroke.
const LINE = /id="l_id" value="([^"]*)"/.exec($('form').innerHTML)?.[1];
const mids = () => $('map').querySelectorAll('.lmid').filter((g) => g.dataset.line === LINE);
const ends = () => $('map').querySelectorAll('.lend').filter((g) => g.dataset.line === LINE);
ok('a line loose at both ends gets a midpoint handle', mids().length === 1);
ok('...and each of its inline ends gets one of its own', ends().length === 2);

const radius = (after, what) =>
  Number(new RegExp(`class="${what}"[\\s\\S]{0,${after}}?r="(\\d+)"`).exec(svg())?.[1]);
ok('the midpoint handle is a target, not a marker — 20px to hit', radius(200, 'lmid') === 20);
ok('...and 6px to see, twice the plain midpoint dot',
  /class="lmid"[\s\S]{0,320}?r="6" fill="var\(--sea\)"/.test(svg()));

/* --------------------------------------------------------------- stacking */

// A handle buried under anything is one you cannot hit, so they are all drawn last.
const at = (needle) => svg().lastIndexOf(needle);
const handle = svg().indexOf('class="lmid"');
ok('handles are drawn after every line segment', handle > at('stroke-width="2.5"'));
ok('...after the points', handle > at('class="pt"'));
ok('...and after the course marks',
  at('class="cmark"') < 0 || handle > at('class="cmark"'));

/* ------------------------------------------------------------- and it drags */

const where = () => {
  const m = new RegExp(`class="lmid" data-id="${LINE}"[\\s\\S]{0,80}?cx="([\\d.]+)" cy="([\\d.]+)"`).exec(svg());
  return m ? `${m[1]},${m[2]}` : null;
};
const before = where();
H(`${mids()[0].id}:mousedown`)({ stopPropagation() {} });
H('window:mousemove')({ clientX: 520, clientY: 340 });
H('window:mousemove')({ clientX: 560, clientY: 380 });
H('window:mouseup')({ clientX: 560, clientY: 380 });
await settle(800);
ok('the midpoint handle still drags the whole line', before && where() !== before);

report();
