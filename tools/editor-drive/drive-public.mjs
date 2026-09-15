/**
 * The public tickbox, and the audit trail behind it.
 *
 * Visibility has TWO switches and either one turns it on: publish a snapshot to a course
 * that is public, or make public a course that already has one published. A client will join
 * a course and be pushed its published snapshots, so both moments are moments a fleet's
 * options changed — and both have to be in a log anybody can read, or "what was I handed, and
 * when?" has no answer after the fact.
 */
import { $, H, ok, report, settle } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const list = (id) => $(id).querySelectorAll('.row');
const get = async (p) => (await fetch(p)).json();
const variants = () => {
  if (!$('rows').innerHTML.includes('list_variant')) H('crumb_variant:click')();
  return list('list_variant');
};
const publicly = async (course) => (await get('/api/public')).find((c) => c.course === course);
const log = () => get('/api/log');

const [prog] = await get('/api/programmes');

H('tab-courses:click')();
await settle();
// The first course that is not ALREADY public, rather than simply the first. The fixture
// is a copy of the real data/config, which is edited between runs and now has public
// courses in it — a driver that assumed row zero was private was asserting something
// about the fixture rather than about the editor, and said so by failing.
const already = new Set((await get('/api/public')).map((c) => c.course));
const startRow = list('list_course').find((r) => !already.has(r.dataset.course))
  ?? list('list_course')[0];
const COURSE = startRow.dataset.course;
H(`${startRow.id}:click`)();
await settle(700);
H(`${variants()[0].id}:click`)();
await settle(800);
const VARIANT = variants()[0].dataset.variant;

/* ---------------------------------------------------------------- private by default */

ok('a course is private until somebody says otherwise', !(await publicly(COURSE)));
ok('...and the form offers the tickbox, unticked',
  $('courseForm').innerHTML.includes('id="c_public"')
  && !/id="c_public"[^>]*checked/.test($('courseForm').innerHTML));
const quiet = (await log()).length;

/* ------------------------------------------------------- public, with nothing under it */

$('c_public').checked = true;
H('c_public:change')({ target: { checked: true } });
await settle(1200);

const listed = await publicly(COURSE);
ok('ticking public lists the course', !!listed);
ok('...with nothing under it, because being SEEN and being joinable are different',
  listed.published.length === 0);
ok('...and logs nothing, since nothing became joinable', (await log()).length === quiet);
ok('...and the list says so at a glance', $('list_course').innerHTML.includes('>public<'));

/* ------------------------------------------------- publishing to it is the visible event */

// Captured on the variant, released on the COURSE: the per-variant publish button is gone,
// because publishing one variant at a time is the thing that made a many-variant course a list
// to walk on the one morning there is no time to walk one.
H('cmd_snapshot:click')();
await settle(1400);
H('c_publish_latest:click')();
await settle(1600);

const offered = await publicly(COURSE);
ok('publishing to a public course puts the snapshot under it', offered.published.length >= 1);
ok('...naming the exact revision boats are handed',
  /^[0-9a-f]{12}$/.test(offered.published[0].revision));
// Read off the ARCHIVED snapshot rather than recomputed from the file, because this is the
// course boats were given and the file is free to move on.
ok('...with the length of what was handed over', typeof offered.published[0].lengthNm === 'number');

const after = await log();
ok('...and the event is in a log anybody can read', after.length >= quiet + 1);
ok('...saying what happened', after[0].what === 'published');
ok('...to which course', after[0].course === COURSE && after[0].variant === VARIANT);
ok('...of which geometry', after[0].revision === offered.published[0].revision);
ok('...and when', /^\d{4}-\d{2}-\d{2}T/.test(after[0].at));

/* ------------------------------------------------------ and the way back out is logged too */

$('c_public').checked = false;
H('c_public:change')({ target: { checked: false } });
await settle(1200);

ok('unticking takes the course off the public list', !(await publicly(COURSE)));
const closed = await log();
ok('...and says so, because a trail of only arrivals cannot explain a disappearance',
  closed[0].what === 'closed');
ok('...newest first', closed.length === quiet + 2);
ok('...still naming what stopped being visible',
  closed[0].course === COURSE && closed[0].revision === offered.published[0].revision);

/* ---------------------------------------------------------------- and it is in the FILE */

const saved = await get(`/api/programmes/${prog.club}/${prog.series}`);
ok('the flag lives in the programme file, not only in the ledger',
  saved.courses[COURSE].public === false);

report();
