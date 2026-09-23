# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_AUTH_PROVIDER=legacy
ENV NEXT_PUBLIC_AUTH_PROVIDER=${NEXT_PUBLIC_AUTH_PROVIDER}

# Keep this version aligned with package.json's packageManager field.
RUN npm install --global pnpm@10.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/integrations/package.json ./packages/integrations/package.json
RUN pnpm install --frozen-lockfile

# .dockerignore excludes local credentials, caches, and dependencies.
COPY . .
RUN pnpm build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN addgroup --system --gid 1001 stockpilot \
    && adduser --system --uid 1001 --ingroup stockpilot stockpilot
COPY --from=build --chown=stockpilot:stockpilot /app/apps/web/.next/standalone ./
COPY --from=build --chown=stockpilot:stockpilot /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=stockpilot:stockpilot /app/apps/web/public ./apps/web/public
RUN mkdir -p /app/apps/web/.next/cache \
    && chown stockpilot:stockpilot /app/apps/web/.next/cache

USER stockpilot
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
