/**
 * A STEP THAT ROUNDS A POINT, through the editor: added with its own button, written to the file as
 * `point:`, toggled between port and starboard, and drawn as the mark with an arc round it.
 */
import { $, H, choose, ok, optionsOf, report, settle } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

const get = async (p) => (await fetch(p)).json();
const [prog] = await get('/api/programmes');
const url = `/api/programmes/${prog.club}/${prog.series}`;

H('tab-courses:click')();
await settle();
const COURSE = optionsOf('course')[0];
choose('course', COURSE);
await settle(600);
const VARIANT = optionsOf('variant')[0];
choose('variant', VARIANT);
await settle(700);

const sequence = async () => (await get(url)).courses[COURSE].variants?.[VARIANT]?.sequence
  ?? (await get(url)).courses[COURSE].sequence;
const before = (await sequence()).length;
ok('the sequence offers a point to round beside a line to cross', $('variantForm').innerHTML.includes('id="c_addpt"'));
H('c_addpt:click')();
await settle(1200);
const after = await sequence();
const added = after[after.length - 1];
ok('Add point puts a rounding on the end of the course', after.length === before + 1 && !!added.point && !added.line);
ok('...a port rounding to begin with', String(added.cross).toLowerCase() === 'forward');
ok('...shown as a point and its side, not a line and a sense',
  $('c_steps').innerHTML.includes('class="s_point"') && />port</.test($('c_steps').innerHTML));

const toggle = $('c_steps').querySelectorAll('.s_dir').at(-1);
toggle.fire('click', {});
await settle(1200);
ok('its side is toggled to starboard, and saved', String((await sequence()).at(-1).cross).toLowerCase() === 'reverse');

ok('it is drawn as the mark with an arc round it', new RegExp(`data-id="[^"]*@${added.point}"`).test($('map').innerHTML)
  && / A16\.0 16\.0 0 /.test($('map').innerHTML));

report();
