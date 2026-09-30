package org.mortbay.sailing.unmarked.model;

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
 * <p><b>This is the DEFINITION, not the conduct</b> — see dialog §12.5. What is
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
 *
 * <h2>How it starts, and whether boats can see it</h2>
 * {@code startType} is the race's, and every division of it starts the same way — see
 * {@link StartType}. It is here rather than in the conduct because a boat has to know it on
 * JOINING: an allocated start asks each boat for its own time then. {@code public} is whether
 * boats are offered the race at all, so it can be set up before it is. A race written before the
 * field existed says nothing and stays what it was — joinable; one created in the editor starts
 * not public.
 */
public record Race(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("date") LocalDate date,
    @JsonProperty("format") String format,
    @JsonProperty("divisions") Map<String, Division> divisions,
    @JsonProperty("next") String next,
    @JsonProperty("notes") String notes,
    @JsonProperty("startType") StartType startType,
    @JsonProperty("public") Boolean isPublic)
{
    public Race
    {
        divisions = divisions == null ? Map.of() : keyed(divisions);
    }

    /** A race as it was before starts had a type or races a public flag. */
    public Race(String id, String name, LocalDate date, String format, Map<String, Division> divisions,
        String next, String notes)
    {
        this(id, name, date, format, divisions, next, notes, null, null);
    }

    /** How the race starts: {@code scratch} when the file says nothing. */
    @JsonIgnore
    public StartType start()
    {
        return startType == null ? StartType.SCRATCH : startType;
    }

    /** Whether boats are offered it. Absent in the file means yes — see the class comment. */
    @JsonIgnore
    public boolean offered()
    {
        return isPublic == null || isPublic;
    }

    /**
     * THE THREE WAYS A RACE STARTS, and the one thing they share: every start line is OPEN for a
     * period, and a crossing counts only while it is — a boat over early sees nothing register and
     * comes back. What differs is how that is presented to the boat and what its elapsed time runs
     * from.
     *
     * <ul>
     *   <li>{@link #SCRATCH} — one start time for everybody, with a warning and a preparatory
     *       signal before it. The line is open from the start for a period (ten minutes unless the
     *       race screen says otherwise), and elapsed time runs FROM THE START, however late a boat
     *       crossed.</li>
     *   <li>{@link #OPEN} — the line opens at one time and closes at another, with a warning and
     *       a preparatory signal before it opens, and each boat's elapsed time runs from its own
     *       crossing.</li>
     *   <li>{@link #ALLOCATED} — each boat has its own start time, given when it joins, with the
     *       warning, preparatory signal and open period of a scratch start hung off it; elapsed
     *       runs from that boat's time.</li>
     * </ul>
     */
    public enum StartType
    {
        SCRATCH,
        OPEN,
        ALLOCATED;

        @com.fasterxml.jackson.annotation.JsonCreator
        public static StartType parse(String raw)
        {
            if (raw == null || raw.isBlank())
                return null;
            return valueOf(raw.trim().toUpperCase(java.util.Locale.ROOT));
        }

        @com.fasterxml.jackson.annotation.JsonValue
        public String wire()
        {
            return name().toLowerCase(java.util.Locale.ROOT);
        }
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
                ? new Division(key, division.course(), division.variant(), division.start(),
                    division.timeLimitMinutes(), division.closes(), division.warningMinutes(),
                    division.prepMinutes(), division.openMinutes())
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
            if (division.timeLimitMinutes() != null && division.timeLimitMinutes() <= 0)
                problems.add("race '" + id + "' division '" + key + "' has a time limit of "
                    + division.timeLimitMinutes() + " minutes; give it a positive one, or none");
            // A START THAT CANNOT BE WORKED OUT IS SAID HERE, not found on a start line: a public
            // race whose division has no start time hands its boats nothing to count down to.
            if (start() != StartType.ALLOCATED)
            {
                java.time.ZoneId anyZone = java.time.ZoneOffset.UTC;
                java.time.Instant opens = Division.at(division.start(), date, anyZone);
                if (opens == null)
                    problems.add("race '" + id + "' division '" + key + "' has no start time"
                        + (division.start() == null ? "" : " it can read ('" + division.start() + "')")
                        + "; give it one as HH:MM");
                if (start() == StartType.OPEN)
                {
                    java.time.Instant shuts = Division.at(division.closes(), date, anyZone);
                    if (shuts == null)
                        problems.add("race '" + id + "' division '" + key + "' is an open start with"
                            + " no closing time; give it one as HH:MM");
                    else if (opens != null && !shuts.isAfter(opens))
                        problems.add("race '" + id + "' division '" + key + "' closes its line before"
                            + " it opens it");
                }
            }
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
     * <p><b>A DIVISION IS NOT A VARIANT</b>, and this is where the two meet without becoming
     * each other. A variant is a design; a division is a group of boats. This record is the
     * mapping between them, for one race, which is why nothing below the race needs the word
     * "division" at all.
     *
     * <p>{@code start} is the <b>planned</b> start, and publishing it is a separate act. A
     * planned instant in a file is a rehearsal; the {@code timer} a fleet counts down to is
     * conduct, and it is sent by somebody deciding to send it.
     *
     * <p>{@code timeLimitMinutes} is how long a boat of this division has to finish, from the
     * instant its elapsed time runs from; after that its finish line is closed to it and a
     * crossing no longer counts. None means no limit.
     *
     * <h2>The start is DEFINED here</h2>
     * {@code start} is the start time — the moment the line opens, for an open start — as
     * {@code HH:MM} on the race's date in the series' timezone; {@code closes} is when an open
     * start's line closes, the same way. {@code warningMinutes} and {@code prepMinutes} put the
     * warning and preparatory signals before it (five and four unless said), and
     * {@code openMinutes} is how long a scratch or allocated start's line stays open after it (ten
     * unless said). While the race is public the server hands boats the start these define
     * ({@code Dialog.definedStart}); the race screen can only delay, postpone or abandon it.
     */
    public record Division(
        @JsonProperty("name") String name,
        @JsonProperty("course") String course,
        @JsonProperty("variant") String variant,
        @JsonProperty("start") String start,
        @JsonProperty("timeLimitMinutes") Integer timeLimitMinutes,
        @JsonProperty("closes") String closes,
        @JsonProperty("warningMinutes") Integer warningMinutes,
        @JsonProperty("prepMinutes") Integer prepMinutes,
        @JsonProperty("openMinutes") Integer openMinutes)
    {
        /** A division with no time limit. */
        public Division(String name, String course, String variant, String start)
        {
            this(name, course, variant, start, null);
        }

        /** A division with only a planned start and a time limit. */
        public Division(String name, String course, String variant, String start, Integer timeLimitMinutes)
        {
            this(name, course, variant, start, timeLimitMinutes, null, null, null, null);
        }

        @JsonIgnore
        public int warning()
        {
            return warningMinutes == null ? 5 : warningMinutes;
        }

        @JsonIgnore
        public int prep()
        {
            return prepMinutes == null ? 4 : prepMinutes;
        }

        @JsonIgnore
        public int open()
        {
            return openMinutes == null ? 10 : openMinutes;
        }

        /**
         * A time in the definition — {@code HH:MM} on the race's date in the series' timezone, or
         * an instant written in full — as an instant; null when it says nothing usable.
         */
        public static java.time.Instant at(String time, LocalDate date, java.time.ZoneId zone)
        {
            if (time == null || time.isBlank())
                return null;
            String t = time.trim();
            try
            {
                if (t.matches("\\d{1,2}:\\d{2}"))
                {
                    return date == null ? null
                        : java.time.ZonedDateTime.of(date, java.time.LocalTime.parse(t.length() == 4 ? "0" + t : t), zone)
                            .toInstant();
                }
                return java.time.OffsetDateTime.parse(t).toInstant();
            }
            catch (Exception e)
            {
                try
                {
                    return java.time.LocalDateTime.parse(t).atZone(zone).toInstant();
                }
                catch (Exception again)
                {
                    return null;
                }
            }
        }

        /** The tag boats in this division carry. */
        @JsonIgnore
        public String tag()
        {
            return tagFor(name);
        }
    }
}
