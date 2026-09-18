package org.mortbay.sailing.unmarked.model;

import java.util.Locale;

import com.fasterxml.jackson.annotation.JsonCreator;

/**
 * Which way a {@link Line} must be crossed for the crossing to count.
 *
 * <p>The line's ends are named {@code port} and {@code starboard}, and those names are
 * what orient it:
 *
 * <ul>
 *   <li>{@link #FORWARD} — leave the port end to port and the starboard end to starboard.</li>
 *   <li>{@link #REVERSE} — leave the port end to starboard and the starboard end to port.</li>
 * </ul>
 *
 * <p>So the required sense is legible off the line itself and there is no convention to
 * remember. Note the names are defined <em>relative to a forward crossing</em> rather than
 * being a property of the line sitting on its own; a line crossed both ways — the leeward
 * line that is start, mark 2 and finish — is forward once and reverse twice.
 *
 * <h2>Sense and extent are two different tests</h2>
 * Deciding a crossing is two independent questions, and keeping them apart is what makes
 * infinite ends behave:
 *
 * <ul>
 *   <li><b>Sense</b> — which way did the boat cross? A sign test on the line's
 *       port-to-starboard orientation. It never involves where the ends <em>are</em>.</li>
 *   <li><b>Extent</b> — did the boat cross the line, or its extension out past a finite
 *       end? Only a finite end can fail this. An infinite end never can.</li>
 * </ul>
 *
 * <p>"Leave the starboard end to starboard" is a mnemonic for the sense test written in
 * the vocabulary of the extent test, which is why it sounds paradoxical at infinity — an
 * infinite end is out along the line without limit, so it is always on the side its name
 * says, while the <em>point</em> that defined it can easily be on the other hand. The
 * point was never the end.
 *
 * <p>The Mark screen's three states fall straight out of the pair: approaching is neither
 * test settled; <b>crossed</b> is both passed; <b>missed</b> is the sense test passed and
 * the extent test failed — "side change was past the E end. No crossing."
 *
 * <p>A crossing in the wrong sense is logged for audit and ignored. A crossing in the
 * required sense latches and stands, so nothing later can un-make it.
 */
public enum Direction
{
    FORWARD,
    REVERSE;

    /** The opposite sense — the same line read the other way. */
    public Direction opposite()
    {
        return this == FORWARD ? REVERSE : FORWARD;
    }

    @JsonCreator
    public static Direction parse(String raw)
    {
        if (raw == null || raw.isBlank())
            return null;
        return valueOf(raw.trim().toUpperCase(Locale.ENGLISH));
    }
}
