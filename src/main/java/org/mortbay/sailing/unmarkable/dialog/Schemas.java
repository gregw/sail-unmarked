package org.mortbay.sailing.unmarkable.dialog;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.json.JsonMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * THE SCHEMAS, AND BOTH SIDES VALIDATE — dialog document §10.
 *
 * <p>They live in {@code client/www/schemas/}, which is what makes one copy reach both sides:
 * Maven already packages {@code client/www} as {@code /static/}, so the server reads them off
 * its own classpath and the client has them in its own bundle. Two copies of a schema is two
 * schemas, and the one that fell behind would be whichever was edited second.
 *
 * <p><b>One file per message type per major version, and each describes the message's BODY.</b>
 * The envelope is the one shape every message shares, so it is checked here in code rather than
 * repeated in twenty files — and `$ref`, which is how a JSON Schema would have shared it, is
 * deliberately outside the subset below.
 *
 * <p><b>The client's validator is a constraint on the schemas, not the other way round.</b> This
 * codebase has no framework, no npm build and no bundler, and the client is offline-first, so a
 * full JSON Schema implementation is a cost paid on every boat. The schemas are therefore held
 * to a subset a small hand-written validator covers: {@code type}, {@code properties},
 * {@code required}, {@code enum}, {@code const}, {@code items}, {@code minimum}/{@code maximum},
 * {@code pattern} and {@code format: date-time}. A schema that needs more than that is a message
 * that should be simpler.
 *
 * <p><b>{@code additionalProperties} is always true and is never written</b>, because §5 rule 2
 * says unknown fields are ignored on both sides. That is what lets an installed client and an
 * updated server go on talking, and it is why validation cannot be strict about what it has not
 * heard of.
 *
 * <p>This is the second implementation of the subset; {@code client/www/schema.js} is the first,
 * and {@code schema-test.js} is the spec they are both held to. Two validators is the price of
 * the rule that both sides validate, and the alternative — one side trusting the other — is the
 * thing the rule exists to prevent.
 */
public class Schemas
{
    private static final Logger LOG = LoggerFactory.getLogger(Schemas.class);
    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    /** ISO-8601 with a timezone, which is what {@code format: date-time} means here. */
    private static final Pattern DATE_TIME = Pattern.compile(
        "^\\d{4}-\\d{2}-\\d{2}[Tt]\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?([Zz]|[+-]\\d{2}:?\\d{2})$");

    private final Map<String, Map<String, Object>> byType = new LinkedHashMap<>();
    private final List<String> missing = new ArrayList<>();

    /** Every message type there is a schema for, loaded off the classpath. */
    public Schemas()
    {
        for (String type : TYPES)
            load(type);
    }

    /**
     * The catalogue, by name, so that a schema file going missing is noticed at start-up rather
     * than the first time somebody sends that message.
     *
     * <p>Listed rather than discovered by scanning the directory, because a classpath directory
     * listing is not something to rely on inside a jar — and because a list is also a statement
     * of what the protocol consists of, which is worth having in one place.
     */
    private static final List<String> TYPES = List.of(
        "hello", "hello.ok", "rejected",
        "join", "joined", "leave", "left",
        "fix", "crossing", "record", "retire",
        "fleet", "timer", "window", "flag", "course", "say", "ack", "outcome", "channel.since");

    @SuppressWarnings("unchecked")
    private void load(String type)
    {
        String path = "/static/schemas/" + type + ".v1.json";
        try (InputStream in = Schemas.class.getResourceAsStream(path))
        {
            if (in == null)
            {
                missing.add(path);
                return;
            }
            byType.put(type, MAPPER.readValue(in,
                new TypeReference<LinkedHashMap<String, Object>>() {}));
        }
        catch (Exception e)
        {
            missing.add(path + ": " + e.getMessage());
            LOG.error("Could not read schema {}", path, e);
        }
    }

    /** Schema files that should be here and are not. Empty is the only acceptable answer. */
    public List<String> missing()
    {
        return List.copyOf(missing);
    }

    public Collection<String> types()
    {
        return byType.keySet();
    }

