package org.mortbay.sailing.unmarkable.model;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * What may be used as an identifier, in one place, because it is checked in several.
 *
 * <h2>Why ids are constrained at all</h2>
 * An id here is not a label — something else names a thing. An id is a <b>key</b>, and it
 * ends up in four kinds of place that each have their own idea of what a character means:
 *
 * <ul>
 *   <li><b>Filesystem paths.</b> {@code records/{club}/{course}/{date}/{boat}-{time}.json},
 *       and {@code ledger/{club}.json}. A separator escapes the tree; a space is mangled by
 *       {@link org.mortbay.sailing.unmarkable.store.JsonStore}'s sanitiser, and mangling
 *       means {@code "race 1"} and {@code "race_1"} become the <em>same directory</em> with
 *       nothing said about it.</li>
 *   <li><b>URL path segments.</b> The servlet splits on {@code /}, so a slash inside an id
 *       silently changes how many segments a request appears to have.</li>
 *   <li><b>Composite keys and labels.</b> {@code series/course/variant} in the ledger, and
 *       the {@code course/variant/datetime} name a snapshot is given. A slash inside a
 *       component makes the composite ambiguous — {@code a/b} + {@code c} cannot be told
 *       from {@code a} + {@code b/c}.</li>
 *   <li><b>YAML mapping keys.</b> An id is written into the programme file as the key
 *       itself. A colon or a leading indicator character there does not produce a bad id;
 *       it produces a <em>broken file</em>, on the next autosave, silently.</li>
 * </ul>
 *
 * <p>So: <b>lowercase kebab-case, letters and digits at both ends.</b> Lowercase because
 * the store's paths are case-sensitive on Linux and not on macOS, and {@code Div1} beside
 * {@code div1} is two ids on one machine and one on another.
 *
 * <h2>Reported, not thrown — with one exception</h2>
 * A file that already holds a bad id must still <b>load and work</b>. That is the same
 * defensive rule the rest of the loading follows: a club with a typo must not take the
 * other six clubs' racing down with it. {@link #problem} therefore returns a sentence for
 * somebody to read rather than throwing.
 *
 * <p>The exception is <b>creating a file</b>. There the id becomes a new path, so it is
 * validated and refused before any path is built — see
 * {@link org.mortbay.sailing.unmarkable.course.ProgrammeLibrary#create}.
 */
public final class Ids
{
    private Ids()
    {
    }

    /** Long enough for a scoped name, short enough to be a filename anywhere. */
    public static final int MAX = 64;

    private static final String TOKEN = "[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?";

    /** A plain id: course, variant, series. Nothing that could be a separator. */
    public static final Pattern PLAIN = Pattern.compile(TOKEN);

    /**
     * A point or line id, which may carry a scope: {@code manly-to-shark/windward}.
     *
     * <p>These are the only ids a {@code /} is legal in, and it is legal because they are
     * the only ids that never reach a path, a URL segment or a snapshot label — they live
     * inside one programme file and nowhere else. The separator is there because the
     * editor <em>generates</em> scoped names when a mark is promoted to be shared by a
     * course's variants, and a generated name reads better scoped than run together.
     */
    public static final Pattern SCOPED = Pattern.compile(TOKEN + "(?:/" + TOKEN + ")*");

    /**
     * A club id, which is a <b>domain</b> — {@code myc.org.au}. Dots are the whole point:
     * clubs are keyed by domain here, in sail-jinx and in sailing-pf, so records about the
     * same club line up across all three.
     */
    public static final Pattern DOMAIN = Pattern.compile(TOKEN + "(?:\\." + TOKEN + ")*");

    public static boolean plain(String id)
    {
        return id != null && id.length() <= MAX && PLAIN.matcher(id).matches();
    }

    public static boolean scoped(String id)
    {
        return id != null && id.length() <= MAX && SCOPED.matcher(id).matches();
    }

    public static boolean domain(String id)
    {
        return id != null && id.length() <= MAX && DOMAIN.matcher(id).matches();
    }

    /**
     * What is wrong with this id, as a sentence somebody can act on, or null when it is
     * fine.
     *
     * <p>Specific rather than generic on purpose. "ids may not contain spaces" tells you
     * what to do; "invalid identifier" sends you looking for a schema.
     *
     * @param what the kind of thing, for the message: {@code point}, {@code line},
     *             {@code course}, {@code variant}, {@code series}, {@code club}
     * @param id   the id to check
     * @param rule which pattern applies
     */
    public static String problem(String what, String id, Pattern rule)
    {
        if (id == null || id.isEmpty())
            return what + " id is empty";
        if (id.length() > MAX)
            return what + " id '" + id + "' is longer than " + MAX + " characters";
        if (rule.matcher(id).matches())
            return null;

        String where = what + " id '" + id + "' ";
        if (id.contains(" ") || id.contains("\t"))
            return where + "may not contain spaces — try '" + slug(id, rule) + "'";
        if (!id.equals(id.toLowerCase(Locale.ROOT)))
            return where + "may not contain capitals — try '" + slug(id, rule) + "'";
        if (rule != SCOPED && id.contains("/"))
            return where + "may not contain '/' — only point and line ids may be scoped";
        if (rule != DOMAIN && id.contains("."))
            return where + "may not contain '.' — only a club id is a domain";
        return where + "may hold only letters, digits, '-' and '_', and must start and end "
            + "with a letter or digit — try '" + slug(id, rule) + "'";
    }

    /**
     * The nearest legal id to what somebody typed.
     *
     * <p>The editor does this as you type, so a bad id is corrected in front of the person
     * who wrote it rather than reported to whoever finds it later. Kept here beside the
     * rule so the correction cannot drift from what it is correcting to.
     *
     * <p>Returns an empty string when nothing legal survives, which the caller reads as
     * "keep the id it had" — silently renaming something to {@code x} would be worse than
     * refusing the keystroke.
     */
    public static String slug(String raw, Pattern rule)
    {
        if (raw == null)
            return "";
        String keep = (rule == SCOPED) ? "a-z0-9_/-" : (rule == DOMAIN) ? "a-z0-9._-" : "a-z0-9_-";
        String out = raw.toLowerCase(Locale.ROOT)
            .replaceAll("[^" + keep + "]+", "-")
            // A RUN of separators is one separator, and the scope separator wins the run:
            // "a. -.b" is "a.b". Collapsing '-' alone is not enough — it would leave "a..b",
            // which is not a legal domain, so the slug would need slugging.
            .replaceAll("[-_]*([./])[-._/]*", "$1")
            .replaceAll("-{2,}", "-")
            .replaceAll("^[-_./]+", "")
            .replaceAll("[-_./]+$", "");
        return out.length() > MAX ? out.substring(0, MAX).replaceAll("[-_./]+$", "") : out;
    }
}
