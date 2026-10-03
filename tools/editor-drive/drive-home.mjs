/**
 * THE FRONT PAGE'S COURSE DISPLAY, driven: club, series and course chosen from what is public and
 * published, and the published snapshot drawn on the plain chart, north up and fitted.
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

/* ------------------------------------------------- a public course, captured and published */

let shown = null;
for (const { club, series } of await json('/api/programmes')) {
  const KEY = `${club}/${series}`;
  const file = await json(`/api/programmes/${KEY}`);
  for (const [course, body] of Object.entries(file.courses)) {
    if (!body.public) continue;
    for (const variant of Object.keys(body.variants ?? { main: {} })) {
      try {
        const taken = await post(`/api/lifecycle/${KEY}/snapshots`, { course, variant });
        if (taken.snapshot?.steps?.length >= 2) {
          await post(`/api/lifecycle/${KEY}/publications`, { publish: [{ course, variant }] });
          shown = { club, series, course, variant, snapshot: taken.snapshot };
        }
      } catch { /* incomplete, or a template */ }
      if (shown) break;
    }
    if (shown) break;
  }
  if (shown) break;
}
if (!shown) {
  ok('the fixture holds a public course that can be published', false);
  report();
}

/* ------------------------------------------------------------------------- the page */

await import('../../client/www/home.js');
await settle(1200);

const html = (id) => $(id).innerHTML || '';
const chosen = (id) => (/<option value="([^"]*)" selected/.exec(html(id)) ?? [])[1];
const pick = async (id, value) => {
  H(`${id}:change`)({ target: { value } });
  await settle(900);
};

ok('the clubs with something public are offered', html('h_club').includes(`value="${shown.club}"`));
await pick('h_club', shown.club);
ok('...then that club\'s series', html('h_series').includes(`value="${shown.series}"`));
await pick('h_series', shown.series);
ok('...then its published courses, by course and variant',
  html('h_course').includes(`value="${shown.course}/${shown.variant}"`));
await pick('h_course', `${shown.course}/${shown.variant}`);
ok('the choice holds', chosen('h_course') === `${shown.course}/${shown.variant}`);

const chart = html('h_chart');
ok('the course is drawn', chart.includes('<svg class="plot"'));
ok('...on the plain chart', chart.includes('class="basemap"') && chart.includes('<image'));
ok('...north up, so there is no north pointer', !chart.includes('>N</text>'));
const lines = new Set(shown.snapshot.steps.flatMap((s) => s.crossings.map((c) => c.line))).size;
ok('...with only the lines the course crosses', (chart.match(/<line [^>]*stroke-width="(2|3\.5)"/g) ?? []).length === lines);

report();
