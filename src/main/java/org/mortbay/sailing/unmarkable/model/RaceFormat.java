package org.mortbay.sailing.unmarkable.model;

import java.util.Locale;

import com.fasterxml.jackson.annotation.JsonCreator;

/**
 * The three formats the virtual-mark machinery exists to make possible. Each dissolves
 * something that concentrates contact risk — the mass start, or the single rounding point.
 *
 * <p>{@link #ROLLING_START}: each boat starts in its own time inside a window, its clock
 * beginning when it crosses the start line, timestamped on the device. No committee-boat
 * sightline, and no start-line scrum.
 *
 * <p>{@link #DISTANCE_FACTOR}: the handicap is spent on the course rather than on the
 * clock. Each boat gets its own parallel line set so that its course is longer or shorter,
 * and first home wins. Handicap becomes something raceable on the water instead of an
 * arithmetic done to you afterwards. Turning a TCF into a length delta interacts with leg
 * geometry and wind angle and is an open question, not a formula this repo has.
 *
 * <p>{@link #CIRCUIT}: boats join a defined loop anywhere, finish where they entered, and
 * are ranked live. The loop is location-agnostic, so clubs can sail the same circuit from
 * their own water on their own evening. Live rankings need the network and degrade to
 * last-known standings; a boat's own record never does.
 */
public enum RaceFormat
{
    ROLLING_START,
    DISTANCE_FACTOR,
    CIRCUIT;

    /**
     * Tolerant of how a person writes it: rollingStart, rolling_start, ROLLING-START.
     *
     * <p>The YAML in this project is camelCase, following sail-jinx and sailing-pf, while
     * enum constants are SCREAMING_SNAKE. Matching on the letters alone is what bridges
     * the two, and it is the same trick {@code JinxConfig.PenaltyScaling} uses. Without
     * it {@code format: rollingStart} — the natural thing to write, and what the shipped
     * config does write — fails to parse.
     */
    @JsonCreator
    public static RaceFormat parse(String raw)
    {
        if (raw == null || raw.isBlank())
            return null;
        String wanted = letters(raw);
        for (RaceFormat format : values())
        {
            if (letters(format.name()).equals(wanted))
                return format;
        }
        throw new IllegalArgumentException("Unknown race format: " + raw);
    }

    private static String letters(String raw)
    {
        return raw.toUpperCase(Locale.ENGLISH).replaceAll("[^A-Z]", "");
    }
}
