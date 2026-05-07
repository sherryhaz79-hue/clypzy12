# Clypzy / Diro Website (Local Setup)

## Prerequisites
- Node.js `>= 18`
- npm
- MongoDB running locally on `mongodb://localhost:27017` (or your own URI)

## 1) Configure environment

Backend:
```bash
cd backend
cp .env.example .env
```

Frontend:
```bash
cd frontend
cp .env.example .env
```

## 2) Install dependencies

Backend:
```bash
cd backend
npm install
```

Frontend:
```bash
cd frontend
npm install
```

## 3) Run locally

Start backend:
```bash
cd backend
npm run dev
```

Start frontend in a second terminal:
```bash
cd frontend
npm run dev
```

Frontend: `http://localhost:5173`  
Backend API: `http://localhost:3000/api`  
Health check: `http://localhost:3000/health`

## Docker (full stack)

Run everything (frontend + backend + MongoDB):
```bash
docker compose up --build
```

Services:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000/api`
- MongoDB: `mongodb://localhost:27017`

Run detached:
```bash
docker compose up -d --build
```

Stop:
```bash
docker compose down
```

Stop and remove volumes (clears DB/uploads):
```bash
docker compose down -v
```

## Instagram Graph metrics (implemented)

The backend now fetches and caches for Instagram clips:
- `instagramThumbnailUrl`
- `instagramVideoPlayCount`

Cache expiry is controlled by:
- `INSTAGRAM_GRAPH_CACHE_TTL_MS` (default 1 hour / `3600000`)

The request uses:
- `INSTAGRAM_GRAPH_DOC_ID` (default `8845758582119845`)

Disable Instagram fetches if needed:
- `INSTAGRAM_GRAPH_ENABLED=false`

## Optional: seed data

```bash
cd backend
npm run seed
```
