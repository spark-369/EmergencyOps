import type { NextConfig } from "next";

/**
 * Build-time API origin, used to build the Content-Security-Policy below.
 *
 * `NEXT_PUBLIC_API_BASE_URL` is inlined at build time, so the CSP can name the
 * exact API origin instead of falling back to a broad source expression.
 */
const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api/v1").trim();

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    // A malformed value would otherwise produce a CSP that silently blocks the
    // API. Fall back to the documented local default.
    return "http://localhost:8080";
  }
}

const apiOrigin = originOf(apiBaseUrl);

/**
 * Map tiles (OpenStreetMap) are fetched by Leaflet at runtime. Allow-listed
 * explicitly rather than widening `img-src` to `https:`.
 */
const TILE_ORIGINS = ["https://*.tile.openstreetmap.org", "https://tile.openstreetmap.org"];

/**
 * Content-Security-Policy.
 *
 * Next.js injects inline bootstrap scripts and Tailwind emits inline style
 * attributes, so `'unsafe-inline'` is required for script-src/style-src today.
 * That is weaker than a nonce-based policy and is documented as such rather than
 * quietly assumed to be airtight: the value here is that everything *else* is
 * locked down — no third-party script origins, no framing, and a connect-src that
 * names the API exactly.
 *
 * `'unsafe-eval'` and the dev-server connection sources are added in DEVELOPMENT
 * ONLY.
 *
 * React's development build uses eval() to reconstruct server/client callstacks
 * and to power Fast Refresh. With a CSP that omits it, every page logs
 * "eval() is not supported in this environment" and the dev overlay becomes
 * useless. Production React never calls eval(), so the directive is not granted
 * there — this is the one place where the dev policy is deliberately looser than
 * the shipped one, and it is scoped by NODE_ENV rather than left on permanently.
 *
 * The same applies to `ws:` in connect-src: Turbopack's HMR socket runs over
 * WebSocket on the dev server, and `connect-src 'self' <api>` alone blocks it with
 * a *different* CSP violation once the eval error is gone.
 *
 * `upgrade-insecure-requests` is added only in production. It rewrites every
 * http:// subresource to https://, which in local development would silently
 * break the plain-HTTP API and tile requests.
 */
const isProduction = process.env.NODE_ENV === "production";

/** React dev tooling needs eval(); the production bundle never does. */
const scriptSrc = isProduction
  ? "'self' 'unsafe-inline'"
  : "'self' 'unsafe-inline' 'unsafe-eval'";

/**
 * Dev needs the HMR websocket and the API; production needs only the API.
 * `ws:`/`wss:` are omitted in production so an injected script cannot exfiltrate
 * over a websocket to an origin that is not explicitly listed.
 */
const connectSrc = isProduction
  ? `'self' ${apiOrigin}`
  : `'self' ${apiOrigin} ws: wss: http://localhost:* http://127.0.0.1:*`;

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${TILE_ORIGINS.join(" ")}`,
  "font-src 'self' data:",
  `connect-src ${connectSrc}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

/**
 * Security headers for every response.
 *
 * These were previously absent: the Next app served no CSP, HSTS or frame
 * protection at all, while the backend set `frameOptions.deny()`. A console that
 * holds JWTs in localStorage and can be framed is clickjackable, and without a
 * CSP any XSS runs with full access to those tokens.
 *
 * HSTS is only meaningful over HTTPS. It is emitted unconditionally here and is
 * ignored by browsers on plain-HTTP origins, so local development is unaffected.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  /**
   * REQUIRED by the Docker image.
   *
   * `frontend/Dockerfile` copies `.next/standalone` and runs `node server.js`.
   * Without this flag Next emits neither, so the image build failed at the COPY
   * step (or the container started with no entrypoint). The comment in the
   * Dockerfile already assumed this option was set; it simply never was.
   */
  output: "standalone",

  // The UI is a purely client-side console (RTK Query + axios), so no dynamic
  // server data fetching is required from the framework itself.
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },

  /**
   * Do not advertise the framework version in responses — it tells an attacker
   * which advisories to try first.
   */
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

