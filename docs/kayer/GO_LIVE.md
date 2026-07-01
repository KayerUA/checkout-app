# Go-live checklist — kayer.ua

## Перед переключением

- [ ] E2E тест на staging прошёл (см. `docs/kayer/E2E_TEST.md`)
- [ ] LiqPay production keys в Admin → Payments (`isSandbox: false`)
- [ ] NP справочник синхронизирован
- [ ] Worker запущен на Railway
- [ ] DNS `checkout.kayer.ua` → Vercel

## Переключение

1. В theme kayer.ua подключён `checkout-ab-intercept.js`
2. App Proxy `/apps/checkout-ab` настроен
3. Для beta-клиентов задан tag `custom_checkout_beta` или включён `audienceMode: "all"`
4. Тестовый заказ на production с реальной картой или B2B рахунком
5. Заказ появился в Shopify Admin с tags/metafields

## Мониторинг

- `/admin/orders` — связки checkout → Shopify order
- Railway logs — worker errors
- LiqPay cabinet — успешные транзакции

## Rollback

Если что-то сломалось:

1. Поставить `CUSTOM_CHECKOUT_ENABLED=false`
2. Или в theme выставить `audienceMode: "disabled"`
3. Или закомментировать `<script src="...checkout-ab-intercept.js">` в theme.liquid

## После go-live (не срочно)

- Checkbox фискализация
- Abandoned checkout emails
- GA4 purchase events
