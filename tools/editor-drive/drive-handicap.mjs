/**
 * A step handicapped by distance, from the editor to the join.
 *
 * `handicapWidthM` is a new field in the programme file, so it has to be carried in all the
 * places `CLAUDE.md` names — and the fourth, the change guard in `endEdit`, fails silently: the
 * chart shows the edit and the file never hears of it. So the width is changed here the ways a
 * person changes it, by the toggle and by dragging the grip, and each time the FILE is read back.
 * Then the course is snapshotted and published and a boat joins it, which is where the TCF range
 * stops being a number in a header and becomes a refusal.
 */
import { readFileSync } from 'node:fs';
import { $, H, choose, chosenIn, ok, optionsOf, report, settle } from './dom.mjs';

const KEY = 'myc.org.au/2026-windward-leeward';
const FILE = new URL('../../target/editor-drive/config/clubs/myc.org.au/2026-windward-leeward.yaml',
  import.meta.url);
const onDisk = () => readFileSync(FILE, 'utf8');
/** The `handicap` course's windward step as the file has it. */
const windwardStep = () => (/- \{line: windward-track[^}]*\}/.exec(onDisk()) ?? [''])[0];

await import('../../client/www/editor.js');
await settle(900);

H('tab-courses:click')();
await settle();
choose('series', KEY);
await settle(700);
choose('course', 'handicap');
await settle(700);
if (!chosenIn('variant')) choose('variant', optionsOf('variant')[0]);
await settle(900);

const steps = () => $('c_steps').innerHTML;
const map = () => $('map').innerHTML;

ok('the windward step says it is handicapped, and how wide', steps().includes('hcp 80'));
ok('...and the start and the finish offer no handicap — a start line is crossed as itself',
  (steps().match(/class="s_hcap/g) ?? []).length === 1);
ok('the chart stripes everywhere a boat\'s line may lie', map().includes('handicap-stripes'));
ok('...with a grip to change the width by', map().includes('class="hgrip"'));
ok('the header gives the TCFs the course takes, beside its length', /TCF \d\.\d{3}&ndash;\d\.\d{3}/.test($('c_len').innerHTML));

// ------------------------------------------------------------ dragging the width
const grip = $('map').querySelectorAll('.hgrip')[0];
grip.fire('mousedown', { stopPropagation() {} });
// Well out to one side of the track, which runs north–south up the middle of the chart.
H('window:mousemove')({ clientX: 100, clientY: 300 });
H('window:mousemove')({ clientX: 60, clientY: 300 });
H('window:mouseup')({ clientX: 60, clientY: 300 });
await settle(1200);
const dragged = Number((/handicapWidthM: (\d+(?:\.\d+)?)/.exec(windwardStep()) ?? [])[1]);
ok('dragging the grip changes the width IN THE FILE, not just on the chart', dragged > 0 && dragged !== 80);
ok('...to the metre', Number.isInteger(dragged));
ok('...and the button says the new width', steps().includes(`hcp ${dragged}`));

// ------------------------------------------------------------ the toggle
const toggle = () => $('c_steps').querySelectorAll('.s_hcap')[0];
toggle().fire('click', {});
await settle(1200);
ok('turning it off takes the width out of the file', !windwardStep().includes('handicapWidthM'));
ok('...and the stripes off the chart', !map().includes('handicap-stripes'));

toggle().fire('click', {});
await settle(1200);
ok('turning it back on writes a width again', /handicapWidthM: \d+/.test(windwardStep()));
ok('...and the stripes come back', map().includes('handicap-stripes'));

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
