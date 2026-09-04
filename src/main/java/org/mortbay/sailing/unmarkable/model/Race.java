package org.mortbay.sailing.unmarkable.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One race: which course, under which format, with that format's parameters and the
 * boats in it.
 *
 * <p><b>A separate file from the programme, deliberately.</b> The programme holds what is
 * reusable — the points, the lines, the courses a club sails all season. A race is one
 * night: a course chosen from that programme, a window, and an entry list. Filing them
 * together would mean editing the file that holds the surveyed coordinates every time
 * somebody enters a boat.
 *
 * <pre>
 *   data/config/clubs/&lt;club&gt;/races/&lt;raceId&gt;.yaml
 * </pre>
 *
 * <p><b>Most of this is still TBD</b> and the shape below is a placeholder that loads
 * rather than a settled schema. What each format actually needs — how a rolling-start
 * window is expressed, how wide an asynchronous circuit window may be before boats are
 * no longer racing the same course, where a TCF comes from — is open. See CLAUDE.md.
 * {@code parameters} is a free map for that reason: it lets a format's settings be
 * written down and round-tripped before anybody has decided what they are called.
 */
public record Race(
    @JsonProperty("id") String id,
    @JsonProperty("club") String club,
    @JsonProperty("series") String series,
    @JsonProperty("name") String name,
    @JsonProperty("course") String course,
    @JsonProperty("format") RaceFormat format,
    @JsonProperty("windowOpen") Instant windowOpen,
    @JsonProperty("windowClose") Instant windowClose,
    @JsonProperty("parameters") Map<String, Object> parameters,
    @JsonProperty("entrants") List<Entrant> entrants,
    @JsonProperty("notes") String notes)
{
    public Race
    {
        if (name == null || name.isBlank())
            name = id;
        parameters = (parameters == null) ? Map.of() : Map.copyOf(parameters);
        entrants = (entrants == null) ? List.of() : List.copyOf(entrants);
    }

    /**
     * A boat in this race, at the handicap it is racing on.
     *
     * <p>The TCF is here rather than on a boat, because a handicap is a property of a boat
     * <em>in a given race</em> and not of the boat — the same reasoning sail-jinx applies
     * to its own entrants, and the reason its race 4 handicaps survive race 5 being
     * processed.
     *
     * <p>In the distance-factor format this TCF is spent on the course rather than on the
     * clock: the server slides the designated lines' points along themselves until the
     * legs come out at this boat's required length. It must not then be applied again to
     * the elapsed time.
     */
    public record Entrant(
        @JsonProperty("boatId") String boatId,
        @JsonProperty("boatName") String boatName,
        @JsonProperty("sailNumber") String sailNumber,
        @JsonProperty("tcf") Double tcf,
        @JsonProperty("notes") String notes)
    {
    }
}
