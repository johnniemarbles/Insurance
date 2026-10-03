FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web ./apps/web
COPY apps/extension/package.json ./apps/extension/package.json
COPY apps/api/package.json ./apps/api/package.json
COPY packages ./packages
RUN npm ci --workspaces --include-workspace-root && npm run build --workspace @pii/web

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
COPY apps/extension/package.json ./apps/extension/package.json
RUN npm ci --omit=dev --workspaces --include-workspace-root
COPY --from=web /app/apps/api/public/app ./apps/api/public/app
USER node
EXPOSE 3000
# Node 22 strips TypeScript types natively: there is no build step for the server.
CMD ["sh", "-c", "node packages/db/src/cli.ts release && node apps/api/src/main.ts"]
