/**
 * KAYER external checkout bridge for Shopify storefront.
 * Connect in theme.liquid: <script src="https://checkout.kayer.ua/kayer-checkout.js" defer></script>
 * Use data-kayer-checkout on checkout buttons.
 */
(function () {
  const config = Object.assign(
    {
      checkoutApiUrl: "https://checkout.kayer.ua",
      shopDomain: "kayer.myshopify.com",
      fallbackUrl: "/cart",
      customerEmail: "",
      customerId: "",
      customerFirstName: "",
      customerLastName: "",
      customerPhone: "",
      pricingTokenUrl: "/apps/kayer-checkout-auth",
      showB2BBlock: true,
    },
    window.KAYER_CHECKOUT_CONFIG || {}
  );
  // The App Proxy safely returns { loggedIn: false } for guests. Do not allow a
  // stale theme config with `pricingTokenUrl: null` to drop partner identity.
  if (!config.pricingTokenUrl) config.pricingTokenUrl = "/apps/kayer-checkout-auth";
  var PENDING_CLEAR_STORAGE_KEY = "kayer_pending_checkout_clear";

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isAudienceEligible() {
    return true;
  }

  function findCheckoutElement(el) {
    if (!el || !el.closest) return null;
    return el.closest(
      [
        "[data-kayer-checkout]",
        "[data-checkout]",
        "[formaction*='checkout']",
        'button[name="checkout"]',
        'input[name="checkout"]',
        'input[type="submit"][name="checkout"]',
        'a[href="/checkout"]',
        'a[href$="/checkout"]',
        'a[href*="/checkout"]',
        'a[href*="/checkouts/"]',
        'button[class*="checkout"]',
        'a[class*="checkout"]',
        '[role="button"][class*="checkout"]',
        '[role="button"][aria-label*="checkout"]',
        ".checkout-button",
        ".cart__checkout",
        ".btn--checkout",
        ".cart-summary-panel__checkout",
        ".shopify-payment-button",
        ".shopify-payment-button__button",
      ].join(", ")
    );
  }

  function isCheckoutHref(href) {
    if (!href) return false;
    if (href.indexOf("/checkouts/") >= 0) return true;
    if (href.indexOf("/products/") >= 0) return false;
    if (href === "/checkout" || href.endsWith("/checkout")) return true;
    if (href.indexOf("/checkout?") >= 0) return true;
    return false;
  }

  function isNativeCheckoutFallback(url) {
    var value = normalize(url);
    return (
      value === "/checkout" ||
      value.endsWith("/checkout") ||
      value.indexOf("/checkouts/") >= 0
    );
  }

  function looksLikeCheckoutElement(el) {
    if (!el) return false;
    var text = normalize(el.textContent || el.value || el.getAttribute("aria-label") || "");
    var href = normalize(el.getAttribute && el.getAttribute("href"));
    var action = normalize(el.getAttribute && el.getAttribute("action"));
    var formaction = normalize(el.getAttribute && el.getAttribute("formaction"));
    var className = normalize(el.className);
    var id = normalize(el.id);
    var name = normalize(el.getAttribute && el.getAttribute("name"));
    var isButtonLike =
      el.matches &&
      el.matches("button, input, [role='button'], [data-checkout], [data-kayer-checkout]");
    return (
      isCheckoutHref(href) ||
      action.indexOf("checkout") >= 0 ||
      formaction.indexOf("checkout") >= 0 ||
      className.indexOf("checkout") >= 0 ||
      id.indexOf("checkout") >= 0 ||
      name === "checkout" ||
      (isButtonLike && text.indexOf("checkout") >= 0) ||
      (isButtonLike && text.indexOf("check out") >= 0) ||
      text.indexOf("оформити") >= 0 ||
      text.indexOf("оформлен") >= 0 ||
      text.indexOf("замовити") >= 0
    );
  }

  function findLikelyCheckoutTrigger(el) {
    var explicit = findCheckoutElement(el);
    if (explicit) return explicit;
    var candidate = el && el.closest
      ? el.closest("button, a, input, [role='button'], [onclick]")
      : null;
    return looksLikeCheckoutElement(candidate) ? candidate : null;
  }

  function checkoutSelectors() {
    return [
      "[data-kayer-checkout]",
      "[data-checkout]",
      "[formaction*='checkout']",
      'button[name="checkout"]',
      'input[name="checkout"]',
      'input[type="submit"][name="checkout"]',
      'a[href="/checkout"]',
      'a[href$="/checkout"]',
      'a[href*="/checkout"]',
      'a[href*="/checkouts/"]',
      'button[class*="checkout"]',
      'a[class*="checkout"]',
      '[role="button"][class*="checkout"]',
      '[role="button"][aria-label*="checkout"]',
      ".checkout-button",
      ".cart__checkout",
      ".btn--checkout",
      ".cart-summary-panel__checkout",
      ".shopify-payment-button",
      ".shopify-payment-button__button",
    ];
  }

  function shopifyRoot() {
    var root =
      (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    return root.endsWith("/") ? root : root + "/";
  }

  function removeCartClearParams() {
    try {
      var url = new URL(window.location.href);
      url.searchParams.delete("kayer_clear_cart");
      url.searchParams.delete("kayer_checkout");
      window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    } catch {}
  }

  async function clearStorefrontCart() {
    var root = shopifyRoot();
    var clearRes = await fetch(root + "cart/clear.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    var cart = await clearRes.json().catch(function () {
      return null;
    });

    await fetch(root + "cart/update.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attributes: {
          buyer_type: "",
          payment_preference: "",
          fop_name: "",
          fop_tax_id: "",
          fop_legal_address: "",
          docs_email: "",
          docs_phone: "",
          accounting_comment: "",
        },
      }),
    }).catch(function () {});

    window.dispatchEvent(new CustomEvent("cart:refresh", { detail: { cart: cart } }));
    window.dispatchEvent(new CustomEvent("cart:updated", { detail: { cart: cart } }));
    document.dispatchEvent(new CustomEvent("cart:refresh", { detail: { cart: cart } }));
    document.dispatchEvent(new CustomEvent("cart:updated", { detail: { cart: cart } }));
    return cart;
  }

  async function clearCartIfRequested() {
    var params = new URLSearchParams(window.location.search);
    if (params.get("kayer_clear_cart") !== "1") return;
    if (window.__kayerCartClearHandled) return;
    window.__kayerCartClearHandled = true;

    try {
      await clearStorefrontCart();
      removeCartClearParams();
    } catch (err) {
      console.warn("[KayerCheckout] cart clear failed", err);
    }
  }

  function rememberCheckoutForCartClear(publicToken, cartToken) {
    if (!publicToken) return;
    try {
      window.localStorage.setItem(
        PENDING_CLEAR_STORAGE_KEY,
        JSON.stringify({
          publicToken: publicToken,
          cartToken: cartToken || "",
          ts: Date.now(),
        })
      );
    } catch {}
  }

  function forgetCheckoutForCartClear() {
    try {
      window.localStorage.removeItem(PENDING_CLEAR_STORAGE_KEY);
    } catch {}
  }

  function readCheckoutForCartClear() {
    try {
      var raw = window.localStorage.getItem(PENDING_CLEAR_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.publicToken) return null;
      if (Date.now() - Number(parsed.ts || 0) > 7 * 24 * 60 * 60 * 1000) {
        forgetCheckoutForCartClear();
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function checkoutIsCompleteForCartClear(status) {
    if (!status) return false;
    return (
      status.status === "PAID" ||
      status.status === "COMPLETED" ||
      status.paymentStatus === "PAID" ||
      Boolean(status.orderLink && status.orderLink.shopifyOrderGid)
    );
  }

  async function clearCompletedCheckoutCart() {
    if (window.__kayerCompletedCartClearChecked) return;
    window.__kayerCompletedCartClearChecked = true;
    var pending = readCheckoutForCartClear();
    if (!pending) return;

    try {
      var statusRes = await fetch(
        config.checkoutApiUrl + "/api/public/checkout-sessions/" + encodeURIComponent(pending.publicToken) + "/status",
        { credentials: "omit" }
      );
      if (statusRes.status === 404) {
        forgetCheckoutForCartClear();
        return;
      }
      if (!statusRes.ok) return;
      var status = await statusRes.json().catch(function () {
        return null;
      });
      if (!checkoutIsCompleteForCartClear(status)) return;
      await clearStorefrontCart();
      forgetCheckoutForCartClear();
    } catch (err) {
      console.warn("[KayerCheckout] completed checkout cart clear failed", err);
    }
  }

  function formatCheckoutError(err) {
    var message = err && err.message ? String(err.message) : "Checkout session failed";
    if (message.indexOf("Cart total mismatch") >= 0) {
      return "Ціни в кошику змінились. Оновіть сторінку кошика і спробуйте ще раз.";
    }
    if (message.indexOf("Merchant Shopify session not found") >= 0) {
      return "Checkout тимчасово недоступний. Спробуйте через кілька хвилин.";
    }
    if (message.indexOf("Variant not found") >= 0) {
      return "У кошику застарілий товар. Оновіть кошик і спробуйте ще раз.";
    }
    return message;
  }

  function checkoutLoadingCopy() {
    var lc = String(document.documentElement.lang || "uk").toLowerCase();
    if (lc.indexOf("pl") === 0) {
      return {
        button: "Przygotowujemy kasę…",
        title: "Bezpieczne checkout KAYER",
        subtitle: "Zwykle trwa to kilka sekund",
      };
    }
    if (lc.indexOf("en") === 0) {
      return {
        button: "Preparing checkout…",
        title: "Secure KAYER checkout",
        subtitle: "This usually takes a few seconds",
      };
    }
    return {
      button: "Готуємо оформлення…",
      title: "Безпечний checkout KAYER",
      subtitle: "Зазвичай це займає кілька секунд",
    };
  }

  function ensureCheckoutLoadingStyles() {
    if (document.getElementById("kayer-checkout-loading-styles")) return;
    var style = document.createElement("style");
    style.id = "kayer-checkout-loading-styles";
    style.textContent =
      "@keyframes kayerCheckoutBar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}" +
      "@keyframes kayerCheckoutSpin{to{transform:rotate(360deg)}}" +
      ".kayer-checkout-loading-bar{position:fixed;top:0;left:0;right:0;height:3px;z-index:100001;overflow:hidden;background:rgba(47,47,50,.08);pointer-events:none}" +
      ".kayer-checkout-loading-bar::after{content:'';position:absolute;top:0;left:0;width:40%;height:100%;background:linear-gradient(90deg,transparent,#2f2f32 45%,#2f2f32 55%,transparent);animation:kayerCheckoutBar 1.1s ease-in-out infinite}" +
      ".kayer-checkout-loading-toast{position:fixed;left:50%;bottom:calc(1.25rem + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:100000;display:flex;align-items:center;gap:.75rem;max-width:min(92vw,24rem);padding:.85rem 1rem;border-radius:999px;background:rgba(255,255,255,.98);border:1px solid rgba(47,47,50,.12);box-shadow:0 18px 40px rgba(47,47,50,.16);color:#2f2f32;font-size:.92rem;line-height:1.35;font-weight:650;pointer-events:none}" +
      ".kayer-checkout-loading-toast__spinner{width:1rem;height:1rem;border:2px solid rgba(47,47,50,.16);border-top-color:#2f2f32;border-radius:50%;animation:kayerCheckoutSpin .7s linear infinite;flex:0 0 auto}" +
      ".kayer-checkout-loading-toast__text{display:grid;gap:.12rem;min-width:0}" +
      ".kayer-checkout-loading-toast__title{font-weight:850}" +
      ".kayer-checkout-loading-toast__sub{font-size:.78rem;font-weight:600;color:rgba(47,47,50,.68)}" +
      "body.kayer-checkout-is-loading{cursor:progress}" +
      "body.kayer-checkout-is-loading .cart-summary-panel,body.kayer-checkout-is-loading form[action*='/cart']{pointer-events:none;user-select:none}" +
      ".kayer-checkout--loading{position:relative;opacity:.96;cursor:progress!important}" +
      ".kayer-checkout-btn-spinner{display:inline-block;width:1rem;height:1rem;margin-right:.55rem;border:2px solid rgba(255,255,255,.28);border-top-color:#fff;border-radius:50%;vertical-align:-2px;animation:kayerCheckoutSpin .7s linear infinite}";
    document.head.appendChild(style);
  }

  function findCheckoutTrigger(preferred) {
    if (preferred && preferred.nodeType === 1) return preferred;
    return (
      document.querySelector(".cart-summary-panel__checkout") ||
      document.querySelector("[data-kayer-checkout]") ||
      document.querySelector('button[name="checkout"]') ||
      document.querySelector(".cart__checkout")
    );
  }

  function beginCheckoutLoading(trigger) {
    if (window.__kayerCheckoutLoading) return findCheckoutTrigger(trigger);
    ensureCheckoutLoadingStyles();
    var copy = checkoutLoadingCopy();
    var btn = findCheckoutTrigger(trigger);

    if (!document.getElementById("kayer-checkout-loading-bar")) {
      var bar = document.createElement("div");
      bar.id = "kayer-checkout-loading-bar";
      bar.className = "kayer-checkout-loading-bar";
      bar.setAttribute("aria-hidden", "true");
      document.body.appendChild(bar);
    }

    if (!document.getElementById("kayer-checkout-loading-toast")) {
      var toast = document.createElement("div");
      toast.id = "kayer-checkout-loading-toast";
      toast.className = "kayer-checkout-loading-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.innerHTML =
        '<span class="kayer-checkout-loading-toast__spinner" aria-hidden="true"></span>' +
        '<span class="kayer-checkout-loading-toast__text">' +
        '<span class="kayer-checkout-loading-toast__title">' +
        copy.title +
        "</span>" +
        '<span class="kayer-checkout-loading-toast__sub">' +
        copy.subtitle +
        "</span></span>";
      document.body.appendChild(toast);
    }

    document.body.classList.add("kayer-checkout-is-loading");

    if (btn) {
      if (!btn.dataset.kayerCheckoutLabel) {
        btn.dataset.kayerCheckoutLabel = btn.textContent.trim();
      }
      btn.classList.add("kayer-checkout--loading");
      btn.setAttribute("aria-busy", "true");
      if (btn.disabled !== undefined) btn.disabled = true;
      btn.innerHTML =
        '<span class="kayer-checkout-btn-spinner" aria-hidden="true"></span><span>' +
        copy.button +
        "</span>";
    }

    document
      .querySelectorAll(".cart-page--minimal__actions .btn, .update-cart, .cart__checkout")
      .forEach(function (el) {
        if (el === btn || el.disabled === undefined || el.dataset.kayerCheckoutDisabled) return;
        el.disabled = true;
        el.dataset.kayerCheckoutDisabled = "true";
      });

    window.__kayerCheckoutLoading = true;
    return btn;
  }

  function endCheckoutLoading(trigger) {
    document.body.classList.remove("kayer-checkout-is-loading");
    var bar = document.getElementById("kayer-checkout-loading-bar");
    var toast = document.getElementById("kayer-checkout-loading-toast");
    if (bar) bar.remove();
    if (toast) toast.remove();

    var btn = findCheckoutTrigger(trigger);
    if (btn) {
      btn.classList.remove("kayer-checkout--loading");
      btn.removeAttribute("aria-busy");
      if (btn.dataset.kayerCheckoutLabel) {
        btn.textContent = btn.dataset.kayerCheckoutLabel;
      }
      if (btn.disabled !== undefined) btn.disabled = false;
    }

    document.querySelectorAll("[data-kayer-checkout-disabled]").forEach(function (el) {
      el.disabled = false;
      el.removeAttribute("data-kayer-checkout-disabled");
    });

    window.__kayerCheckoutLoading = false;
  }

  function handleRedirectError(err, trigger) {
    window.__kayerRedirectInProgress = false;
    endCheckoutLoading(trigger);
    console.error("[KayerCheckout]", err);
    var message = formatCheckoutError(err);
    var fallback = config.fallbackUrl || "/cart";
    var blockNativeFallback = isNativeCheckoutFallback(fallback);
    if (blockNativeFallback) {
      alert("Не вдалося відкрити checkout KAYER.\n" + message);
      return;
    }
    window.location.href = fallback;
  }

  function cartLinePayload(item) {
    var unit = item.final_price != null ? item.final_price : item.price;
    var original = item.original_price != null ? item.original_price : unit;
    return {
      variantGid: "gid://shopify/ProductVariant/" + item.variant_id,
      quantity: item.quantity,
      unitPriceCents: unit,
      originalUnitPriceCents: original,
    };
  }

  async function fetchStorefrontPricingToken() {
    var url = config.pricingTokenUrl;
    if (!url) return null;
    var crossOrigin = /^https?:\/\//i.test(url);
    try {
      var res = await fetch(url, crossOrigin ? {} : { credentials: "same-origin" });
      if (!res.ok) return null;
      var data = await res.json();
      if (!data || !data.loggedIn || !data.pricingToken) return null;
      return data;
    } catch (err) {
      console.warn("[KayerCheckout] pricing token fetch failed", err);
      return null;
    }
  }

  function buildCartDiscountSnapshot(cart) {
    if (typeof window.kayerBuildCartDiscountSnapshot === "function") {
      return window.kayerBuildCartDiscountSnapshot(cart);
    }

    var gross = 0;
    (cart.items || []).forEach(function (item) {
      if ((item.quantity || 0) > 0) gross += item.original_line_price || 0;
    });

    var rows = [];
    if (typeof window.collectUaCartDiscountRows === "function") {
      rows = window.collectUaCartDiscountRows(cart).map(function (row) {
        return { title: row.title, amountCents: row.amount };
      });
    } else if (gross > (cart.total_price || 0)) {
      rows = [{ title: "Знижки", amountCents: gross - (cart.total_price || 0) }];
    }

    return {
      grossSubtotalCents: gross,
      discountRows: rows,
      totalDueCents: cart.total_price || 0,
      pricingMode: "shopify_cart",
    };
  }

  function readCookie(name) {
    try {
      var prefix = name + "=";
      var rows = document.cookie ? document.cookie.split("; ") : [];
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].indexOf(prefix) === 0) {
          return decodeURIComponent(rows[i].slice(prefix.length));
        }
      }
    } catch {}
    return "";
  }

  function isUaRegionalCatalogPartner() {
    var sf = window.KayerPartnerStorefront;
    if (sf && sf.distributor && sf.market) {
      var market = String(sf.market).toUpperCase();
      if (market === "LVIV" || market === "LUTSK" || market === "KHARKIV") return true;
    }
    if (
      document.body &&
      document.body.classList.contains("kayer-partner-pricing--gross") &&
      document.body.getAttribute("data-kayer-distributor-partner") === "1"
    ) {
      return true;
    }
    return false;
  }

  function appliedCartDiscountCode(cart) {
    var codes = (cart && cart.discount_codes) || [];
    for (var i = 0; i < codes.length; i += 1) {
      var row = codes[i];
      var code = typeof row === "string" ? row : row && (row.code || row.discount_code);
      if (code && String(code).trim()) {
        var normalized = String(code).trim().toUpperCase();
        if (/^PARTNER-/i.test(normalized) && isUaRegionalCatalogPartner()) return "";
        return normalized;
      }
    }

    // The newsletter cookie is also the checkout fallback when Shopify Ajax cart
    // doesn't expose the code in cart.discount_codes.
    var newsletterCode = readCookie("kayer_ua_promo_confirmed");
    return newsletterCode ? newsletterCode.trim().toUpperCase() : "";
  }

  async function redirectToCheckout(trigger) {
    if (window.__kayerRedirectInProgress) return;
    window.__kayerRedirectInProgress = true;
    beginCheckoutLoading(trigger);

    const root = shopifyRoot();
    const cartRes = await fetch(root + "cart.js", { credentials: "same-origin" });
    if (!cartRes.ok) throw new Error("Failed to load cart");
    const cart = await cartRes.json();

    if (!cart.items || cart.items.length === 0) {
      window.location.href = root + "cart";
      return;
    }

    const cartLines = cart.items.map(cartLinePayload);
    const pricingAuth = await fetchStorefrontPricingToken();
    const payload = {
      shopDomain: config.shopDomain,
      cartLines: cartLines,
      storefrontCustomerEmail: config.customerEmail || undefined,
      storefrontCustomerId: config.customerId ? String(config.customerId) : undefined,
      storefrontCustomerFirstName: config.customerFirstName || undefined,
      storefrontCustomerLastName: config.customerLastName || undefined,
      storefrontCustomerPhone: config.customerPhone || undefined,
      cartToken: cart.token,
      cartItemsSubtotalCents: cart.items_subtotal_price,
      cartTotalCents: cart.total_price,
      customAttributes: Object.assign(
        readB2BAttributes(cart.attributes || {}),
        {
          cartDiscountSnapshot: buildCartDiscountSnapshot(cart),
        },
        appliedCartDiscountCode(cart)
          ? { appliedDiscountCode: appliedCartDiscountCode(cart) }
          : {}
      ),
      sourceUrl: window.location.href,
    };
    if (pricingAuth && pricingAuth.pricingToken) {
      payload.storefrontPricingToken = pricingAuth.pricingToken;
    }

    const sessionRes = await fetch(
      config.checkoutApiUrl + "/api/public/checkout-sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!sessionRes.ok) {
      const err = await sessionRes.json().catch(function () {
        return {};
      });
      throw new Error(err.error || "Checkout session failed");
    }

    const data = await sessionRes.json();
    rememberCheckoutForCartClear(data.publicToken, cart.token);
    const url = data.checkoutUrl.startsWith("http")
      ? data.checkoutUrl
      : config.checkoutApiUrl + data.checkoutUrl;

    window.location.href = url;
  }

  function readB2BAttributes(cartAttributes) {
    var buyerType = cartAttributes.buyer_type || getFieldValue("buyer_type") || "individual";
    var paymentPreference =
      buyerType === "fop_company"
        ? "bank_invoice"
        : "card";
    return {
      buyer_type: buyerType,
      payment_preference: paymentPreference,
      fop_name: cartAttributes.fop_name || getFieldValue("fop_name") || "",
      fop_tax_id: cartAttributes.fop_tax_id || getFieldValue("fop_tax_id") || "",
      fop_legal_address:
        cartAttributes.fop_legal_address || getFieldValue("fop_legal_address") || "",
      docs_email: cartAttributes.docs_email || config.customerEmail || "",
      docs_phone: cartAttributes.docs_phone || config.customerPhone || "",
      accounting_comment:
        cartAttributes.accounting_comment || getFieldValue("accounting_comment") || "",
      customer_email: cartAttributes.customer_email || config.customerEmail || "",
      customer_first_name: cartAttributes.customer_first_name || config.customerFirstName || "",
      customer_last_name: cartAttributes.customer_last_name || config.customerLastName || "",
      customer_phone: cartAttributes.customer_phone || config.customerPhone || "",
    };
  }

  function getFieldValue(name) {
    var checked = document.querySelector('[data-kayer-b2b] [name="' + name + '"]:checked');
    if (checked) return checked.value;
    var field = document.querySelector('[data-kayer-b2b] [name="' + name + '"]');
    return field ? field.value : "";
  }

  function persistB2BAttributes() {
    var attrs = readB2BAttributes({});
    fetch(shopifyRoot() + "cart/update.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: attrs }),
    }).catch(function (err) {
      console.warn("[KayerCheckout] cart attributes save failed", err);
    });
  }

  function injectB2BBlock() {
    if (!config.showB2BBlock || !isAudienceEligible()) return;
    if (document.querySelector("[data-kayer-b2b]")) return;
    var target =
      document.querySelector("form[action='/cart']") ||
      document.querySelector("cart-drawer") ||
      document.querySelector(".cart-drawer") ||
      document.querySelector("[data-cart-drawer]");
    if (!target) return;

    var block = document.createElement("section");
    block.setAttribute("data-kayer-b2b", "true");
    block.style.cssText =
      "margin:16px 0;padding:16px;border:1px solid #d9d9d9;border-radius:8px;background:#fff;color:#111;";
    block.innerHTML =
      '<div style="font-weight:600;margin-bottom:8px;">Потрібен рахунок для ФОП або компанії?</div>' +
      '<p style="font-size:12px;line-height:1.45;color:#666;margin:0 0 10px;">Оберіть цей варіант, якщо потрібен рахунок і документи для бухгалтерії.</p>' +
      '<label style="display:block;margin:8px 0;"><input type="radio" name="buyer_type" value="individual" checked> Фізична особа</label>' +
      '<label style="display:block;margin:8px 0;"><input type="radio" name="buyer_type" value="fop_company"> ФОП або компанія</label>' +
      '<div data-kayer-fop-fields style="display:none;margin-top:12px;">' +
      '<input name="fop_name" placeholder="Назва компанії або ПІБ ФОП" minlength="3" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="fop_tax_id" inputmode="numeric" pattern="(?:[0-9]{8}|[0-9]{10})" placeholder="ЄДРПОУ або ІПН" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="fop_legal_address" placeholder="Юридична адреса" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="accounting_comment" placeholder="Коментар для бухгалтерії" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input type="hidden" name="payment_preference" value="bank_invoice">' +
      '<p style="font-size:12px;line-height:1.4;color:#555;margin:8px 0 0;">Рахунок і документи надішлемо на email з контактних даних. Оплата буде доступна за рахунком з підприємницького або корпоративного рахунку.</p>' +
      "</div>";

    target.insertBefore(block, target.firstChild);
    block.addEventListener("change", function () {
      var isFop = getFieldValue("buyer_type") === "fop_company";
      var fields = block.querySelector("[data-kayer-fop-fields]");
      fields.style.display = isFop ? "block" : "none";
      persistB2BAttributes();
    });
  }

  function bindButtons() {
    injectB2BBlock();
    if (!isAudienceEligible()) return;
    hardenNativeCheckoutTriggers();

    document
      .querySelectorAll(checkoutSelectors().join(", "))
      .forEach(function (btn) {
      if (btn.dataset.kayerBound) return;
      btn.dataset.kayerBound = "true";
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (btn.disabled !== undefined) btn.disabled = true;
        redirectToCheckout(btn).catch(function (err) {
          handleRedirectError(err, btn);
        });
      });
    });
  }

  function hardenNativeCheckoutTriggers() {
    if (!isAudienceEligible()) return;

    document.querySelectorAll(checkoutSelectors().join(", ")).forEach(function (trigger) {
      trigger.setAttribute("data-kayer-checkout", "true");
      trigger.setAttribute("data-kayer-native-disabled", "true");

      if (trigger.tagName === "A") {
        trigger.setAttribute("data-kayer-original-href", trigger.getAttribute("href") || "");
        trigger.setAttribute("href", "javascript:void(0)");
        trigger.removeAttribute("target");
      }

      if (trigger.matches("button, input")) {
        trigger.setAttribute("data-kayer-original-type", trigger.getAttribute("type") || "");
        trigger.setAttribute("type", "button");
      }

      if (trigger.getAttribute("name") === "checkout") {
        trigger.setAttribute("data-kayer-original-name", "checkout");
        trigger.removeAttribute("name");
      }

      trigger.onclick = function (event) {
        interceptCheckoutEvent(event);
        return false;
      };
    });

    document.querySelectorAll("form").forEach(function (form) {
      if (form.dataset.kayerFormHardened) return;
      var action = normalize(form.getAttribute("action"));
      var hasCheckoutTrigger = Boolean(form.querySelector(checkoutSelectors().join(", ")));
      if (action.indexOf("checkout") < 0 && !hasCheckoutTrigger) return;

      form.dataset.kayerFormHardened = "true";
      form.addEventListener("submit", interceptCheckoutSubmit, true);
    });
  }

  function interceptCheckoutEvent(event) {
    if (!isAudienceEligible()) return;
    var target = findLikelyCheckoutTrigger(event.target);
    if (!target) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (target.disabled !== undefined) target.disabled = true;
    redirectToCheckout(target).catch(function (err) {
      handleRedirectError(err, target);
    });
  }

  function interceptCheckoutSubmit(event) {
    if (!isAudienceEligible()) return;
    var form = event.target;
    if (!form || !form.matches || !form.matches("form")) return;
    var action = normalize(form.getAttribute("action"));
    var submitter = event.submitter || document.activeElement;
    var checkoutSubmitter = findLikelyCheckoutTrigger(submitter);
    var checkoutNamedSubmitter =
      submitter &&
      submitter.getAttribute &&
      (submitter.getAttribute("name") === "checkout" ||
        submitter.getAttribute("data-kayer-original-name") === "checkout");
    if (
      action.indexOf("checkout") < 0 &&
      !checkoutSubmitter &&
      !checkoutNamedSubmitter
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    var submitTrigger =
      checkoutSubmitter ||
      (checkoutNamedSubmitter ? submitter : null) ||
      findCheckoutTrigger(null);
    redirectToCheckout(submitTrigger).catch(function (err) {
      handleRedirectError(err, submitTrigger);
    });
  }

  function installForcedCheckoutGuards() {
    if (!isAudienceEligible() || window.__kayerForcedCheckoutGuardsInstalled) return;
    window.__kayerForcedCheckoutGuardsInstalled = true;

    ["pointerdown", "mousedown", "touchstart"].forEach(function (eventName) {
      window.addEventListener(eventName, interceptCheckoutEvent, true);
      document.addEventListener(eventName, interceptCheckoutEvent, true);
    });

    window.addEventListener(
      "keydown",
      function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        interceptCheckoutEvent(event);
      },
      true
    );

    if (!window.HTMLFormElement || window.__kayerNativeSubmitPatched) return;
    window.__kayerNativeSubmitPatched = true;
    var nativeSubmit = window.HTMLFormElement.prototype.submit;
    var nativeRequestSubmit = window.HTMLFormElement.prototype.requestSubmit;

    window.HTMLFormElement.prototype.submit = function () {
      if (isAudienceEligible() && looksLikeCheckoutElement(this)) {
        redirectToCheckout().catch(function (err) {
          handleRedirectError(err, null);
        });
        return;
      }
      return nativeSubmit.apply(this, arguments);
    };

    if (nativeRequestSubmit) {
      window.HTMLFormElement.prototype.requestSubmit = function (submitter) {
        var isCheckoutSubmitter = submitter && findLikelyCheckoutTrigger(submitter);
        var hasCheckoutTrigger = Boolean(this.querySelector(checkoutSelectors().join(", ")));
        if (
          isAudienceEligible() &&
          (isCheckoutSubmitter || looksLikeCheckoutElement(this) || hasCheckoutTrigger)
        ) {
          redirectToCheckout().catch(function (err) {
            handleRedirectError(err, null);
          });
          return;
        }
        return nativeRequestSubmit.apply(this, arguments);
      };
    }
  }

  // Capture checkout actions before theme handlers so KAYER remains the only checkout.
  window.addEventListener("click", interceptCheckoutEvent, true);
  document.addEventListener("click", interceptCheckoutEvent, true);
  window.addEventListener("submit", interceptCheckoutSubmit, true);
  document.addEventListener("submit", interceptCheckoutSubmit, true);
  clearCartIfRequested();
  clearCompletedCheckoutCart();
  installForcedCheckoutGuards();

  window.KayerCheckout = {
    redirectToCheckout: redirectToCheckout,
    beginCheckoutLoading: beginCheckoutLoading,
    endCheckoutLoading: endCheckoutLoading,
    config: config,
  };

  if (window.__kayerCheckoutQueued) {
    window.__kayerCheckoutQueued = false;
    var queuedTrigger = window.__kayerCheckoutQueuedTrigger || null;
    window.__kayerCheckoutQueuedTrigger = null;
    redirectToCheckout(queuedTrigger).catch(function (err) {
      handleRedirectError(err, queuedTrigger);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bindButtons();
    });
  } else {
    bindButtons();
  }

  // Re-bind for dynamic cart drawers
  var observer = new MutationObserver(bindButtons);
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(function () {
    if (isAudienceEligible()) hardenNativeCheckoutTriggers();
  }, 500);
})();
