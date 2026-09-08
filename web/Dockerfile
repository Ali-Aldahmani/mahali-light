# Native Next.js App Router UI — self-contained under web/, no Vite/src dependency.
FROM node:22-bookworm-slim AS deps
WORKDIR /repo/web
COPY web/package.json web/package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
ARG NEXT_PUBLIC_EXPRESS_PORT=3000
WORKDIR /repo
COPY --from=deps /repo/web/node_modules ./web/node_modules
COPY web ./web
WORKDIR /repo/web
ENV NEXT_TELEMETRY_DISABLED=1
ENV EXPRESS_INTERNAL_URL=http://express-api:3000
# Baked into the browser bundle now — must match the host-published API
# port (docker-compose passes this as a build arg from API_PORT in .env).
ENV NEXT_PUBLIC_EXPRESS_PORT=$NEXT_PUBLIC_EXPRESS_PORT
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV EXPRESS_INTERNAL_URL=http://express-api:3000
RUN groupadd -r nextjs && useradd -r -g nextjs nextjs
COPY --from=build --chown=nextjs:nextjs /repo/web/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /repo/web/.next/static ./web/.next/static
COPY --from=build --chown=nextjs:nextjs /repo/web/public ./web/public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=8s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "web/server.js"]
