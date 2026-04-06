# chess-with-friends

A real-time chess platform with friends, invite links, ELO ratings, and clock management.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + react-chessboard |
| Gateway | Caddy 2 |
| Auth API | Node.js / Express (port 3000) |
| Game server | Node.js / ws WebSockets (port 4000) |
| Social API | Node.js / Express (port 3001) |
| Database | PostgreSQL 16 |
| Cache / state | Redis 7 |
| Object storage | S3 / Backblaze B2 |

## Quick start

### Prerequisites
- Docker + Docker Compose v2
- Node.js 20+ (for local frontend dev)

### 1 — Copy and fill in environment variables

```bash
cp .env.example .env
# Edit .env — at minimum set POSTGRES_PASSWORD and JWT_SECRET
```

Generate a strong JWT secret:
```bash
openssl rand -hex 64
```

### 2 — Start the full stack

```bash
docker compose up --build
```

Services come up in dependency order. PostgreSQL migration (`db/migrations/001_init.sql`) runs automatically on first boot.

Caddy listens on **http://localhost:80**.

| Path | Routed to |
|---|---|
| `ws://localhost/` | game service :4000 |
| `http://localhost/api/social/*` | social service :3001 |
| `http://localhost/api/*` | api service :3000 |

### 3 — Frontend (development)

```bash
cd frontend
npm install
npm run dev      # Vite dev server on http://localhost:5173
```

The Vite dev server proxies `/api` and WebSocket connections to the Docker stack automatically (see `vite.config.js`).

### 4 — OAuth setup (optional)

**Google:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Authorised redirect URI: `http://localhost/api/auth/oauth/google/callback`
4. Copy Client ID + Secret into `.env`

**GitHub:**
1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Homepage URL: `http://localhost`
3. Callback URL: `http://localhost/api/auth/oauth/github/callback`
4. Copy Client ID + Secret into `.env`

## WebSocket message protocol

All messages are JSON.

### Client → Server

```jsonc
// Make a move
{ "type": "move", "gameId": "uuid", "from": "e2", "to": "e4", "promotion": "q" }

// Rejoin after disconnect (server replays current FEN + clocks from Redis)
{ "type": "rejoin", "gameId": "uuid", "token": "jwt..." }

// Keepalive
{ "type": "ping" }
```

### Server → Client

```jsonc
// Authoritative state after every move
{ "type": "state_update", "fen": "rnbqkbnr/...", "clocks": { "white": 298500, "black": 300000 }, "turn": "b" }

// Game finished
{ "type": "game_over", "result": "white", "reason": "checkmate" }

// Keepalive reply
{ "type": "pong" }
```

Clock values are **milliseconds remaining**.

## Project structure

```
chess-with-friends/
├── docker-compose.yml
├── Caddyfile
├── .env.example
├── frontend/          # React + Vite
├── services/
│   ├── api/           # Auth, JWT, OAuth  (port 3000)
│   ├── game/          # WS game engine    (port 4000)
│   └── social/        # Friends, ELO      (port 3001)
└── db/
    └── migrations/
        └── 001_init.sql
```

## Database migrations

Migrations in `db/migrations/` are executed by PostgreSQL's `docker-entrypoint-initdb.d` mechanism on first start. To run a new migration against a running container:

```bash
docker compose exec postgres psql -U chess -d chess -f /docker-entrypoint-initdb.d/002_your_migration.sql
```

## Stopping / resetting

```bash
# Stop without losing data
docker compose down

# Full reset (deletes all volumes — wipes the database)
docker compose down -v
```
