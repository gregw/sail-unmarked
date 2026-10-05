/**
 * Line ends, and the handles they are dragged by.
 */
import { $, H, choose, chosenIn, ok, optionsOf, paneHtml, report, settle, unfold } from './dom.mjs';

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

// This line's own handle: another line's, shorter on screen, has a smaller one.
const radius = (after, what) =>
  Number(new RegExp(`class="${what}" data-id="${LINE}[\\s\\S]{0,${after}}?r="(\\d+)"`).exec(svg())?.[1]);
// A target, not a marker — 20px to hit — but never reaching over the ends' own 11px, which it
// is drawn above: on a short line that would leave the ends ungrabbable at any zoom.
const centres = (what) => [...svg().matchAll(new RegExp(`class="${what}" data-id="${LINE}[^"]*"[^>]*>`
  + '<circle cx="([-\\d.]+)" cy="([-\\d.]+)"', 'g'))].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
const [port, starboard] = centres('lend');
const halfPx = Math.hypot(starboard.x - port.x, starboard.y - port.y) / 2;
ok('the midpoint handle is a target, not a marker — 20px to hit where the line has room',
  radius(200, 'lmid') === Math.round(Math.max(6, Math.min(20, halfPx - 11))));
ok('...and never covers the ends', radius(200, 'lmid') <= Math.max(6, halfPx - 11));
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

/* ------------------------------------------- what the line is becoming */

// While an end is dragged the line's length and headings ride beside it, and go when it lets go.
H(`${ends()[0].id}:mousedown`)({ stopPropagation() {} });
H('window:mousemove')({ clientX: 600, clientY: 300 });
const readout = /<g class="endreadout"[\s\S]*?<\/g>/.exec(svg())?.[0] ?? '';
ok('dragging an end shows the line\'s length', / (m|nm)</.test(readout));
ok('...its heading and reciprocal', /line \d{3}&deg;\/\d{3}&deg;/.test(readout));
ok('...and the heading square to it, and its reciprocal', /&perp; \d{3}&deg;\/\d{3}&deg;/.test(readout));
const [h1, h2] = (/line (\d{3})&deg;/.exec(readout) ?? []).slice(1).concat(/&perp; (\d{3})&deg;/.exec(readout)?.[1]).map(Number);
ok('...which is the line turned 90° to port, the way a forward crossing sails', ((h1 - 90 + 360) % 360) === h2);
H('window:mouseup')({ clientX: 600, clientY: 300 });
await settle(600);
ok('...and it goes when the end is let go', !svg().includes('endreadout'));

/* ---------------------------------------------- the chart chooses the line */

// Taking hold of a line on the chart is choosing it: the form follows, without the list.
const selected = () => /id="l_id" value="([^"]*)"/.exec($('form').innerHTML)?.[1];
const hits = () => $('map').querySelectorAll('.lhit');
const other = hits().find((g) => g.dataset.line !== LINE)?.dataset.line;
ok('every line on the Lines tab has something wide enough to click', hits().length > 1 && !!other);
hits().find((g) => g.dataset.line === other).fire('mousedown', {});
H('window:mouseup')({ clientX: 0, clientY: 0 });
await settle(600);
ok('clicking a line on the chart selects it in the form', selected() === other);
ok('...and in the list above it', chosenIn('items') === other);

H(`${mids()[0].id}:mousedown`)({ stopPropagation() {} });
H('window:mouseup')({ clientX: 560, clientY: 380 });
await settle(600);
ok('taking hold of a line by its middle selects it too', selected() === LINE);

hits().find((g) => g.dataset.line === other).fire('mousedown', {});
H('window:mouseup')({ clientX: 0, clientY: 0 });
await settle(600);
H(`${ends()[0].id}:mousedown`)({ stopPropagation() {} });
H('window:mouseup')({ clientX: 560, clientY: 380 });
await settle(600);
ok('...and so does taking hold of one of its ends', selected() === LINE);

report();
