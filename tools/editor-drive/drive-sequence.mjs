/**
 * The variant's sequence, and the fold over it.
 *
 * The sequence is the longest thing in a 495px pane and the one most often already known —
 * you came back to move a mark, not to re-read the course. Folded it has to answer the two
 * questions worth asking from outside it (how many crossings, how far), and unfolding has
 * to bring back an editor that still WORKS: the form is guarded against needless rewrites
 * so the caret stays where somebody is typing, and a guard that did not know about the fold
 * would recognise the folded form as the same one and never redraw it.
 */
import { $, H, choose, chosenIn, ok, optionsOf, paneHtml, report, settle, unfold } from './dom.mjs';

await import('../../client/www/editor.js');
await settle(900);

// The variant's fields sit inline under its own selector now, not in the one form region at
// the foot of the pane — a level's fields belong with the level.
const form = () => $('variantForm').innerHTML;
const steprows = () => $('c_steps').querySelectorAll('.steprow').length;
const folded = () => !form().includes('id="c_steps"');
/** What the header says about itself: the count it shows once there are no rows to count. */
const summary = () => (/>(\d+ lines?|empty)</.exec(form()) ?? [])[1];

H('tab-courses:click')();
await settle();
choose('course', optionsOf('course')[0]);
await settle(600);
if (!chosenIn('variant')) choose('variant', optionsOf('variant')[0]);
await settle(700);

// Whatever the fixture holds, make sure there is something to count.
while (steprows() < 2) { H('c_add:click')(); await settle(700); }

/* ------------------------------------------------------------------ open by default */

ok('a variant opens with its sequence showing — the sequence IS the course', !folded());
ok('...with the rows to edit it', steprows() >= 2);
ok('...and the two ways to extend it',
  form().includes('id="c_add"') && form().includes('id="c_alt"'));

const was = steprows();
const length = $('c_len').innerHTML;
ok('...and the length, which the server computed', /nm$/.test(length));

/* ----------------------------------------------------------------------- folding it */

H('c_seq:click')();
await settle(700);

ok('the chevron folds it away', folded());
ok('...taking the Add buttons with it — adding a step you cannot see is not on offer',
  !form().includes('id="c_add"') && !form().includes('id="c_alt"'));
ok('...and folded it says how many lines are in the list', summary() === `${was} lines`);
ok('...and still says how far, which is the other thing worth knowing from outside it',
  $('c_len').innerHTML === length);

/* ------------------------------------------------------- unfolding, and still working */

H('c_seq:click')();
await settle(700);

ok('the chevron brings it back', !folded());
ok('...with the same rows', steprows() === was);
// The bug this guards: the form is only rewritten when its key changes, and a key that did
// not carry the fold would call the folded form identical and leave it folded.
ok('...and an editor that still answers, not markup with nothing listening',
  typeof H('c_add:click') === 'function' && typeof H('c_seq:click') === 'function');

H('c_add:click')();
await settle(800);
ok('...which it does — a step added after a fold lands', steprows() === was + 1);

/* ------------------------------------------------------------------ a gate is two lines */

H('c_alt:click')();
await settle(800);
const gated = steprows();
ok('an alternative is another row in the list', gated === was + 2);

H('c_seq:click')();
await settle(700);
ok('...and the folded count says so — a gate is one step but two lines to cross',
  summary() === `${gated} lines`);

report();
