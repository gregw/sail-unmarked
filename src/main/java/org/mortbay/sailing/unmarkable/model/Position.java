package org.mortbay.sailing.unmarkable.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A position in signed decimal degrees, WGS84.
 *
 * <p><b>Field names and units are SignalK's, deliberately.</b> The SignalK schema
 * ({@code schemas/definitions.json}) defines {@code navigation.position} as
 * {@code latitude} / {@code longitude} of type number in units {@code deg} — "latitude or
 * longitude in decimal degrees" — with an optional {@code altitude} in metres. Spelling
 * them out in full and keeping the same units means a position off a SignalK stream drops
 * into a course file or a race record with no conversion step, and a conversion step is
 * where a hemisphere gets inverted or a digit gets dropped.
 *
 * <p>Degrees and minutes — {@code 33 48.072 S} — is what a chart and a plotter show and
 * what a person reads out, so it belongs on screen, in both directions. It does not
 * belong in the file: on screen a bad transcription can be seen and corrected by the
 * person who made it, and in the file it is a silently displaced mark.
 *
 * <p>No coordinates are asserted anywhere in this repository. Everything under
 * {@code data/config/} is null until somebody supplies a survey.
 */
public record Position(
    @JsonProperty("latitude") double latitude,
    @JsonProperty("longitude") double longitude)
{
}
