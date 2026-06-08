# Deployment and Maintenance Guide

## Prerequisites

Before deploying Novisca, ensure you have:

- Node.js 18+
- Rust 1.70+
- Solana CLI 1.17+
- Anchor Framework 0.29+
- PostgreSQL 14+
- Redis 7+
- Docker (optional but recommended)

## Environment Setup

### 1. Clone Repository

```bash
git clone https://github.com/novisca/noviscia-protocal.git
cd noviscia-protocal
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Install Dependencies

```bash
# Root
npm install

# Programs
cd programs/escrow && cargo build && cd ../..

# Web App
cd app/web && npm install && cd ../..

# API
cd app/api && npm install && npm run prisma:migrate && cd ../..

# Services
cd services/indexer && npm install && cd ../..
cd services/keeper && npm install && cd ../..
cd services/price-feed && npm install && cd ../..
cd services/websocket && npm install && cd ../..
```

## Development Deployment

### Local Network

```bash
# Terminal 1: Start Solana validator
./scripts/setup/localnet.sh

# Terminal 2: Deploy programs
npm run deploy:devnet

# Terminal 3: Start web app
cd app/web && npm run dev

# Terminal 4: Start API
cd app/api && npm run dev

# Terminal 5: Start services
cd services/indexer && npm run dev
cd services/keeper && npm run dev
cd services/price-feed && npm run dev
cd services/websocket && npm run dev
```

## Devnet Deployment

### 1. Prepare Deployment

```bash
# Build all programs
npm run build

# Set Solana cluster to devnet
solana config set --url https://api.devnet.solana.com

# Fund your wallet
solana airdrop 10
```

### 2. Deploy Programs

```bash
# Deploy all programs
./scripts/deploy/deploy_all.sh devnet

# Verify deployment
./scripts/deploy/verify.sh devnet
```

### Deployed Program IDs (devnet)

The following programs were deployed to devnet during the current delivery run:

- `burn_engine` = nFgJEQSrKEi7FdAKC6vz5HsQ6f9QjQLBuQcQqQy45id
- `escrow` = CTmCryJca9cFyMRaGdzrhyZeEnjdGLD8ZkEqNcNbvh2D
- `lending_integrator` = Ea5TXHxsVcnKwMAcAsQkpPN88xr8ndBRpNGDkREWrbSZ
- `staking_manager` = 4VDQjH73DiE3zYt66ukyWY7KMMJrxHUZfjkxRHTPDG75
- `token_nvsc` = HSaBJHaGa4Hiv1uBYPHQC4ijmnh8237a5LzM8Lyuz1YT
- `yield_distributor` = CrN1o75FGwcSo6ted7eKxw2kYgkaXDVeWmUaTZCTsLtw

Provider wallet used for deployment: `~/.config/solana/new-id.json` (devnet)


### 3. Deploy Frontend

```bash
cd app/web
npm run build

# Deploy to Vercel
vercel deploy --prod
# OR deploy to AWS S3 + CloudFront
aws s3 sync .next s3://novisca-web/
```

### 4. Deploy Backend API

```bash
cd app/api
npm run build

# Deploy to AWS Lambda / EC2 / DigitalOcean
# Using PM2:
pm2 start dist/index.js --name "novisca-api"
pm2 save
```

### 5. Deploy Services

```bash
# Deploy each service similarly
cd services/indexer && npm run build
pm2 start dist/index.js --name "novisca-indexer"

cd services/keeper && npm run build
pm2 start dist/index.js --name "novisca-keeper"

cd services/price-feed && npm run build
pm2 start dist/index.js --name "novisca-price-feed"

cd services/websocket && npm run build
pm2 start dist/index.js --name "novisca-websocket"
```

### 6. Setup Database

```bash
# Migrate database
cd app/api
npx prisma migrate deploy

# Seed initial data (if needed)
npx prisma db seed
```

## Mainnet Deployment

### Preparation

```bash
# 1. Audit smart contracts
# - Have code reviewed by security firm
# - Run Anchor tests
npm run test

# 2. Test on Testnet
solana config set --url https://api.testnet.solana.com
./scripts/deploy/deploy_all.sh testnet

# 3. Update environment variables for mainnet
cp .env.mainnet .env
```

### Deployment Steps

```bash
# 1. Deploy programs with upgrade authority
solana config set --url https://api.mainnet-beta.solana.com

