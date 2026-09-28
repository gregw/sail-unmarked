/**
 * A handicap line, from the editor to the join.
 *
 * `handicapWidthM` is a field of a LINE in the programme file, so it has to be carried in all the
 * places `CLAUDE.md` names — and the fourth, the change guard in `endEdit`, fails silently: the
 * chart shows the edit and the file never hears of it. So the width is changed here the ways a
 * person changes it, by the line form and by dragging the grip, and each time the FILE is read
 * back. Then the course is snapshotted and published and a boat joins it, which is where the TCF
 * range stops being a number in a header and becomes a refusal.
 */
import { readFileSync } from 'node:fs';
import { $, H, choose, chosenIn, ok, optionsOf, report, settle } from './dom.mjs';

const KEY = 'myc.org.au/2026-windward-leeward';
const FILE = new URL('../../target/editor-drive/config/clubs/myc.org.au/2026-windward-leeward.yaml',
  import.meta.url);
const onDisk = () => readFileSync(FILE, 'utf8');
/** The windward track's block as the file has it. */
const trackBlock = () => (/\n  windward-track:\n(?: {4}.*\n)+/.exec(onDisk()) ?? [''])[0];
const widthOnDisk = () => Number((/handicapWidthM: (\d+(?:\.\d+)?)/.exec(trackBlock()) ?? [])[1]);

await import('../../client/www/editor.js');
await settle(900);

const map = () => $('map').innerHTML;
const form = () => $('form').innerHTML;

// ------------------------------------------------------------ the line
H('tab-lines:click')();
await settle();
choose('series', KEY);
await settle(700);
choose('items', 'windward-track');
await settle(700);

ok('the line form says how wide a handicap line\'s boats\' lines are', /id="l_width"[^>]*value="80"/.test(form()));
ok('the line draws its zone, striped, with no course round it', map().includes('handicap-stripes'));
ok('...and a grip on the selected line to change the width by', map().includes('class="hgrip"'));

const grip = $('map').querySelectorAll('.hgrip')[0];
grip.fire('mousedown', { stopPropagation() {} });
// Well out to one side of the track, which runs north–south up the middle of the chart.
H('window:mousemove')({ clientX: 100, clientY: 300 });
H('window:mousemove')({ clientX: 60, clientY: 300 });
H('window:mouseup')({ clientX: 60, clientY: 300 });
await settle(1200);
const dragged = widthOnDisk();
ok('dragging the grip changes the width IN THE FILE, not just on the chart', dragged > 0 && dragged !== 80);
ok('...to the metre', Number.isInteger(dragged));

H('l_width:focus')();
H('l_width:change')({ target: { value: '' } });
H('l_width:blur')();
await settle(1200);
ok('emptying the field makes it a line crossed as itself, in the file', !trackBlock().includes('handicapWidthM'));
ok('...and takes its stripes off the chart', !map().includes('handicap-stripes'));

H('l_width:focus')();
H('l_width:change')({ target: { value: '80' } });
H('l_width:blur')();
await settle(1200);
ok('typing a width writes it back', widthOnDisk() === 80);

// ------------------------------------------------------------ in a course
H('tab-courses:click')();
await settle();

// A course that does not name the track: the line is still drawn, and so is its zone — the
// width is the line's, whether or not anybody sails it yet.
choose('course', 'downwind-gate');
await settle(700);
if (!chosenIn('variant')) choose('variant', optionsOf('variant')[0]);
await settle(900);
ok('a handicap line\'s zone is drawn wherever the line is, in a course that does not name it too',
  !/>windward-track</.test(map()) || map().includes('handicap-stripes'));
ok('...and the line is on the chart, so that says something', />windward-track</.test(map()));

choose('course', 'handicap');
await settle(700);
if (!chosenIn('variant')) choose('variant', optionsOf('variant')[0]);
await settle(900);
const steps = () => $('c_steps').innerHTML;

ok('the step naming the track says it is handicapped', (steps().match(/class="s_hcap/g) ?? []).length === 1);
ok('the course stripes the zone too', map().includes('handicap-stripes'));
ok('...but offers no grip: the width is the line\'s, changed where the line is', !map().includes('class="hgrip"'));
ok('the header gives the TCFs the course takes, beside its length', /TCF \d\.\d{3}&ndash;\d\.\d{3}/.test($('c_len').innerHTML));

// The track runs north–south up the course, and a boat's line lies square to it: so the step's
// triangle has its base east–west and points north, the way a boat crosses its own line — not
// east or west, across the track that nobody crosses.
const tri = /<g class="cmark" data-id="1@windward-track"[^>]*>(?:<[^>]*>)*?<polygon points="([^"]+)"/.exec(map());
const [a, b, apex] = (tri?.[1] ?? '').split(' ').map((p) => p.split(',').map(Number));
ok('the handicapped step\'s triangle lies along the boats\' lines, not along the track',
  !!tri && Math.abs(a[1] - b[1]) < 1 && Math.abs(a[0] - b[0]) > 5);
ok('...and points the way a boat crosses one: out along the track, north', !!tri && apex[1] < a[1] - 5);

// ------------------------------------------------------------ published, then joined
const json = async (path, options) => {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return response.json();
};
const post = (path, body) => json(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});
const taken = await post(`/api/lifecycle/${KEY}/snapshots`, { course: 'handicap', variant: 'one-lap' });
ok('the handicapped course snapshots', taken.snapshot?.steps?.length === 3);
ok('...carrying the TCFs it can take', taken.snapshot.tcfMin < 1 && taken.snapshot.tcfMax > 1);
ok('...and which end of the track is near', taken.snapshot.steps[1].handicapNear === 'starboard');
await post(`/api/lifecycle/${KEY}/publications`, { publish: [{ course: 'handicap', variant: 'one-lap' }] });

const join = (tcf) => fetch(`/api/join/${KEY}/handicap?variant=one-lap${tcf == null ? '' : `&tcf=${tcf}`}`,
  { method: 'POST' });
ok('a boat with no TCF is refused', (await join(null)).status === 409);
ok('...and one outside the range', (await join(taken.snapshot.tcfMax + 0.1)).status === 409);
const joined = await join(1);
ok('a 1.000 boat is handed the course', joined.status === 200);
ok('...which is the published snapshot, handicap and all', (await joined.json()).tcfMin === taken.snapshot.tcfMin);

report();
