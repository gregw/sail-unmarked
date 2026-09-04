package org.mortbay.sailing.unmarkable.server;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Serves the client from {@code /static/} on the classpath — which, per the pom's
 * {@code <resources>} block, is {@code client/www}. The browser fallback is therefore
 * literally the same files the Capacitor shell wraps, not a second implementation of the
 * same screens.
 *
 * <p>Resolves {@code <!-- INCLUDE foo.html -->} in HTML responses so pages can share a nav
 * fragment without a templating engine. Borrowed from sailing-pf and sail-jinx: same
 * convention, smaller surface.
 */
public class StaticResourceServlet extends HttpServlet
{
    private static final Pattern INCLUDE = Pattern.compile("<!--\\s*INCLUDE\\s+(\\S+)\\s*-->");

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException
    {
        String path = req.getPathInfo();
        if (path == null || "/".equals(path))
            path = "/index.html";
        if (path.contains(".."))
        {
            resp.sendError(400);
            return;
        }

        try (InputStream in = getClass().getResourceAsStream("/static" + path))
        {
            if (in == null)
            {
                resp.sendError(404);
                return;
            }
            resp.setContentType(guessContentType(path));
            if (path.endsWith(".html"))
            {
                String html = new String(in.readAllBytes(), StandardCharsets.UTF_8);
                resp.setCharacterEncoding(StandardCharsets.UTF_8.name());
                resp.getWriter().write(resolveIncludes(html));
            }
            else
            {
                in.transferTo(resp.getOutputStream());
            }
        }
    }

    private String resolveIncludes(String html) throws IOException
    {
        Matcher m = INCLUDE.matcher(html);
        StringBuilder sb = new StringBuilder();
        while (m.find())
        {
            String replacement = "";
            try (InputStream inc = getClass().getResourceAsStream("/static/" + m.group(1)))
            {
                if (inc != null)
                    replacement = new String(inc.readAllBytes(), StandardCharsets.UTF_8);
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(replacement));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String guessContentType(String path)
    {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }
}
