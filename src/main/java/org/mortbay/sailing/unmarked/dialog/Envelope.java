package org.mortbay.sailing.unmarked.dialog;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One message, in either direction, on either transport. The dialog document §4.
 *
 * <p>The whole protocol is this record plus a {@code type} and a schema per type. Two things
 * about it are worth stating because both were decided against an alternative:
 *
 * <p><b>There is no ordinal.</b> A monotonic sequence number would make "which of these came
 * last" decidable without trusting anybody's clock, and it looked necessary for telling a boat
 * what it missed and for recognising a resend. It is neither: reconnection RE-STATES rather than
 * replaying (§4.1), {@code id} already makes a resend recognisable, and within one connection
 * the transport has done the ordering. A field on every message for somebody else's problem is a
 * field to leave out.
 *
 * <p><b>{@code at} is when the SENDER says it sent this, and nothing is derived from it.</b> A
 * crossing carries its own instant in the body, taken from the fix that produced it; that is the
 * number that decides a race, and §1.1 says where it comes from. This field is for ordering a
 * queue that arrived late and for spotting a resend — never for measuring anything.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Envelope(
    @JsonProperty("v") int v,
    @JsonProperty("type") String type,
    @JsonProperty("id") String id,
    @JsonProperty("at") String at,
    @JsonProperty("tags") List<String> tags,
    @JsonProperty("body") Map<String, Object> body)
{
    /** The only version there has ever been. A second one is a second number, never a change. */
    public static final int V1 = 1;

    /**
     * Ids are unique to the sender and are all the de-duplication there is.
     *
     * <p>A counter and the JVM's start time rather than a UUID: it has to be unique among what
     * THIS server sent, which a counter settles, and being short matters because every
     * acknowledgement carries one back.
     */
    private static final AtomicLong COUNTER = new AtomicLong(System.nanoTime());

    public Envelope
    {
        if (v <= 0)
            v = V1;
        if (id == null || id.isBlank())
            id = Long.toHexString(COUNTER.incrementAndGet());
        if (at == null || at.isBlank())
            at = Instant.now().toString();
        tags = tags == null ? List.of() : List.copyOf(tags);
        body = body == null ? Map.of() : body;
    }

    public static Envelope of(String type, Map<String, Object> body)
    {
        return new Envelope(V1, type, null, null, List.of(), body);
    }

    public static Envelope of(String type, List<String> tags, Map<String, Object> body)
    {
        return new Envelope(V1, type, null, null, tags, body);
    }

    /** Is this message for a boat carrying these tags? §6: no tags means everybody. */
    public boolean addressedTo(List<String> theirs)
    {
        if (tags.isEmpty())
            return true;
        for (String tag : tags)
        {
            if (theirs.contains(tag))
                return true;
        }
        return false;
    }

    /** A body field as a string, or null. The wire is JSON and a client may send anything. */
    public String text(String key)
    {
        Object value = body.get(key);
        return value == null ? null : String.valueOf(value);
    }

    /** A body field as a number, or null — including when it arrived as a string. */
    public Double number(String key)
    {
        Object value = body.get(key);
        if (value instanceof Number n)
            return n.doubleValue();
        try
        {
            return value == null ? null : Double.valueOf(String.valueOf(value));
        }
        catch (NumberFormatException e)
        {
            return null;
        }
    }

    /** A mutable body, for building one field at a time. */
    public static Map<String, Object> fields()
    {
        return new LinkedHashMap<>();
    }
}
