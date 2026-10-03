FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --omit=dev --workspaces --include-workspace-root
USER node
EXPOSE 3000
# Node 22 strips TypeScript types natively: there is no build step.
CMD ["node", "apps/api/src/main.ts"]
