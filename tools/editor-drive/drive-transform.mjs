/**
 * Sorted lists, and moving or turning a whole course from the chart.
 */
import { $, H, choose, chosenIn, ok, optionsOf, paneHtml, report, settle, unfold } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const sorted = (v) => v.every((x, i) => i === 0 || v[i - 1].localeCompare(x) <= 0);

/* ---------------------------------------------------------------- sorting */

H('tab-courses:click')();
await settle();
ok('the course list is sorted', sorted(optionsOf('course')));

unfold('series');
await settle();
ok('the series list is sorted', sorted(optionsOf('series')));
unfold('series');
await settle();

H('tab-points:click')();
await settle();
ok('the points list is sorted', sorted(optionsOf('items')));
H('tab-lines:click')();
await settle();
ok('the lines list is sorted', sorted(optionsOf('items')));

H('tab-courses:click')();
await settle();

// Which course and variant, decided here rather than scraped back out of the markup: a
// crumb shows the LEVEL name while its list is open, so reading the selection off it is
// only right half the time.
const [programme] = await (await fetch('/api/programmes')).json();
const KEY = `${programme.club}/${programme.series}`;
const COURSE = optionsOf('course')[0];
choose('course', optionsOf('course')[0]);
await settle();
ok('the variant list is sorted', sorted(optionsOf('variant')));

const VARIANT = optionsOf('variant')[0];
choose('variant', optionsOf('variant')[0]);
await settle(500);

/* ------------------------------------------------------ the transform grips */

ok('no grips until asked for', !$('map').innerHTML.includes('class="tgrip"'));
$('c_move').checked = true;
H('c_move:change')({ target: { checked: true } });
await settle(500);

const grips = () => $('map').querySelectorAll('.tgrip');
ok('the tickbox puts a move and a turn grip on the chart',
  grips().length === 2 && grips().some((g) => g.dataset.kind === 'tmove')
  && grips().some((g) => g.dataset.kind === 'trotate'));
ok('...outside the course, not on top of it', $('map').innerHTML.includes('stroke-dasharray="5 5"'));

/** The open variant, resolved by the server — the one authority on leg lengths. */
const detail = async () => {
  const d = await (await fetch(`/api/programmes/${KEY}/courses/${COURSE}`)).json();
  return d.variants[VARIANT] ?? Object.values(d.variants)[0];
};

const before = await detail();
const answer = async (key) => {
  await settle(200);
  const buttons = $('askChoices').querySelectorAll('button');
  if (!buttons.length) return null;
  (buttons.find((b) => b.dataset.key === key) ?? buttons[0]).fire('click');
  await settle(900);
  return buttons.map((b) => b.dataset.key ?? '');
};

// ---- move
const move = grips().find((g) => g.dataset.kind === 'tmove');
$('askChoices').innerHTML = '';
H(`${move.id}:mousedown`)({ stopPropagation() {} });
H('window:mousemove')({ clientX: 420, clientY: 300 });
H('window:mousemove')({ clientX: 470, clientY: 340 });
H('window:mouseup')({ clientX: 470, clientY: 340 });
const asked = await answer('here');
ok('moving a course built on shared marks asks before it detaches them',
  asked === null || asked.includes('here'));
// Widening scope is allowed here, unlike on a single mark's drag: the invariant is that it
// never happens by ACCIDENT, and an explicit answer is what widens it. "The whole fleet's
// course has shifted twenty degrees" is a real thing somebody means on race morning.
ok('...and offers to move them for every course that shares them',
  asked === null || asked.includes('all'));
const moved = await detail();
ok('...and the course ends up somewhere else', moved.lengthNm != null
  && JSON.stringify(moved.steps) !== JSON.stringify(before.steps));
ok('...the same length as it was — a translation is not a resize',
  Math.abs(moved.lengthNm - before.lengthNm) < 0.01);

// ---- turn
const turn = grips().find((g) => g.dataset.kind === 'trotate');
$('askChoices').innerHTML = '';
H(`${turn.id}:mousedown`)({ stopPropagation() {} });
H('window:mousemove')({ clientX: 500, clientY: 200 });
H('window:mousemove')({ clientX: 560, clientY: 300 });
H('window:mouseup')({ clientX: 560, clientY: 300 });
await answer('here');
const turned = await detail();
ok('turning a course keeps its length too', turned.lengthNm != null
  && Math.abs(turned.lengthNm - moved.lengthNm) < 0.01);
ok('...but the geometry is not where it was',
  JSON.stringify(turned.steps) !== JSON.stringify(moved.steps));

/* ----------------------------------------------- headings, while it is moving */

const labels = (html) => (html.match(/\d{3}&deg;\/\d{3}&deg;/g) || []);
const track = (html) => /stroke-dasharray="6 4"/.test(html);

ok('the track is up when nothing is moving', track($('map').innerHTML));

// A TURN changes every heading, so it shows every leg's.
const turn2 = grips().find((g) => g.dataset.kind === 'trotate');
H(`${turn2.id}:mousedown`)({ stopPropagation() {} });
H('window:mousemove')({ clientX: 520, clientY: 260 });
const turning = $('map').innerHTML;
ok('turning shows the heading and its reciprocal for every leg', labels(turning).length > 1);
ok('...reciprocals really are 180 apart', labels(turning).every((l) => {
  const [a, b] = l.replace(/&deg;/g, '').split('/').map(Number);
  return (a + 180) % 360 === b;
}));
ok('...and the track stands down while they are up', !track(turning));
H('window:mouseup')({ clientX: 520, clientY: 260 });
await answer('here');
ok('the track comes back when the drag ends', track($('map').innerHTML));

// A MOVE changes no heading, so it shows none — the course arrives at the angles it left.
const move2 = grips().find((g) => g.dataset.kind === 'tmove');
H(`${move2.id}:mousedown`)({ stopPropagation() {} });
H('window:mousemove')({ clientX: 430, clientY: 320 });
ok('moving the whole course shows no headings — none of them change',
  labels($('map').innerHTML).length === 0);
H('window:mouseup')({ clientX: 430, clientY: 320 });
await answer('here');

// Dragging ONE line shows only the legs that touch it.
// An inline end of a line the course actually NAMES. After a detach the chart still shows
// the club's original beside the copy, and the original is on no leg of this course.
const now = await detail();
const seq = now.steps.map((s) => (s.step.gate?.length ? s.step.gate : [s.step]).map((a) => a.line));
const named = new Set(seq.flat());
const ends = $('map').querySelectorAll('.lend').filter((g) => named.has(g.dataset.line));
if (ends.length) {
  const line = ends[0].dataset.line;
  let expect = 0;
  for (let i = 0; i < seq.length - 1; i++) {
    if (seq[i].includes(line) || seq[i + 1].includes(line)) expect += 1;
  }
  H(`${ends[0].id}:mousedown`)({ stopPropagation() {} });
  H('window:mousemove')({ clientX: 480, clientY: 300 });
  const some = labels($('map').innerHTML).length;
  ok(`dragging one line shows only the legs that touch it (${some} of ${labels(turning).length})`,
    some === expect && some > 0);
  ok('...with the track down for those too', !track($('map').innerHTML));
  H('window:mouseup')({ clientX: 480, clientY: 300 });
  await answer('adhoc');
} else {
  ok('no inline end on this course to drag', true);
  ok('...', true);
}

report();
