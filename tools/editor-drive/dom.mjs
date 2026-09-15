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
  classList: { add() {}, remove() {}, toggle() {} },
  addEventListener(t, fn) { handlers.set(`${id}:${t}`, fn); this.__on[t] = fn; },
  fire(t, ev = {}) { return this.__on[t]?.(ev); },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
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
      const tag = new RegExp(`<(g|div|select|button|span)([^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*)>`, 'g');
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

const tabs = ['points', 'lines', 'courses'].map((t) => {
  const e = mk(`tab-${t}`);
  e.dataset.tab = t;
  return e;
});
globalThis.document = {
  activeElement: null,
  addEventListener(t, fn) { handlers.set(`document:${t}`, fn); },
  getElementById: (id) => { if (!els.has(id)) els.set(id, mk(id)); return els.get(id); },
  querySelectorAll: (sel) => (sel === '[data-tab]' ? tabs : []),
};
globalThis.window = { addEventListener(t, fn) { handlers.set(`window:${t}`, fn); } };
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

const PORT = process.env.UNMARKABLE_PORT || '8084';
const realFetch = globalThis.fetch;
globalThis.fetch = (p, o) => realFetch(p.startsWith('http') ? p : `http://localhost:${PORT}${p}`, o);

export const $ = (id) => document.getElementById(id);
export const H = (k) => handlers.get(k);
export const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

/** Several lists can be open at once, each in its own slot. */
export const LISTS = ['list_series', 'list_course', 'list_variant', 'list_items'];
export const openLists = () => LISTS.filter((id) =>
  ($('rowSeries').innerHTML + $('rows').innerHTML).includes(`id="${id}"`));
export const rows = () => openLists().flatMap((id) => $(id).querySelectorAll('.row'));
export const listHtml = () => openLists().map((id) => $(id).innerHTML).join('');

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
