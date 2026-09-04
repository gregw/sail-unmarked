package org.mortbay.sailing.unmarkable.model;

import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One GNSS fix as the boat logged it, with the quality-control decision the boat made
 * about it.
 *
 * <p>The server never re-runs this; it stores it. The audit trail is the point. This
 * application scores people, so a contested result has to be answerable with "the fix at
 * 18:42:03 was rejected, implied ground speed 63 kn" rather than with an assurance.
 * Rejected fixes are therefore kept, not dropped — a track with its bad fixes silently
 * removed cannot be audited, because the reason a crossing did or did not latch is
 * frequently a fix that is no longer there to look at.
 *
 * <p>{@code time} is the receiver's, where there is one. GNSS carries a better clock than
 * the phone does and it is worth preferring, which has the side effect that the times in
 * a record do not depend on a device whose owner can set it.
 *
 * <p>Field names follow SignalK, as {@link Position} does.
 */
public record Fix(
    @JsonProperty("time") Instant time,
    @JsonProperty("latitude") double latitude,
    @JsonProperty("longitude") double longitude,
    @JsonProperty("speedOverGroundKn") Double speedOverGroundKn,
    @JsonProperty("courseOverGroundDeg") Double courseOverGroundDeg,
    @JsonProperty("accuracyM") Double accuracyM,
    @JsonProperty("satellites") Integer satellites,
    @JsonProperty("verdict") FixVerdict verdict,
    @JsonProperty("rejectReason") String rejectReason)
{
    public Fix
    {
        if (verdict == null)
            verdict = FixVerdict.ACCEPTED;
    }

    public Position position()
    {
        return new Position(latitude, longitude);
    }
}
