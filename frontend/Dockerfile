# =============================================================================
# Next.js console, production image.
#
# Three stages so the runtime image carries only what `next start` needs: the
# dependency install is cached on the lockfile, the build gets the dev
# dependencies, and the runner copies just the standalone output.
# =============================================================================

FROM node:20-alpine AS deps
WORKDIR /app
# Copy manifests first: as long as package.json/lock do not change, this layer is
# reused and the install is skipped on every source-only rebuild.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The API base URL is compiled into the client bundle, so it must be the address
# the *browser* can reach (published host port), not the compose service name.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/api/v1
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/login >/dev/null || exit 1

CMD ["node", "server.js"]
