/**
 * A PUBLIC RACE IS JOINED BEFORE ITS COURSE IS PUBLISHED, driven.
 *
 * The committee opens the race and sets the course once it has seen the wind; the boats are
 * entered meanwhile and wait near the start. So a boat joins a race whose course is private and
 * has nothing published, is shown a zone around the start line to wait in, and — the moment the
 * club publishes — is handed the course and sails it, without joining again.
 *
 * Driven on the rig page, which is the boat's own client with a simulated receiver.
 */
import { $, H, ok, report, settle } from './dom.mjs';

const json = async (path, options) => {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} → ${response.status} ${(await response.text()).slice(0, 180)}`);
  return response.json();
};
const post = (path, body) => json(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
});

/* ------------------------------------------ a race, and a course nobody has published */

const [programme] = await json('/api/programmes');
const KEY = `${programme.club}/${programme.series}`;
const file = await json(`/api/programmes/${KEY}`);

let taken = null;
for (const [course, body] of Object.entries(file.courses)) {
  for (const variant of Object.keys(body.variants ?? { main: {} })) {
    try {
      const result = await post(`/api/lifecycle/${KEY}/snapshots`, { course, variant });
      if (result.snapshot?.steps?.length >= 2) taken = { course, variant };
    } catch { /* incomplete, or a template */ }
    if (taken) break;
  }
  if (taken) break;
}
if (!taken) {
  ok('the fixture holds a course that can be published', false);
  report();
}
// Captured and NOT published, and private: the race is the only way in.
await post(`/api/lifecycle/${KEY}/publications`, { withdraw: [taken] });
file.courses[taken.course].public = false;
const races = {
  'waiting-race': {
    name: 'Waiting race',
    date: new Date().toLocaleDateString('en-CA'),
    divisions: { open: { course: taken.course, variant: taken.variant } },
  },
};
await fetch(`/api/programmes/${KEY}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ points: file.points, lines: file.lines, courses: file.courses, races }),
});

/* ------------------------------------------------------------------ the server's answer */

const joinOver = async (body) => (await post('/api/dialog', { envelopes: [
  { v: 1, type: 'hello', body: { versions: [1] } },
  { v: 1, type: 'join', body: { club: programme.club, series: programme.series, ...body } },
] })).envelopes;
const joined = (await joinOver({ sailNo: 'AUS 7', course: taken.course, variant: taken.variant,
  race: 'waiting-race', division: 'open' })).find((m) => m.type === 'joined');
ok('a public race is joined although its course is private and unpublished', !!joined);
ok('...handing no course, but where the start is and the word to wait',
  !joined?.body?.course && joined?.body?.waiting?.startLine?.port?.latitude != null
  && /wait/i.test(joined?.body?.waiting?.text ?? ''));

/* --------------------------------------------------------------------- the rig page */

globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
await import('../../client/www/client.js');
await settle(1200);

const device = () => $('device').innerHTML || '';
const pick = (field, value) => { H(`j_${field}:change`)({ target: { value } }); };
H('j_sail:input')({ target: { value: 'AUS 1' } });
pick('club', programme.club);
pick('series', programme.series);
ok('a series with a public race is offered though none of its courses is public',
  device().includes('id="j_race"') && device().includes('waiting-race'));
pick('race', 'waiting-race');
pick('division', 'open');
ok('the screen says the course is not published yet, and that the boat can join and wait',
  device().includes('is not published yet') && /id="j_go">Join and sail</.test(device()));

H('j_go:click')();
await settle(2000);
ok('joined, the boat waits on the course screen: the start line in a zone, and the word to wait',
  device().includes('<svg class="plot"') && device().includes('class="waitzone"')
  && device().includes('wait for the course'));
const zoneR = Number(/class="waitzone"[^>]*\sr="([\d.]+)"/.exec(device())?.[1]);
ok('...opened wide, five miles across, with the zone a small ring in it rather than the fit',
  zoneR > 0 && zoneR < 25 && /data-zoom="fit" class="on"/.test(device()));
ok('...with the chart\'s controls and the orientations live', device().includes('id="o_basemap"')
  && device().includes('id="o_orient"') && device().includes('data-zoom="in"'));
ok('...with the race\'s start row above it, and a way out', device().includes('id="leave"'));
ok('...on the chart, chosen for it, so the zone can be found on the water',
  /class="basemap"[\s\S]*class="waitzone"/.test(device()) && device().includes('<image'));

/* --------------------------------------------------- and the club publishes the course */

await post(`/api/lifecycle/${KEY}/publications`, { publish: [taken] });
const started = await until(() => !device().includes('class="waitzone"'));
ok('publishing hands the waiting boat its course, and it sails without joining again',
  started && device().includes('<svg class="plot"'));
ok('...the zone and the word to wait gone', !device().includes('wait for the course'));

report();

async function until(test, seconds = 15) {
  for (let i = 0; i < seconds * 4; i++) {
    if (test()) return true;
    await settle(250);
  }
  return test();
}
