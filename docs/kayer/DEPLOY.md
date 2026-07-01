# Deploy: Vercel + Railway

## 1. Vercel (Next.js app)

```bash
npm i -g vercel
vercel link
vercel env pull .env.production
```

Добавьте в Vercel Environment Variables:

| Variable | Пример |
|----------|--------|
| `APP_URL` | `https://checkout.kayer.ua` |
| `DATABASE_URL` | из Railway Postgres |
| `REDIS_URL` | из Railway Redis |
| `SHOPIFY_API_KEY` | из Partner dashboard |
| `SHOPIFY_API_SECRET` | из Partner dashboard |
| `SESSION_SECRET` | random 32+ chars |
| `ENCRYPTION_KEY` | 64 hex chars |
| `INTERNAL_JOBS_SECRET` | random 16+ chars |
| `NOVA_POSHTA_API_KEY` | NP API key |

После первого deploy:

```bash
npx prisma db push
```

(запустить один раз с production DATABASE_URL)

## 2. Railway (Postgres + Redis + Worker)

### Postgres + Redis

1. New Project → Add PostgreSQL
2. Add Redis
3. Скопируйте connection strings в Vercel env

### Worker service

1. New Service → Deploy from GitHub repo
2. Start command: `npm run worker`
3. Те же env vars что и Vercel (особенно `DATABASE_URL`, `REDIS_URL`)

### Cron (NP dictionary sync)

Railway Cron или cron-job.org, раз в сутки:

```http
POST https://checkout.kayer.ua/api/internal/jobs
x-internal-secret: YOUR_INTERNAL_JOBS_SECRET
Content-Type: application/json

{"job":"sync-nova-poshta"}
```

## 3. DNS

```
checkout.kayer.ua  CNAME  cname.vercel-dns.com
```

## 4. Проверка

- `https://checkout.kayer.ua/api/health` — status ok
- `https://checkout.kayer.ua/admin` — открывается
- `https://checkout.kayer.ua/api/auth/shopify/install?shop=YOUR-SHOP.myshopify.com` — OAuth