# Deploy escrow program
cd programs/escrow
anchor deploy --provider.cluster mainnet

# Deploy other programs similarly

# 2. Update Anchor.toml with mainnet program IDs
vi Anchor.toml

# 3. Deploy web frontend
cd app/web
npm run build
# Deploy to CDN (Vercel, Netlify, etc.)

# 4. Deploy API infrastructure
# Using AWS:
cd app/api
npm run build
# Package and deploy to Lambda/EC2

# 5. Setup monitoring and alerts
# Configure CloudWatch, DataDog, or New Relic

# 6. Enable rate limiting and DDoS protection
# Update nginx/CloudFlare configuration
```

## Post-Deployment

### Health Checks

```bash
# Run health check script
./scripts/monitor/health.sh

# Expected output:
# ✅ API Server (3001)... ✅
# ✅ Web App (3000)... ✅
# ✅ WebSocket (8080)... ✅
# ✅ Database... ✅
# ✅ Redis... ✅
```

### Monitoring

```bash
# Check service status
pm2 status

# View logs
pm2 logs novisca-api
pm2 logs novisca-indexer
pm2 logs novisca-keeper

# Monitor performance
pm2 monit
```

### Backup Strategy

```bash
# Database backups (hourly, daily, weekly)
pg_dump novisca > backups/novisca_$(date +%Y%m%d_%H%M%S).sql

# Redis backups
redis-cli BGSAVE

# Smart contract source code
git push origin --all --tags
```

## Troubleshooting

### Program Deployment Fails

```bash
# Check wallet balance
solana balance

# Verify program IDs
anchor keys list

# Check logs
solana logs <PROGRAM_ID>
```

### API Connection Issues

```bash
# Test RPC connection
curl https://api.devnet.solana.com -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Test Redis connection
redis-cli ping
```

### High Transaction Latency

```bash
# Increase priority fee
export PRIORITY_FEE=5000

# Check network congestion
solana network-explorer

# Use alternative RPC endpoint
export SOLANA_RPC=https://api.rpcpool.com
```

## Maintenance

### Weekly Tasks

- Review system logs
- Check database size and optimize queries
- Monitor API response times
- Verify backup completeness

### Monthly Tasks

- Update dependencies: `npm update`
- Review security advisories: `npm audit`
- Analyze user data and metrics
- Update documentation

### Quarterly Tasks

- Security audit of smart contracts
- Load testing of API
- Disaster recovery drill
- Performance optimization review

## Scaling

### Horizontal Scaling

```bash
# Load balance API instances
# Using Nginx:
upstream novisca_api {
  server api1:3001;
  server api2:3001;
  server api3:3001;
}

server {
  listen 80;
  location / {
    proxy_pass http://novisca_api;
  }
}
```

### Database Optimization

```sql
-- Add indexes for common queries
CREATE INDEX idx_user_wallet ON positions(wallet);
CREATE INDEX idx_position_status ON positions(status);
CREATE INDEX idx_trade_symbol ON trades(symbol);
CREATE INDEX idx_yield_wallet ON yield_earned(wallet);

-- Partition large tables
ALTER TABLE trades PARTITION BY RANGE (YEAR(created_at)) (
  PARTITION p_2024 VALUES LESS THAN (2025),
  PARTITION p_2025 VALUES LESS THAN (2026)
);
```

### Caching Strategy

```javascript
// Redis cache for frequently accessed data
const cacheKey = `user:${wallet}:positions`;
const cachedPositions = await redis.get(cacheKey);

if (!cachedPositions) {
  const positions = await db.position.findMany({ where: { wallet } });
  await redis.setex(cacheKey, 300, JSON.stringify(positions)); // 5 min TTL
}
```

## Security Checklist

- [ ] Private keys stored in secure vaults (not in code)
- [ ] HTTPS enabled on all endpoints
- [ ] Rate limiting configured
- [ ] CORS properly restricted
- [ ] SQL injection prevention (using parameterized queries)
- [ ] XSS protection enabled
- [ ] CSRF tokens implemented
- [ ] Regular security audits scheduled
- [ ] Incident response plan documented
- [ ] Data backup tested and verified

## Support

For deployment assistance:
- App: https://noviscia.com
- Documentation: https://noviscia.com/more/docs
- Discord: https://discord.gg/Noviscia-protocol
- Email: keziengotho18@gmail.com
