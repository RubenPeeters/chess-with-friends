# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Stockfish 16 NNUE is vendored via the `stockfish` npm package and copied
# from node_modules into public/stockfish/ by the stockfishAssets Vite plugin
# (see vite.config.js). The plugin runs at buildStart so `npm run build`
# below picks up the worker, .wasm and NNUE weights automatically — no
# external download step needed.
#
# In production there is no VITE_WS_BASE_URL — the hook falls back to
# wss://window.location.host which is correct behind Caddy.
RUN npm run build

# ── Stage 2: serve ────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

RUN apk add --no-cache curl

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