    /**
     * Check one message. Null when it is sound, otherwise a sentence saying what is wrong.
     *
     * <p><b>A type with no schema is ACCEPTED, not refused</b>, and that is §5 rule 3 rather
     * than laziness: an unknown message type is ignored and counted, because an old client
     * meeting a new message must carry on. Refusing here would make every future message type a
     * breaking change for every server already deployed.
     */
    public String check(Envelope message)
    {
        if (message == null)
            return "no message";
        if (message.type() == null || message.type().isBlank())
            return "no type";
        if (message.v() != Envelope.V1)
            return "protocol v" + message.v() + " is not spoken here";
        Map<String, Object> schema = byType.get(message.type());
        if (schema == null)
            return null;
        return validate(schema, message.body(), "body");
    }

    /** The subset, recursively. */
    @SuppressWarnings("unchecked")
    String validate(Map<String, Object> schema, Object value, String where)
    {
        Object type = schema.get("type");
        if (type != null && !typeMatches(String.valueOf(type), value))
            return where + " should be " + type;

        if (schema.get("enum") instanceof Collection<?> allowed && value != null)
        {
            boolean ok = false;
            for (Object option : allowed)
                ok |= String.valueOf(option).equals(String.valueOf(value));
            if (!ok)
                return where + " should be one of " + allowed;
        }
        if (schema.containsKey("const") && value != null
            && !String.valueOf(schema.get("const")).equals(String.valueOf(value)))
            return where + " should be " + schema.get("const");

        if (value instanceof Number number)
        {
            if (schema.get("minimum") instanceof Number min && number.doubleValue() < min.doubleValue())
                return where + " should be at least " + min;
            if (schema.get("maximum") instanceof Number max && number.doubleValue() > max.doubleValue())
                return where + " should be at most " + max;
        }
        if (value instanceof String text)
        {
            if ("date-time".equals(schema.get("format")) && !DATE_TIME.matcher(text).matches())
                return where + " should be an ISO-8601 instant with a timezone";
            if (schema.get("pattern") instanceof String pattern)
            {
                try
                {
                    if (!Pattern.compile(pattern).matcher(text).find())
                        return where + " does not match " + pattern;
                }
                catch (PatternSyntaxException e)
                {
                    LOG.warn("Unusable pattern in schema: {}", pattern);
                }
            }
        }

        if (value instanceof Map<?, ?> object)
        {
            if (schema.get("required") instanceof Collection<?> required)
            {
                for (Object key : required)
                {
                    if (object.get(String.valueOf(key)) == null)
                        return where + " is missing " + key;
                }
            }
            if (schema.get("properties") instanceof Map<?, ?> properties)
            {
                for (Map.Entry<?, ?> entry : properties.entrySet())
                {
                    Object held = object.get(String.valueOf(entry.getKey()));
                    // ABSENT IS ALWAYS FINE unless `required` said otherwise: a field is only
                    // ever added (§5 rule 1), so a client that predates one simply omits it.
                    if (held == null || !(entry.getValue() instanceof Map<?, ?> sub))
                        continue;
                    String bad = validate((Map<String, Object>)sub, held,
                        where + "." + entry.getKey());
                    if (bad != null)
                        return bad;
                }
            }
        }

        if (value instanceof Collection<?> array && schema.get("items") instanceof Map<?, ?> items)
        {
            int index = 0;
            for (Object item : array)
            {
                String bad = validate((Map<String, Object>)items, item, where + "[" + index + "]");
                if (bad != null)
                    return bad;
                index++;
            }
        }
        return null;
    }

    private static boolean typeMatches(String type, Object value)
    {
        if (value == null)
            return true;                  // null is absent, and absence is `required`'s business
        return switch (type)
        {
            case "object" -> value instanceof Map;
            case "array" -> value instanceof Collection;
            case "string" -> value instanceof String;
            case "boolean" -> value instanceof Boolean;
            case "integer" -> value instanceof Integer || value instanceof Long
                || (value instanceof Number n && n.doubleValue() == Math.rint(n.doubleValue()));
            case "number" -> value instanceof Number;
            default -> true;
        };
    }
}
