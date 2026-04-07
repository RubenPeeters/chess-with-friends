# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Download stockfish.js (classic UCI Web Worker build) directly into public/.
# Using the nmrugg/stockfish.js release which is the standard browser UCI worker.
RUN wget -q https://cdn.jsdelivr.net/npm/stockfish@10.0.2/stockfish.js \
         -O public/stockfish.js

# In production there is no VITE_WS_BASE_URL — the hook falls back to
# wss://window.location.host which is correct behind Caddy.
RUN npm run build

# ── Stage 2: serve ────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

RUN apk add --no-cache curl

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
