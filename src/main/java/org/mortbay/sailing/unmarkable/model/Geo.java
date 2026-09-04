package org.mortbay.sailing.unmarkable.model;

/**
 * The small amount of spherical geometry the server needs: distance, and the midpoint of
 * two positions.
 *
 * <p>Deliberately thin. The crossing tests that decide a race do not run here — they run
 * on the boat, in JavaScript, with no network — and duplicating them on this side would
 * invite the server to start adjudicating roundings, which is the one thing the
 * architecture says it must not do. What is left is course measurement: how long a leg is,
 * so a course has a length and the live-place screen has an axis.
 *
 * <p>A sphere, not an ellipsoid. Over the few kilometres a course spans, the difference
 * is well under the GNSS uncertainty that the accuracy band already allows for, and a
 * course length is a nominal figure anyway — the whole point of the override is that the
 * measured number is a starting position, not a truth.
 */
public final class Geo
{
    /** Mean Earth radius, metres. */
    private static final double R_M = 6371008.8;

    public static final double METRES_PER_NM = 1852.0;

    /**
     * The resolution of the whole system: one metre. Declared here and in
     * {@code client/www/crossing.js}, and the two must agree.
     *
     * <p>Every distance computed, displayed or scored against is rounded to the nearest
     * metre. GNSS on a phone does not honestly resolve better, and a scoring edge that
     * moves with the twelfth decimal place of a double is one nobody can argue in front
     * of a protest committee.
     *
     * <p>The blunt consequence is intended: a finite end is a hard edge, and if you miss
     * it, you miss. There is no band of doubt at an endpoint. What the application owes
     * the sailor instead is warning, well before the boat gets there — which is the
     * client's job, in {@code projectCog}.
     */
    public static final double RESOLUTION_M = 1.0;

    private Geo()
    {
    }

    /** Great-circle distance in metres. */
    public static double distanceM(Position a, Position b)
    {
        double lat1 = Math.toRadians(a.latitude());
        double lat2 = Math.toRadians(b.latitude());
        double dLat = lat2 - lat1;
        double dLon = Math.toRadians(b.longitude() - a.longitude());
        double h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return resolve(2 * R_M * Math.asin(Math.min(1.0, Math.sqrt(h))));
    }

    public static double distanceNm(Position a, Position b)
    {
        // Rounded as metres first, then converted, so that the one-metre resolution is
        // applied once and in the unit it is defined in. Rounding a nautical-mile figure
        // instead would quietly make the resolution 1852 times coarser.
        return distanceM(a, b) / METRES_PER_NM;
    }

    /** Every distance in the system passes through here. */
    public static double resolve(double metres)
    {
        return Math.round(metres / RESOLUTION_M) * RESOLUTION_M;
    }

    /** The point halfway along the great circle between two positions. */
    public static Position midpoint(Position a, Position b)
    {
        double lat1 = Math.toRadians(a.latitude());
        double lon1 = Math.toRadians(a.longitude());
        double lat2 = Math.toRadians(b.latitude());
        double dLon = Math.toRadians(b.longitude() - a.longitude());

        double bx = Math.cos(lat2) * Math.cos(dLon);
        double by = Math.cos(lat2) * Math.sin(dLon);
        double lat3 = Math.atan2(Math.sin(lat1) + Math.sin(lat2),
            Math.sqrt((Math.cos(lat1) + bx) * (Math.cos(lat1) + bx) + by * by));
        double lon3 = lon1 + Math.atan2(by, Math.cos(lat1) + bx);

        return new Position(Math.toDegrees(lat3),
            (Math.toDegrees(lon3) + 540) % 360 - 180);
    }
}
