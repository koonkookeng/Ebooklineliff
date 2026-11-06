#!/usr/bin/env bash
set -e

echo "🚀 [EbookLineLIFF V2] Deploying Full-Stack Containers Locally..."

# 1. Build Shared Workspace Package
echo "📦 Building @repo/shared package..."
pnpm --filter @repo/shared build

# 2. Start Infrastructure Containers (PostgreSQL & Redis Cluster)
echo "🐘 Starting PostgreSQL & Redis Cluster Services..."
docker compose up -d postgres redis-node-1 redis-node-2 redis-node-3 redis-node-4 redis-node-5 redis-node-6 redis-cluster-init

# 3. Wait for PostgreSQL readiness
echo "⏳ Waiting for PostgreSQL to be ready..."
docker compose exec -T postgres sh -c 'until pg_isready -U omni_admin -d omni_db; do sleep 1; done'

# 4. Build and start application services
echo "🐳 Building and spinning up Backend and Frontend containers..."
docker compose up -d --build backend frontend

echo ""
echo "✅ Full-stack container deployment finished!"
echo "   - Frontend (Web/LIFF): http://localhost:3000"
echo "   - Backend (API):       http://localhost:3001/api/v1/healthz/liveness"
echo "   - PostgreSQL:          localhost:5432 (omni_db)"
echo "   - Redis Cluster:       172.28.0.11-16:6379"
