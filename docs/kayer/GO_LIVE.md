# Go-live checklist — kayer.ua

## Перед переключением

- [ ] E2E тест на staging прошёл (см. `docs/kayer/E2E_TEST.md`)
- [ ] LiqPay production keys в Admin → Payments (`isSandbox: false`)
- [ ] NP справочник синхронизирован
- [ ] Worker запущен на Railway
- [ ] DNS `checkout.kayer.ua` → Vercel

## Переключение

1. В theme kayer.ua подключён `kayer-checkout.js`
2. App Proxy `/apps/kayer-checkout-auth` ведёт на `https://checkout.kayer.ua/apps/kayer-checkout-auth`
3. Тестовый заказ на production с реальной картой или B2B рахунком
4. Заказ появился в Shopify Admin с tags/metafields

## Мониторинг

- `/admin/orders` — связки checkout → Shopify order
- Railway logs — worker errors
- LiqPay cabinet — успешные транзакции

## Rollback

Если что-то сломалось:

1. Вернуть предыдущую версию `theme.liquid`
2. Откатить последний production deployment Vercel

## После go-live (не срочно)

- Checkbox фискализация
- Abandoned checkout emails
- GA4 purchase events
