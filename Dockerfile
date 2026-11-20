# Production image for the Raahi NOW API.
# Build:  docker build -t raahi-now-api .
# Run:    docker run --env-file .env -p 3000:3000 raahi-now-api
# Migrate: docker run --env-file .env raahi-now-api node dist-openapi/scripts/migrate.js

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --legacy-peer-deps
COPY . .
# dist/ is the app; dist-openapi/scripts/migrate.js is the migration runner.
RUN npm run build && npx tsc -p tsconfig.openapi.json \
  && npm prune --omit=dev --legacy-peer-deps

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-openapi ./dist-openapi
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
