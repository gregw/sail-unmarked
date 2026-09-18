package org.mortbay.sailing.unmarked.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One end of a {@link Line}: a place, and whether the line stops there.
 *
 * <p>The place is given either as {@code at}, naming an entry in the points section, or
 * inline as {@code latitude} / {@code longitude}. The named form is the one to prefer —
 * it is what makes a shared reef a single fact — and the inline form is there for a point
 * used exactly once, where naming it adds a hop and no meaning.
 *
 * <p><b>{@code infinite} changes what the coordinate means.</b> An infinite end is a
 * bearing, not a place: the line runs out <em>through</em> that point and keeps going, so
 * the coordinate says which way the line goes and not where it stops. This is why the
 * crossing rule needs no exception at infinity — see {@link Direction}.
 *
 * <p>A consequence worth knowing, and worth using: on an infinite end the point's
 * <em>distance</em> along the bearing is arbitrary and changes nothing about the line.
 * Move it from 500 m out to 5000 m out and the line is identical. That freedom is spent
 * on leg measurement — the midpoint of a line's two points is where its legs are measured
 * to, so an infinite end's point is the handle that puts that midpoint where the fleet
 * really crosses. Place it accordingly; see {@link Line#referencePoint}.
 */
public record LineEnd(
    @JsonProperty("at") String at,
    @JsonProperty("latitude") Double latitude,
    @JsonProperty("longitude") Double longitude,
    @JsonProperty("infinite") boolean infinite,
    @JsonProperty("notes") String notes)
{
    /** The inline position, or null when this end names a point instead. */
    public Position inlinePosition()
    {
        return (latitude != null && longitude != null) ? new Position(latitude, longitude) : null;
    }

    /** True when this end says where it is at all, either way round. */
    public boolean located()
    {
        return at != null && !at.isBlank() || inlinePosition() != null;
    }
}
