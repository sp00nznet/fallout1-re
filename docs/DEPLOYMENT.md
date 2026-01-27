# Deployment Guide

This guide covers deploying the Fallout 1 multiplayer platform in various environments.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Deploy (Docker)](#quick-deploy-docker)
- [Production Deployment](#production-deployment)
- [Environment Variables](#environment-variables)
- [SSL/TLS Configuration](#ssltls-configuration)
- [Scaling](#scaling)
- [Monitoring](#monitoring)
- [Backup & Recovery](#backup--recovery)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| Docker | 24+ | Container runtime |
| Docker Compose | 2.20+ | Container orchestration |
| Node.js | 20+ | Local development (optional) |

### Required Files

- Original Fallout game files (`master.dat`, `critter.dat`, etc.)
- Converted game assets (see Asset Conversion)

---

## Quick Deploy (Docker)

### 1. Clone Repository

```bash
git clone https://github.com/your-repo/fallout1-re.git
cd fallout1-re
```

### 2. Configure Environment

```bash
# Copy example environment file
cp docker/.env.example docker/.env

# Edit with your settings
nano docker/.env
```

### 3. Place Game Assets

```bash
# Create assets directory
mkdir -p docker/assets

# Copy converted game assets
cp -r /path/to/converted/assets/* docker/assets/
```

### 4. Start Services

```powershell
# Using management script
.\scripts\server.ps1 -Start

# Or using docker-compose directly
cd docker
docker-compose up -d
```

### 5. Initialize Database

```powershell
# Run migrations
.\scripts\server.ps1 -Migrate

# Or manually
docker-compose exec fallout1-api npx prisma migrate deploy
```

### 6. Access the Application

- **Web Client**: http://localhost:8080
- **API**: http://localhost:8080/api
- **WebSocket**: ws://localhost:8080/ws

---

## Production Deployment

### Docker Compose (Recommended)

Create a production compose file:

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  fallout1-web:
    image: fallout1-web:latest
    restart: always
    networks:
      - fallout1-network
    depends_on:
      - fallout1-api

  fallout1-api:
    image: fallout1-api:latest
    restart: always
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - JWT_SECRET=${JWT_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
    networks:
      - fallout1-network
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - fallout1-network

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis-data:/data
    networks:
      - fallout1-network

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    networks:
      - fallout1-network
    depends_on:
      - fallout1-web

networks:
  fallout1-network:
    driver: bridge

volumes:
  postgres-data:
  redis-data:
```

### Kubernetes

Example Kubernetes manifests are available in `docker/k8s/`:

```bash
# Apply all manifests
kubectl apply -f docker/k8s/

# Or individually
kubectl apply -f docker/k8s/namespace.yaml
kubectl apply -f docker/k8s/secrets.yaml
kubectl apply -f docker/k8s/postgres.yaml
kubectl apply -f docker/k8s/redis.yaml
kubectl apply -f docker/k8s/api.yaml
kubectl apply -f docker/k8s/web.yaml
kubectl apply -f docker/k8s/ingress.yaml
```

---

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection string | `redis://host:6379` |
| `JWT_SECRET` | Access token signing key | Random 64+ character string |
| `JWT_REFRESH_SECRET` | Refresh token signing key | Random 64+ character string |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API server port |
| `NODE_ENV` | `development` | Environment mode |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |
| `LOG_LEVEL` | `info` | Logging verbosity |

### Generating Secrets

```bash
# Generate secure random strings
openssl rand -base64 48  # For JWT_SECRET
openssl rand -base64 48  # For JWT_REFRESH_SECRET
```

---

## SSL/TLS Configuration

### Using Let's Encrypt (Recommended)

```bash
# Install certbot
apt install certbot

# Generate certificate
certbot certonly --standalone -d yourdomain.com

# Copy to docker volume
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem docker/ssl/
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem docker/ssl/
```

### Nginx SSL Configuration

```nginx
# nginx.conf
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

    location / {
        proxy_pass http://fallout1-web;
    }

    location /api/ {
        proxy_pass http://fallout1-api:3001/api/;
    }

    location /ws {
        proxy_pass http://fallout1-api:3001/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

---

## Scaling

### Horizontal Scaling

The API server is stateless and can be scaled horizontally:

```yaml
# docker-compose.scale.yml
services:
  fallout1-api:
    deploy:
      replicas: 3
```

### Load Balancing

Use nginx upstream for load balancing:

```nginx
upstream api_servers {
    least_conn;
    server fallout1-api-1:3001;
    server fallout1-api-2:3001;
    server fallout1-api-3:3001;
}
```

### WebSocket Sticky Sessions

For WebSocket connections, use IP hash:

```nginx
upstream ws_servers {
    ip_hash;
    server fallout1-api-1:3001;
    server fallout1-api-2:3001;
}
```

---

## Monitoring

### Health Checks

```bash
# API health
curl http://localhost:3001/health

# Response
{"status":"ok","timestamp":"2024-01-15T10:30:00.000Z"}
```

### Prometheus Metrics (Optional)

Add metrics endpoint:

```typescript
// In fallout1-server/src/index.ts
import { collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics();

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Logging

Logs are written to stdout in JSON format:

```bash
# View API logs
docker-compose logs -f fallout1-api

# Filter by level
docker-compose logs fallout1-api | jq 'select(.level == "error")'
```

---

## Backup & Recovery

### Database Backup

```bash
# Create backup
docker-compose exec postgres pg_dump -U fallout1 fallout1 > backup.sql

# Restore backup
docker-compose exec -T postgres psql -U fallout1 fallout1 < backup.sql
```

### Automated Backups

```bash
# Add to crontab
0 2 * * * /path/to/backup-script.sh
```

```bash
#!/bin/bash
# backup-script.sh
DATE=$(date +%Y%m%d_%H%M%S)
docker-compose exec -T postgres pg_dump -U fallout1 fallout1 | gzip > backups/backup_$DATE.sql.gz

# Keep only last 7 days
find backups/ -mtime +7 -delete
```

### Redis Persistence

Redis is configured with AOF persistence. Backups are in the `redis-data` volume.

---

## Troubleshooting

### Common Issues

#### Container Won't Start

```bash
# Check logs
docker-compose logs fallout1-api

# Common fixes
docker-compose down
docker-compose up --build
```

#### Database Connection Failed

```bash
# Verify postgres is running
docker-compose ps postgres

# Check connection
docker-compose exec postgres psql -U fallout1 -c "SELECT 1"
```

#### WebSocket Connection Drops

- Check nginx timeout settings
- Verify firewall allows WebSocket upgrade
- Check for proxy issues with `Connection: upgrade` header

#### Migrations Failed

```bash
# Reset database (WARNING: Deletes all data)
docker-compose exec fallout1-api npx prisma migrate reset

# Or manually
docker-compose exec postgres psql -U fallout1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker-compose exec fallout1-api npx prisma migrate deploy
```

### Debug Mode

```bash
# Run API with debug logging
docker-compose run -e LOG_LEVEL=debug fallout1-api
```

### Support

For issues, please open a GitHub issue with:
- Docker and Docker Compose versions
- Relevant logs
- Steps to reproduce
