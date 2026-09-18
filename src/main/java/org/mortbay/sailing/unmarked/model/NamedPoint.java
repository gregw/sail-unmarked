package org.mortbay.sailing.unmarked.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A place, named once and referred to by id wherever it is used.
 *
 * <p>Points exist as their own section so that Sow and Pigs is surveyed once and then
 * spelled the same way by every line that touches it. Two lines share that reef in the
 * worked course; without a points section they would carry two copies of one coordinate,
 * and a correction would have to find both.
 *
 * <p>{@code notes} carries what the numbers cannot. A point derived as "1000 m due east
 * of Sow and Pigs" is stored as the resulting latitude and longitude — the file format
 * has no arithmetic in it, and a UI is where that convenience belongs — but the
 * derivation is the only thing that makes the coordinate checkable later, so it is
 * written down rather than lost. The same field carries significance: which end of a line
 * is the shore end, why a mark sits where it does, when it was last surveyed.
 */
public record NamedPoint(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("latitude") Double latitude,
    @JsonProperty("longitude") Double longitude,
    @JsonProperty("notes") String notes)
{
    public NamedPoint
    {
        if (name == null || name.isBlank())
            name = id;
    }

    /** True once somebody has supplied a survey. */
    public boolean surveyed()
    {
        return latitude != null && longitude != null;
    }

    /** The position, or null while this point is still a placeholder. */
    public Position position()
    {
        return surveyed() ? new Position(latitude, longitude) : null;
    }
}
