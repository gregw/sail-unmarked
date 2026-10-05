/**
 * A typed field is SAVED WITHOUT A BLUR.
 *
 * The forms save on blur, and two ordinary ways of finishing a field never blur it: Enter, which
 * commits it and keeps the focus, and leaving the page from inside it. Either left a course's
 * name on the screen and out of the file. These drive `change` with no blur behind it, and an
 * unload with the field still focused.
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

/** Type into a field as a browser does: focus, then input, and nothing after. */
const type = (field, value) => {
  const input = $(field);
  input.tagName = 'INPUT';
  H(`${field}:focus`)?.();
  globalThis.document.activeElement = input;
  input.value = value;
  H(`${field}:input`)({ target: { value } });
  return input;
};

// Enter: the `change` reaches the document, and the field keeps the focus.
const name = type('c_name', 'A name committed with Enter');
H('document:change')({ target: name });
await settle(1100);
ok('a course name committed with Enter reaches the file',
  (await get(url)).courses[COURSE].name === 'A name committed with Enter');

// Leaving the page from inside the field, with no change and no blur.
type('c_name', 'A name left by closing the page');
H('window:beforeunload')({ preventDefault() {} });
await settle(1100);
ok('a course name left by closing the page reaches the file',
  (await get(url)).courses[COURSE].name === 'A name left by closing the page');

report();
