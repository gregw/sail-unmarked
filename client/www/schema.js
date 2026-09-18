/**
 * A JSON Schema validator small enough to put on a boat — dialog document §10.
 *
 * <b>The client's validator is a deliberate constraint on the schemas, not the other way
 * round.</b> This codebase has no framework, no npm build and no bundler, and the client is
 * offline-first: pulling in a full JSON Schema implementation is a cost paid on every phone, for
 * a protocol whose messages are a dozen fields each. So the schemas are held to a subset this
 * file covers — `type`, `properties`, `required`, `enum`, `const`, `items`,
 * `minimum`/`maximum`, `pattern` and `format: date-time` — and a schema that needs more than
 * that is a message that should be simpler.
 *
 * <b>`additionalProperties` is always true and is never written</b>, which is §5 rule 2 put
 * where a validator can enforce it: unknown fields are ignored on both sides, because that is
 * what lets an installed client and an updated server go on talking. It is also why validation
 * cannot be strict about what it has not heard of — and why an unknown message TYPE is accepted
 * here rather than refused, since every future type will meet clients that predate it.
 *
 * `Schemas.java` is the same subset in Java, because the document says both sides validate.
 * Two validators is the price of that rule; the alternative is one side trusting the other,
 * which is the thing the rule exists to prevent. `schema-test.js` is the spec they are both
 * held to.
 */

/** ISO-8601 with a timezone, which is the whole of what `format: date-time` means here. */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:?\d{2})$/;

const TYPES = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
};

/**
 * Check a value against a schema. Null when it is sound, else a sentence saying what is wrong.
 *
 * A sentence rather than a boolean because the one thing anybody does with a failure is show it
 * to somebody or log it, and "false" is the least useful thing a validator can say.
 */
export function validate(schema, value, where = 'body') {
  if (!schema || typeof schema !== 'object') return null;

  // ABSENT IS NOT WRONG, unless `required` said so. A field is only ever added (§5 rule 1), so
  // a message from a client that predates one simply does not carry it.
  if (value === undefined || value === null) {
    return Array.isArray(schema.required) && schema.required.length && TYPES.object(value)
      ? `${where} is missing ${schema.required[0]}` : null;
  }

  if (schema.type && TYPES[schema.type] && !TYPES[schema.type](value))
    return `${where} should be ${schema.type}`;

  if (Array.isArray(schema.enum) && !schema.enum.some((option) => String(option) === String(value)))
    return `${where} should be one of ${schema.enum.join(', ')}`;
  if ('const' in schema && String(schema.const) !== String(value))
    return `${where} should be ${schema.const}`;

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      return `${where} should be at least ${schema.minimum}`;
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      return `${where} should be at most ${schema.maximum}`;
  }

  if (typeof value === 'string') {
    if (schema.format === 'date-time' && !DATE_TIME.test(value))
      return `${where} should be an ISO-8601 instant with a timezone`;
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value))
      return `${where} does not match ${schema.pattern}`;
  }

  if (TYPES.object(value)) {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined || value[key] === null) return `${where} is missing ${key}`;
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (value[key] === undefined || value[key] === null) continue;
      const bad = validate(sub, value[key], `${where}.${key}`);
      if (bad) return bad;
    }
  }

  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const bad = validate(schema.items, value[i], `${where}[${i}]`);
      if (bad) return bad;
    }
  }
  return null;
}

/**
 * Every message type there is a schema for.
 *
 * Listed rather than discovered, exactly as the Java side lists them, and for the better of the
 * two reasons: a list is a statement of what the protocol consists of, in one place, where a
 * directory scan is a thing that happens to work.
 */
export const TYPE_NAMES = [
  'hello', 'hello.ok', 'rejected',
  'join', 'joined', 'leave', 'left',
  'fix', 'crossing', 'record', 'retire',
  'fleet', 'timer', 'window', 'flag', 'course', 'say', 'ack', 'outcome', 'channel.since',
];

/**
 * The schemas, fetched once and held.
 *
 * <b>And fetching them must never be on the path to sailing.</b> They are a check on the
 * conversation, and the conversation is the optional half of this application — so a boat that
 * cannot read them validates nothing and carries on, rather than refusing to race because a
 * static file did not arrive. `loaded` says which way it went, so a page can say so rather than
 * quietly believing everything.
 */
export class Schemas {
  // Rooted, not relative: the client is served from `/` and so are its schemas, and a relative
  // base would resolve against whatever page happened to be importing this.
  constructor(base = '/schemas') {
    this.base = base;
    this.byType = new Map();
    this.loaded = false;
    this.trouble = null;
  }

  async load(types = TYPE_NAMES) {
    try {
      await Promise.all(types.map(async (type) => {
        const response = await fetch(`${this.base}/${type}.v1.json`);
        if (response.ok) this.byType.set(type, await response.json());
      }));
      this.loaded = this.byType.size > 0;
    } catch (error) {
      this.trouble = error.message;
      this.loaded = false;
    }
    return this.loaded;
  }

  /**
   * Check one envelope's body. Null when sound, a sentence when not.
   *
   * A type with no schema is ACCEPTED, which is §5 rule 3: an unknown message type is ignored
   * and counted, because an old client meeting a new message must carry on.
   */
  check(message) {
    if (!message || !message.type) return 'a message with no type is not a message';
    const schema = this.byType.get(message.type);
    if (!schema) return null;
    return validate(schema, message.body ?? {}, 'body');
  }
}
