package org.mortbay.sailing.unmarkable.model;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A race: a day, a format, and a course for each division that is sailing it.
 *
 * <p><b>This is the DEFINITION, not the conduct</b> — see the dialog document §12.5. What is
 * here is configuration: authored ahead of time, diffable, and part of the file a club could
 * hand to another club whole. What happened on the day — who joined, what was said, which flags
 * were raised, where the boats were — lives in {@code data/store/} with the real-people data,
 * because it is a record of an afternoon rather than a description of one.
 *
 * <p>So a race in this file says <em>what was planned</em> and never <em>what occurred</em>.
 * The two get confused easily and the consequence is a programme file that fills up with an
 * afternoon every Saturday.
 *
 * <p><b>A race lives in a series</b>, which is why it is here at all rather than in a store of
 * its own: the series is already the scope a club organises its racing in, and a race that
 * needed its own file would need its own identity, its own directory and its own rename.
 *
 * <p><b>And it knows the race that FOLLOWS it</b> ({@code next}). That is the whole of the
 * answer to several races in a day (§12.6): a boat that stops racing one is entered for the
 * next, so "regatta" never has to become a word. Guarded by the date, which is checked where
 * the chain fires rather than here — a file may perfectly well name next Saturday's race, and
 * that is a chain that simply does not fire today.
 */
public record Race(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("date") LocalDate date,
    @JsonProperty("format") String format,
    @JsonProperty("divisions") Map<String, Division> divisions,
    @JsonProperty("next") String next,
    @JsonProperty("notes") String notes)
{
    public Race
    {
        divisions = divisions == null ? Map.of() : keyed(divisions);
    }

    /** The id is the map key in the file, so it is backfilled rather than stated twice. */
    private static Map<String, Division> keyed(Map<String, Division> raw)
    {
        Map<String, Division> out = new LinkedHashMap<>();
        raw.forEach((key, division) ->
        {
            if (division == null)
                return;
            out.put(key, division.name() == null || division.name().isBlank()
                ? new Division(key, division.course(), division.variant(), division.start())
                : division);
        });
        return java.util.Collections.unmodifiableMap(out);
    }

    /** Is this race on today, in the club's own timezone? The chain in §12.6 turns on it. */
    public boolean on(LocalDate today)
    {
        return date != null && date.equals(today);
    }

    /**
     * The tag a division is addressed by.
     *
     * <p><b>The map key is the division's plain id and the tag is derived from it</b>, rather
     * than the key being the tag itself. Two reasons, and the second is the one with teeth: a
     * YAML mapping key containing a colon has to be quoted, and an unquoted one does not
     * produce a bad id but a broken file on the next autosave (see {@link Ids}); and a division
     * is a thing with a name, where {@code division:1} is how that name is written on the wire.
     * The namespace lives in one place, here, so nothing else has to know how to spell it.
     */
    public static String tagFor(String division)
    {
        return "division:" + division;
    }

    /** The division a tag names, or null if the tag is not a division's. */
    public static String divisionOf(String tag)
    {
        return tag != null && tag.startsWith("division:") ? tag.substring("division:".length()) : null;
    }

    /** Everything wrong with this race, as sentences. Reported, never fatal. */
    @JsonIgnore
    public List<String> problems(Map<String, Course> courses)
    {
        List<String> problems = new ArrayList<>();
        String bad = Ids.problem("race", id, Ids.PLAIN);
        if (bad != null)
            problems.add(bad);
        if (date == null)
            problems.add("race '" + id + "' has no date");
        if (divisions.isEmpty())
            problems.add("race '" + id + "' has no divisions, so no boat can be given a course");
        divisions.forEach((key, division) ->
        {
            String badDiv = Ids.problem("division", key, Ids.PLAIN);
            if (badDiv != null)
                problems.add(badDiv);
            Course course = courses.get(division.course());
            if (course == null)
            {
                problems.add("race '" + id + "' division '" + key + "' names unknown course '"
                    + division.course() + "'");
                return;
            }
            if (division.variant() != null && !course.variants().containsKey(division.variant()))
            {
                problems.add("race '" + id + "' division '" + key + "' names unknown variant '"
                    + division.variant() + "' of course '" + division.course() + "'");
                return;
            }
            // NAMING NO VARIANT MEANS "the course's only sailable design", which is an answer
            // only where there is one. With several it is not a shorthand but a gap: the join
            // is refused, and it is refused on the water rather than here — so it is said here.
            long sailable = course.variants().values().stream().filter(v -> !v.template()).count();
            if (division.variant() == null && sailable != 1)
            {
                problems.add("race '" + id + "' division '" + key + "' must say which variant of"
                    + " course '" + division.course() + "' it sails — that course has "
                    + (sailable == 0 ? "none that can be sailed" : sailable + " to choose from"));
            }
        });
        return problems;
    }

    /**
     * One division of one race: who it is, what it sails, and when it was planned to start.
     *
     * <p><b>A DIVISION IS NOT A VARIANT</b>, and this is where the two finally meet without
     * becoming each other. A variant is a design; a division is a group of boats. This record is
     * the mapping between them, for one race — which is exactly why the model could go on not
     * knowing the word "division" until there was a race to need it.
     *
     * <p>{@code start} is the <b>planned</b> start, and publishing it is a separate act. A
     * planned instant in a file is a rehearsal; the {@code timer} a fleet counts down to is
     * conduct, and it is sent by somebody deciding to send it.
     */
    public record Division(
        @JsonProperty("name") String name,
        @JsonProperty("course") String course,
        @JsonProperty("variant") String variant,
        @JsonProperty("start") String start)
    {
        /** The tag boats in this division carry. */
        @JsonIgnore
        public String tag()
        {
            return tagFor(name);
        }
    }
}
