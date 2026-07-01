import { getEnv } from "@/lib/env";
import {
  AB_VARIANTS,
  getCheckoutAbConfig,
  resolveCheklyUrl,
  type AbVariant,
} from "@/lib/checkout-ab/config";

export type BridgePageConfig = {
  experimentId: string;
  visitorId: string;
  variant: AbVariant;
  cheklyUrl: string;
  cheklyFallbackUrl: string;
  checkoutApiUrl: string;
  shopDomain: string;
  eventsApiUrl: string;
};

export function renderCheckoutAbBridgePage(config: BridgePageConfig): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Переход до оформлення…</title>
  <style>
    body { font-family: system-ui, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:#faf9f7; color:#333; }
    .box { text-align:center; padding:2rem; }
    .spinner { width:32px; height:32px; border:3px solid #e5e5e5; border-top-color:#333; border-radius:50%; animation:spin .8s linear infinite; margin:0 auto 1rem; }
    @keyframes spin { to { transform:rotate(360deg); } }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner" aria-hidden="true"></div>
    <p>Готуємо оформлення замовлення…</p>
  </div>
  <script>
(function () {
  var config = ${json};
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: 'checkout_ab_assigned',
    experiment_id: config.experimentId,
    variant: config.variant
  });

  function logEvent(name, payload) {
    return fetch(config.eventsApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({
        experimentId: config.experimentId,
        visitorId: config.visitorId,
        variant: config.variant,
        eventName: name,
        payload: payload || {}
      })
    }).catch(function () {});
  }

  async function run() {
    var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
    try {
      var cartRes = await fetch(root + 'cart.js', { credentials: 'same-origin' });
      if (!cartRes.ok) throw new Error('cart_load_failed');
      var cart = await cartRes.json();
      if (!cart.items || cart.items.length === 0) {
        window.location.href = root + 'cart';
        return;
      }

      await fetch(root + 'cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          attributes: {
            ab_test: config.experimentId,
            ab_variant: config.variant,
            ab_visitor_id: config.visitorId
          }
        })
      });

      await logEvent('checkout_click', {
        cart_token: cart.token,
        cart_total: cart.total_price,
        item_count: cart.item_count,
        referrer: document.referrer,
        user_agent: navigator.userAgent
      });

      if (config.variant === '${AB_VARIANTS.CHEKLY}') {
        await logEvent('redirected_to_checkout', { destination: 'chekly', url: config.cheklyUrl });
        window.location.href = config.cheklyUrl;
        return;
      }

      var lines = cart.items.map(function (item) {
        return {
          variantGid: 'gid://shopify/ProductVariant/' + item.variant_id,
          quantity: item.quantity
        };
      });

      var sessionRes = await fetch(config.checkoutApiUrl + '/api/public/checkout-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain: config.shopDomain,
          cartLines: lines,
          sourceUrl: window.location.href,
          customAttributes: {
            buyer_type: (cart.attributes && cart.attributes.buyer_type) || 'individual',
            payment_preference: (cart.attributes && cart.attributes.payment_preference) || 'card',
            fop_name: (cart.attributes && cart.attributes.fop_name) || '',
            fop_tax_id: (cart.attributes && cart.attributes.fop_tax_id) || '',
            fop_legal_address: (cart.attributes && cart.attributes.fop_legal_address) || '',
            docs_email: (cart.attributes && cart.attributes.docs_email) || '',
            docs_phone: (cart.attributes && cart.attributes.docs_phone) || '',
            accounting_comment: (cart.attributes && cart.attributes.accounting_comment) || ''
          },
          ab: {
            experimentId: config.experimentId,
            visitorId: config.visitorId,
            variant: config.variant,
            cartToken: cart.token
          }
        })
      });

      if (!sessionRes.ok) throw new Error('session_create_failed');
      var session = await sessionRes.json();
      var checkoutUrl = session.checkoutUrl.startsWith('http')
        ? session.checkoutUrl
        : config.checkoutApiUrl + session.checkoutUrl;

      await logEvent('redirected_to_checkout', {
        destination: 'custom',
        checkout_session_id: session.sessionId,
        url: checkoutUrl
      });

      window.location.href = checkoutUrl;
    } catch (err) {
      console.error('[CheckoutAB]', err);
      logEvent('checkout_error', { message: String(err) });
      window.location.href = config.cheklyFallbackUrl;
    }
  }

  run();
})();
  </script>
</body>
</html>`;
}

export function buildBridgeConfig(input: {
  experimentId: string;
  visitorId: string;
  variant: AbVariant;
  shopOrigin: string;
}): BridgePageConfig {
  const abConfig = getCheckoutAbConfig();
  const appUrl = getEnv().APP_URL.replace(/\/$/, "");
  const cheklyUrl = resolveCheklyUrl(input.shopOrigin, abConfig.CHEKLY_CHECKOUT_URL);

  return {
    experimentId: input.experimentId,
    visitorId: input.visitorId,
    variant: input.variant,
    cheklyUrl,
    cheklyFallbackUrl: cheklyUrl,
    checkoutApiUrl: appUrl,
    shopDomain: abConfig.KAYER_SHOP_DOMAIN,
    eventsApiUrl: `${appUrl}/api/checkout-ab/events`,
  };
}
