package org.mortbay.sailing.unmarked.model;

import java.util.Locale;

import com.fasterxml.jackson.annotation.JsonCreator;

/**
 * Why a boat joined a course, which decides what becomes of its record.
 *
 * <p>Declared when joining rather than when submitting, because it changes what the boat
 * is doing while it is out there — a record attempt is sailed differently from a practice
 * lap — and because a boat that decides afterwards is deciding with the answer in front
 * of it.
 */
public enum JoinMode
{
    /**
     * Racing. The record goes to the club, which scores it with whatever software it
     * already uses; this system takes no view on places, OCS or corrected time.
     */
    RACE,

    /**
     * Practising. The record is kept for the boat and published to nobody.
     *
     * <p>Stored rather than withheld: a boat that never uploads cannot compare its own
     * laps, cannot recover a track from a lost phone, and cannot change its mind. Keeping
     * it and not publishing it costs the same and loses nothing.
     */
    ANONYMOUS,

    /**
     * A timed attempt at the course. Goes to the club like a race, and additionally stands
     * against every other attempt at the same course geometry.
     */
    RECORD;

    /** True when the club sees this record at all. */
    public boolean published()
    {
        return this != ANONYMOUS;
    }

    /** True when this record stands against others on the same course. */
    public boolean ranked()
    {
        return this == RECORD;
    }

    @JsonCreator
    public static JoinMode parse(String raw)
    {
        if (raw == null || raw.isBlank())
            return null;
        return valueOf(raw.trim().toUpperCase(Locale.ENGLISH));
    }
}
