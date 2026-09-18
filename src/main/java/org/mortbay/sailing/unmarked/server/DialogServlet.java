package org.mortbay.sailing.unmarked.server;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.mortbay.sailing.unmarked.dialog.Dialog;
import org.mortbay.sailing.unmarked.dialog.Envelope;
import org.mortbay.sailing.unmarked.dialog.Schemas;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * THE TRANSPORT — the polling half of dialog document §3.
 *
 * <p>One endpoint, one exchange: the boat posts an array of envelopes and the response carries
 * whatever was queued for it. {@code POST /api/dialog} before there is a session (which is
 * {@code hello} and {@code join}), {@code POST /api/dialog/{session}} afterwards.
 *
 * <p><b>The WebSocket is not built, and this is deliberately the half that was built first.</b>
 * The document's promise is that the fallback is the same conversation — identical envelopes,
 * identical schemas, identical ordering — so the socket is a pipe to add rather than a protocol
 * to design, and everything it will carry is settled by {@link Dialog#exchange}. Building the
 * socket first would have meant writing the fallback twice: once as a design and once as the
 * thing that turned out to be needed.
 *
 * <p>What the socket will need beyond this: a ticker, because {@code fleet} is currently
 * enqueued when a boat polls rather than pushed on a schedule. That is exactly right for
 * polling and not enough for a socket.
 *
 * <p><b>Validated in both directions</b> (§10). A message that does not match its schema is
 * refused with a {@code rejected} carrying the reason, rather than being half-understood — and
 * the same schemas are what the client validates against, because there is one copy of them and
 * it is packaged into both.
 */
public class DialogServlet extends HttpServlet
{
    private static final Logger LOG = LoggerFactory.getLogger(DialogServlet.class);

    /**
     * ISO instants, and unknown properties ignored.
     *
     * <p>The time module is not a detail: a `joined` carries a whole course snapshot, whose
     * `archivedAt` is an {@link java.time.Instant}, and a mapper without it throws PART WAY
     * THROUGH writing the response — leaving the client a truncated document rather than an
     * error. Unknown properties are ignored because §5 rule 2 says so on both sides.
     */
    private static final JsonMapper MAPPER = JsonMapper.builder()
        .addModule(new JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();

    private final Dialog dialog;
    private final Schemas schemas;

    public DialogServlet(Dialog dialog, Schemas schemas)
    {
        this.dialog = dialog;
        this.schemas = schemas;
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException
    {
        String session = req.getPathInfo() == null ? null
            : req.getPathInfo().replaceAll("^/+", "").replaceAll("/.*$", "");
        if (session != null && session.isBlank())
            session = null;

        List<Envelope> incoming;
        try
        {
            Map<String, Object> body = MAPPER.readValue(req.getInputStream(),
                new TypeReference<LinkedHashMap<String, Object>>() {});
            incoming = envelopes(body.get("envelopes"));
        }
        catch (Exception e)
        {
            resp.sendError(400, "Unreadable envelopes: " + e.getMessage());
            return;
        }

        List<Envelope> refusals = new ArrayList<>();
        List<Envelope> accepted = new ArrayList<>();
        for (Envelope message : incoming)
        {
            String bad = schemas.check(message);
            if (bad == null)
            {
                accepted.add(message);
                continue;
            }
            // REFUSED, not half-understood. A message the server cannot read is a message it
            // must not act on half of — and the sailor gets a sentence, because a code alone
            // cannot be shown to anybody (§8.1).
            LOG.debug("Refusing {}: {}", message.type(), bad);
            refusals.add(Envelope.of("rejected", Map.of(
                "code", "schema",
                "text", "That message did not match what this server expects: " + bad)));
        }

        List<Envelope> out = new ArrayList<>(refusals);
        out.addAll(dialog.exchange(session, accepted));

        resp.setContentType("application/json;charset=utf-8");
        resp.setHeader("Cache-Control", "no-store");
        MAPPER.writeValue(resp.getOutputStream(), Map.of("envelopes", out));
    }

    @SuppressWarnings("unchecked")
    private static List<Envelope> envelopes(Object raw)
    {
        List<Envelope> out = new ArrayList<>();
        if (raw instanceof List<?> list)
        {
            for (Object item : list)
            {
                if (item instanceof Map<?, ?> map)
                    out.add(MAPPER.convertValue(map, Envelope.class));
            }
        }
        else if (raw instanceof Map<?, ?> map)
        {
            out.add(MAPPER.convertValue(map, Envelope.class));
        }
        return out;
    }
}
