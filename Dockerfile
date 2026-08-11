# --- Build-Stage: Frontend bauen -------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci || npm install

COPY . .
RUN npm run build -w web

# --- Runtime-Stage ----------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY server/package.json ./server/
RUN npm install --omit=dev --workspace server --include-workspace-root

COPY server ./server
COPY api-doku.json ./api-doku.json
COPY --from=build /app/web/dist ./web/dist

# Verbindungsprofile persistieren – als Volume mounten
VOLUME ["/app/server/data"]

EXPOSE 4100
ENV FLNS_PORT=4100
CMD ["node", "server/index.js"]
