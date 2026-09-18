/**
 * A DOM stub good enough to drive editor.js headlessly against a running server.
 *
 * The editor is where the course lifecycle is actually operated, and none of it was in the
 * build — the drivers lived in a scratch directory and were lost the first time /tmp was
 * cleared. They live here now, for the same reason the crossing spec does: what decides a
 * result and is not in the build rots.
 *
 * It is a stub, not a browser. It parses the markup the editor writes and hands back
 * memoised element objects, so a handler that sets an attribute is observable through a
 * later query. Where it is lossy, it is lossy in ways that have bitten before and are
 * commented as such.
 */
const PARENT = {
  order: [],
  appendChild(el) { this.order = this.order.filter((e) => e !== el); this.order.push(el); },
};
export const handlers = new Map();
export const els = new Map();

/** An element that has been replaced answers nothing, exactly as in a browser. */
function forget(id) {
  els.delete(id);
  for (const key of [...handlers.keys()]) {
    if (key.startsWith(`${id}:`)) handlers.delete(key);
  }
}

const mk = (id) => ({
  id, textContent: '', hidden: false, disabled: false, checked: false,
  dataset: {}, style: {}, _value: null, __on: {}, _html: '',
  /**
   * Assigning innerHTML DESTROYS the elements that were in it, and with them their
   * listeners. A stub that quietly kept answering for them could not see a handler wired
   * to an element some later render replaced — which is a real bug, and was one.
   */
  get innerHTML() { return this._html; },
  set innerHTML(v) {
    for (const m of String(this._html).matchAll(/id="([^"]+)"/g)) forget(m[1]);
    this._html = v;
  },
  get value() {
    if (this._value != null) return this._value;
    const m = /value="([^"]*)"/.exec(this.innerHTML || '');
    return m ? m[1] : '';
  },
  set value(v) { this._value = v; },
  /*
   * A class list that REMEMBERS. It used to be three no-ops, which was fine while nothing but
   * appearance hung off a class — and stopped being fine when the phone started marking itself
   * as being dragged, since "is it being dragged" is then a question with no answer.
   */
  classList: (() => {
    const held = new Set();
    return {
      add: (...names) => names.forEach((n) => held.add(n)),
      remove: (...names) => names.forEach((n) => held.delete(n)),
      toggle: (n, on) => ((on ?? !held.has(n)) ? held.add(n) : held.delete(n)),
      contains: (n) => held.has(n),
    };
  })(),
  addEventListener(t, fn) { handlers.set(`${id}:${t}`, fn); this.__on[t] = fn; },
  fire(t, ev = {}) { return this.__on[t]?.(ev); },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
  // The laid-out size, which is what the phone's drag clamps against. The same numbers the
  // rect gives, because a stub that disagreed with itself about how big a thing is would be
  // worse than one that is merely approximate.
  offsetWidth: 900,
  offsetHeight: 600,
  _attrs: {},
  setAttribute(k, v) { this._attrs[k] = v; },
  getAttribute(k) { return this._attrs[k] ?? null; },
  removeAttribute(k) { delete this._attrs[k]; },
  parentNode: PARENT,
  closest() { return null; },
  select() {},
  // Pointer capture is a browser concern with no meaning here, but a page that uses it
  // would throw on the first pointerdown — so the stub has to answer, not to do anything.
  setPointerCapture() {},
  releasePointerCapture() {},
  /**
   * The first match, or null — the DOM's own definition.
   *
   * Here because the page reaches for `.plot` this way to wire the overview's pan, and without
   * it the optional call quietly did nothing: the drag was unwired in every driver and looked
   * like a passing test rather than an untested gesture.
   */
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; },
  querySelectorAll(sel) {
    const out = [];
    const node = (key, attrs, extra = {}) => {
      if (!els.has(key)) els.set(key, mk(key));
      const e = els.get(key);
      Object.assign(e.dataset, attrs);
      Object.assign(e, extra);
      return e;
    };
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      if (new RegExp(`id="${id}"`).test(this.innerHTML)) out.push(node(id, {}));
      return out;
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      // `svg` is in the list because the page selects its charts that way — `.plot` is an
      // <svg> — and a matcher that knew every tag but that one answered null and left the
      // overview's pan unwired in every driver.
      const tag = new RegExp(`<(g|div|select|button|span|svg)([^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*)>`, 'g');
      let m; let n = 0;
      while ((m = tag.exec(this.innerHTML))) {
        // EVERY data-*, not just data-id. Capturing only the id once produced nodes the
        // editor could find but not act on — the handler had nothing to look up.
        const attrs = {};
        for (const a of m[2].matchAll(/data-([a-z]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
        const idPart = attrs.id ?? attrs.series
          ?? (attrs.course ? `${attrs.course}/${attrs.variant ?? ''}` : String(n));
        out.push(node(`${this.id}:${cls}#${idPart}`, attrs, { disabled: / disabled/.test(m[2]) }));
        n++;
      }
      return out;
    }
    // AN ATTRIBUTE SELECTOR, which the page really uses — `[data-view]`, `[data-orient]` — and
    // which this stub used to get silently and spectacularly wrong: it fell through to the tag
    // branch below, where `[data-view]` is a CHARACTER CLASS and `<[data-view]...>` happily
    // matches `<div>`. So the handlers were wired to nodes that stood for divs, and a driver
    // could see the buttons in the markup but never press one. Keyed by the attribute's value
    // rather than by position, so a handler wired on one render is found on the next.
    const byAttr = /^\[data-([a-z]+)\]$/.exec(sel);
    if (byAttr) {
      const want = byAttr[1];
      const open = /<[a-z]+([^>]*)>/g;
      let m;
      while ((m = open.exec(this.innerHTML))) {
        const attrs = {};
        for (const a of m[1].matchAll(/data-([a-z]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
        if (!(want in attrs)) continue;
        out.push(node(`${this.id}:[data-${want}]=${attrs[want]}`, attrs,
          { disabled: / disabled/.test(m[1]) }));
      }
      return out;
    }
    const tag = new RegExp(`<${sel}([^>]*)>`, 'g');
    let m; let n = 0;
    while ((m = tag.exec(this.innerHTML))) {
      const attrs = {};
      for (const a of m[1].matchAll(/data-([a-z]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
      out.push(node(`${this.id}:${sel}${n++}`, attrs, { disabled: / disabled/.test(m[1]) }));
    }
    return out;
  },
});

const tabs = ['points', 'lines', 'courses', 'races'].map((t) => {
  const e = mk(`tab-${t}`);
  e.dataset.tab = t;
  return e;
});
globalThis.document = {
  activeElement: null,
  addEventListener(t, fn) { handlers.set(`document:${t}`, fn); },
  // Removal matters here rather than being tidiness: the overview's pan follows the DOCUMENT
  // for the length of a drag and lets go on pointerup, and a stub that could only add would
  // make "it lets go when the finger does" untestable — which is the half of a drag that goes
  // wrong.
  removeEventListener(t, fn) {
    if (handlers.get(`document:${t}`) === fn) handlers.delete(`document:${t}`);
  },
  getElementById: (id) => { if (!els.has(id)) els.set(id, mk(id)); return els.get(id); },
  querySelectorAll: (sel) => (sel === '[data-tab]' ? tabs : []),
};
// A window with a SIZE, because the phone clamps itself to one and a drag against `undefined`
// lands at NaN — which is a position no test would catch and no browser would show.
globalThis.window = {
  innerWidth: 1400,
  innerHeight: 900,
  addEventListener(t, fn) { handlers.set(`window:${t}`, fn); },
};
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

/*
 * A SESSION STORE, because the join screen remembers who the boat is in one. Strings in, strings
 * out, no events and no quota — which is all the page asks of it. Real enough to prove what is
 * kept and, just as much to the point, what is not.
 */
globalThis.sessionStorage = (() => {
  const held = new Map();
  return {
    getItem: (k) => (held.has(k) ? held.get(k) : null),
    setItem: (k, v) => { held.set(k, String(v)); },
    removeItem: (k) => { held.delete(k); },
    clear: () => held.clear(),
  };
})();

const PORT = process.env.UNMARKABLE_PORT || '8084';
const realFetch = globalThis.fetch;
globalThis.fetch = (p, o) => realFetch(p.startsWith('http') ? p : `http://localhost:${PORT}${p}`, o);

export const $ = (id) => document.getElementById(id);
export const H = (k) => handlers.get(k);
export const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/*
 * THE PANE IS SELECTORS NOW, not lists that open. One level is a label, a `<select>` and that
 * level's commands, so driving it means reading the options and firing a change — which is
 * what a person does with it and is a great deal less to say than opening a list, finding a
 * row and clicking it.
 */

/** The markup of both row containers, which is where every selector lives. */
export const paneHtml = () => $('rowSeries').innerHTML + $('rows').innerHTML;

/** What one level offers, as values, in the order it offers them. Empty options excluded. */
export const optionsOf = (level) => {
  const block = new RegExp(`<select id="sel_${level}"[^>]*>([\\s\\S]*?)</select>`).exec(paneHtml());
  if (!block) return [];
  return [...block[1].matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
};

/** What one level has chosen, or '' when it is still a question. */
export const chosenIn = (level) => {
  const block = new RegExp(`<select id="sel_${level}"[^>]*>([\\s\\S]*?)</select>`).exec(paneHtml());
  const m = block && /<option value="([^"]*)" selected/.exec(block[1]);
  return m ? m[1] : '';
};

/**
 * Choose a value at one level, the way a person does.
 *
 * <b>Re-choosing the option that is already selected fires NOTHING</b>, because that is what a
 * `<select>` does: `change` means the value changed. A stub that fired it anyway modelled a
 * browser behaviour that does not exist — and hid a real dead end for exactly as long as it
 * did, since the snapshot level's way back to the design was written as "choose the chosen one
 * again" and could never once have run in a browser. A driver asserted it and passed.
 *
 * The empty option is still choosable this way (`choose('snapshot', '')`), because an empty
 * value IS a change from a chosen one.
 */
export const choose = (level, value) => {
  const sel = $(`sel_${level}`);
  if (chosenIn(level) === value) return undefined;
  sel.value = value;
  return sel.fire('change', { target: { value } });
};

/** Fold or unfold a level's fields. */
export const unfold = (level) => H(`fold_${level}:click`)?.();

let pass = 0;
let fail = 0;
export const ok = (what, condition) => {
  if (condition) pass += 1;
  else fail += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${what}`);
};
export const report = () => {
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
};
