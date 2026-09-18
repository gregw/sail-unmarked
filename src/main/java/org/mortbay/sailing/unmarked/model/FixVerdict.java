package org.mortbay.sailing.unmarked.model;

import java.util.Locale;

import com.fasterxml.jackson.annotation.JsonCreator;

/**
 * What the on-boat quality control decided about a {@link Fix}.
 *
 * <p>Rejected fixes are kept, not dropped. A track with its bad fixes silently removed
 * cannot be audited: the reason a crossing did or did not latch is frequently a fix that
 * is no longer there to look at.
 */
public enum FixVerdict
{
    /** Passed every gate and is part of the track. */
    ACCEPTED,
    /** Failed the receiver-metadata pre-filter: fix type, satellite count, or accuracy. */
    REJECTED_METADATA,
    /** Failed the kinematic gate — implied ground speed from the last good fix. */
    REJECTED_KINEMATIC,
    /**
     * Good enough to keep, but too close to the line to be resolved to a side. Inside the
     * accuracy band a boat is on neither side, which is what stops a boat sitting on the
     * line from emitting phantom crossings.
     */
    UNRESOLVED;

    /** Tolerant of case and separators, as {@link RaceFormat#parse} is and for the same reason. */
    @JsonCreator
    public static FixVerdict parse(String raw)
    {
        if (raw == null || raw.isBlank())
            return null;
        String wanted = raw.toUpperCase(Locale.ENGLISH).replaceAll("[^A-Z]", "");
        for (FixVerdict verdict : values())
        {
            if (verdict.name().replaceAll("[^A-Z]", "").equals(wanted))
                return verdict;
        }
        throw new IllegalArgumentException("Unknown fix verdict: " + raw);
    }
}
