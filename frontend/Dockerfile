# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Copy stockfish.js into public/ so it can be served as a Web Worker.
RUN cp node_modules/stockfish/src/stockfish.js public/stockfish.js 2>/dev/null || \
    cp node_modules/stockfish/stockfish.js public/stockfish.js 2>/dev/null || \
    echo "WARNING: stockfish.js not found, engine analysis will be disabled"

# In production there is no VITE_WS_BASE_URL — the hook falls back to
# wss://window.location.host which is correct behind Caddy.
RUN npm run build

# ── Stage 2: serve ────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

RUN apk add --no-cache curl

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
