/**
 * KAYER A/B checkout router — intercepts Shopify checkout buttons.
 * Routes to /apps/checkout-ab (Shopify App Proxy) for Chekly vs custom split.
 *
 * theme.liquid before </body>:
 * <script src="https://checkout.kayer.ua/checkout-ab-intercept.js" defer></script>
 */
(function () {
  var config = Object.assign(
    {
      routerUrl: "/apps/checkout-ab",
      fallbackUrl: "/checkout",
      audienceMode: "all",
      customerTags: [],
      customerEmail: "",
      allowedCustomerTags: [],
      allowedCustomerEmails: [],
      queryParam: "custom_checkout",
      showB2BBlock: true,
    },
    window.KAYER_CHECKOUT_AB_CONFIG || {}
  );

  function asList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value) {
      return value.split(",").map(function (item) {
        return item.trim();
      });
    }
    return [];
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function hasIntersection(left, right) {
    var normalizedRight = asList(right).map(normalize);
    return asList(left).some(function (item) {
      return normalizedRight.indexOf(normalize(item)) >= 0;
    });
  }

  function isAudienceEligible() {
    var force = new URLSearchParams(window.location.search).get("force_checkout");
    if (force === "chekly" || force === "custom") return true;
    if (new URLSearchParams(window.location.search).get(config.queryParam) === "1") return true;

    if (config.audienceMode === "disabled") return false;
    if (config.audienceMode === "all") return true;
    if (config.audienceMode === "query_param") return false;

    var tagMatch = hasIntersection(config.customerTags, config.allowedCustomerTags);
    var emailMatch =
      asList(config.allowedCustomerEmails).map(normalize).indexOf(normalize(config.customerEmail)) >= 0;

    if (config.audienceMode === "customer_tags") return tagMatch;
    if (config.audienceMode === "customer_emails") return emailMatch;
    if (config.audienceMode === "customer_tags_or_emails") return tagMatch || emailMatch;

    return true;
  }

  function isCheckoutElement(el) {
    if (!el || !el.closest) return null;
    return el.closest(
      [
        'button[name="checkout"]',
        'input[name="checkout"]',
        'a[href="/checkout"]',
        'a[href$="/checkout"]',
        ".checkout-button",
        ".cart__checkout",
        "[data-kayer-checkout]",
      ].join(", ")
    );
  }

  function appendUtmParams(url) {
    var params = new URLSearchParams(window.location.search);
    var utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
    var hasUtm = false;
    utmKeys.forEach(function (key) {
      if (params.get(key)) hasUtm = true;
    });
    if (!hasUtm) return url;

    var target = new URL(url, window.location.origin);
    utmKeys.forEach(function (key) {
      var val = params.get(key);
      if (val) target.searchParams.set(key, val);
    });
    return target.pathname + target.search;
  }

  function getFieldValue(name) {
    var checked = document.querySelector('[data-kayer-b2b] [name="' + name + '"]:checked');
    if (checked) return checked.value;
    var field = document.querySelector('[data-kayer-b2b] [name="' + name + '"]');
    return field ? field.value : "";
  }

  function readB2BAttributes(cartAttributes) {
    cartAttributes = cartAttributes || {};
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
      docs_email: cartAttributes.docs_email || getFieldValue("docs_email") || "",
      docs_phone: cartAttributes.docs_phone || getFieldValue("docs_phone") || "",
      accounting_comment:
        cartAttributes.accounting_comment || getFieldValue("accounting_comment") || "",
    };
  }

  function persistB2BAttributes() {
    var attrs = readB2BAttributes({});
    fetch("/cart/update.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: attrs }),
    }).catch(function (err) {
      console.warn("[CheckoutAB intercept] cart attributes save failed", err);
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
      '<div style="font-weight:600;margin-bottom:8px;">Покупаєте як ФОП або компанія?</div>' +
      '<label style="display:block;margin:8px 0;"><input type="radio" name="buyer_type" value="individual" checked> Фізична особа</label>' +
      '<label style="display:block;margin:8px 0;"><input type="radio" name="buyer_type" value="fop_company"> ФОП / юридична особа</label>' +
      '<div data-kayer-fop-fields style="display:none;margin-top:12px;">' +
      '<input name="fop_name" placeholder="Назва компанії / ПІБ ФОП" minlength="3" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="fop_tax_id" inputmode="numeric" pattern="(?:[0-9]{8}|[0-9]{10})" placeholder="ЄДРПОУ / ІПН" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="docs_email" type="email" placeholder="Email для документів" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="docs_phone" type="tel" placeholder="Телефон" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="fop_legal_address" placeholder="Юридична адреса" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="accounting_comment" placeholder="Коментар для бухгалтерії" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input type="hidden" name="payment_preference" value="bank_invoice">' +
      '<p style="font-size:12px;line-height:1.4;color:#555;margin:8px 0 0;">Для покупок від ФОП або компанії доступна оплата тільки за рахунком з підприємницького/юридичного рахунку.</p>' +
      "</div>";

    target.insertBefore(block, target.firstChild);
    block.addEventListener("change", function () {
      var isFop = getFieldValue("buyer_type") === "fop_company";
      var fields = block.querySelector("[data-kayer-fop-fields]");
      fields.style.display = isFop ? "block" : "none";
      persistB2BAttributes();
    });
  }

  document.addEventListener(
    "click",
    async function (event) {
      if (!isAudienceEligible()) return;
      var target = isCheckoutElement(event.target);
      if (!target) return;

      event.preventDefault();
      event.stopPropagation();

      try {
        var root =
          (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
        var cartRes = await fetch(root + "cart.js", { credentials: "same-origin" });
        if (!cartRes.ok) throw new Error("cart_load_failed");
        var cart = await cartRes.json();

        if (!cart || !cart.items || cart.items.length === 0) {
          window.location.href = root + "cart";
          return;
        }

        await fetch(root + "cart/update.js", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attributes: readB2BAttributes(cart.attributes || {}) }),
        }).catch(function () {});

        var force = new URLSearchParams(window.location.search).get("force_checkout");
        var routerUrl = config.routerUrl;
        if (force === "chekly" || force === "custom") {
          routerUrl +=
            (routerUrl.indexOf("?") >= 0 ? "&" : "?") +
            "force_checkout=" +
            encodeURIComponent(force);
        }

        window.location.href = appendUtmParams(routerUrl);
      } catch (err) {
        console.error("[CheckoutAB intercept]", err);
        window.location.href = config.fallbackUrl;
      }
    },
    true
  );

  function bindDynamicUi() {
    injectB2BBlock();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindDynamicUi);
  } else {
    bindDynamicUi();
  }

  var observer = new MutationObserver(bindDynamicUi);
  observer.observe(document.body, { childList: true, subtree: true });
})();
