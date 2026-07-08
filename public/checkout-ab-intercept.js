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
  var FORCE_STORAGE_KEY = "kayer_force_checkout";
  var LEGACY_FORCE_STORAGE_KEY = "kayer_force_custom_checkout";

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

  function readUrlForceCheckout() {
    var params = new URLSearchParams(window.location.search);
    var force = params.get("force_checkout");
    if (force === "chekly" || force === "custom") return force;
    if (params.get(config.queryParam) === "1") return "custom";
    if (force === "shopify" || force === "native") return "shopify";
    return null;
  }

  function getStoredForceCheckout() {
    try {
      var raw = window.sessionStorage.getItem(FORCE_STORAGE_KEY);
      if (!raw && window.sessionStorage.getItem(LEGACY_FORCE_STORAGE_KEY) === "1") {
        return "custom";
      }
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || Date.now() - Number(parsed.ts || 0) > 2 * 60 * 60 * 1000) {
        window.sessionStorage.removeItem(FORCE_STORAGE_KEY);
        window.sessionStorage.removeItem(LEGACY_FORCE_STORAGE_KEY);
        return null;
      }
      return parsed.value === "custom" || parsed.value === "chekly" ? parsed.value : null;
    } catch {
      return null;
    }
  }

  function persistForceCheckoutFromUrl() {
    var force = readUrlForceCheckout();
    try {
      if (force === "shopify") {
        window.sessionStorage.removeItem(FORCE_STORAGE_KEY);
        window.sessionStorage.removeItem(LEGACY_FORCE_STORAGE_KEY);
        return;
      }
      if (force === "custom" || force === "chekly") {
        window.sessionStorage.setItem(
          FORCE_STORAGE_KEY,
          JSON.stringify({ value: force, ts: Date.now() })
        );
        if (force === "custom") {
          window.sessionStorage.setItem(LEGACY_FORCE_STORAGE_KEY, "1");
        } else {
          window.sessionStorage.removeItem(LEGACY_FORCE_STORAGE_KEY);
        }
      }
    } catch {}
  }

  function getForceCheckout() {
    var force = readUrlForceCheckout();
    if (force === "custom" || force === "chekly") return force;
    if (force === "shopify") return null;
    return getStoredForceCheckout();
  }

  function isAudienceEligible() {
    var force = getForceCheckout();
    if (force === "chekly" || force === "custom") return true;

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

  function looksLikeCheckoutElement(el) {
    if (!el) return false;
    var text = normalize(el.textContent || el.value || el.getAttribute("aria-label") || "");
    var href = normalize(el.getAttribute && el.getAttribute("href"));
    var action = normalize(el.getAttribute && el.getAttribute("action"));
    var formaction = normalize(el.getAttribute && el.getAttribute("formaction"));
    var className = normalize(el.className);
    var id = normalize(el.id);
    var name = normalize(el.getAttribute && el.getAttribute("name"));
    return (
      href.indexOf("checkout") >= 0 ||
      href.indexOf("chekly") >= 0 ||
      action.indexOf("checkout") >= 0 ||
      action.indexOf("chekly") >= 0 ||
      formaction.indexOf("checkout") >= 0 ||
      formaction.indexOf("chekly") >= 0 ||
      className.indexOf("checkout") >= 0 ||
      className.indexOf("chekly") >= 0 ||
      id.indexOf("checkout") >= 0 ||
      id.indexOf("chekly") >= 0 ||
      name === "checkout" ||
      text.indexOf("checkout") >= 0 ||
      text.indexOf("check out") >= 0 ||
      text.indexOf("оформити") >= 0 ||
      text.indexOf("оформлен") >= 0 ||
      text.indexOf("замовити") >= 0 ||
      text.indexOf("замовлення") >= 0 ||
      text.indexOf("оплат") >= 0 ||
      text.indexOf("сплат") >= 0
    );
  }

  function findLikelyCheckoutTrigger(el) {
    var explicit = isCheckoutElement(el);
    if (explicit) return explicit;
    var candidate = el && el.closest
      ? el.closest("button, a, input, [role='button'], [onclick]")
      : null;
    return looksLikeCheckoutElement(candidate) ? candidate : null;
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

  async function clearCartIfRequested() {
    var params = new URLSearchParams(window.location.search);
    if (params.get("kayer_clear_cart") !== "1") return;
    if (window.__kayerCartClearHandled) return;
    window.__kayerCartClearHandled = true;

    var root = shopifyRoot();
    try {
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
      removeCartClearParams();
    } catch (err) {
      console.warn("[CheckoutAB intercept] cart clear failed", err);
    }
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

  async function routeToCheckout() {
    if (window.__kayerCheckoutAbRouting) return;
    window.__kayerCheckoutAbRouting = true;
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

      var force = getForceCheckout();
      var routerUrl = config.routerUrl;
      if (force === "chekly" || force === "custom") {
        routerUrl +=
          (routerUrl.indexOf("?") >= 0 ? "&" : "?") +
          "force_checkout=" +
          encodeURIComponent(force);
      }

      window.location.href = appendUtmParams(routerUrl);
    } catch (err) {
      window.__kayerCheckoutAbRouting = false;
      console.error("[CheckoutAB intercept]", err);
      window.location.href = config.fallbackUrl;
    }
  }

  function interceptCheckoutEvent(event) {
    if (!isAudienceEligible()) return;
    var target = findLikelyCheckoutTrigger(event.target);
    if (!target && getForceCheckout() !== "custom") return;
    if (!target && !looksLikeCheckoutElement(event.target)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    routeToCheckout();
  }

  function interceptCheckoutSubmit(event) {
    if (!isAudienceEligible()) return;
    var form = event.target;
    if (!form || !form.matches || !form.matches("form")) return;
    var action = normalize(form.getAttribute("action"));
    var submitter = event.submitter || document.activeElement;
    var checkoutSubmitter = findLikelyCheckoutTrigger(submitter);
    var formHasCheckout = Boolean(form.querySelector(
      [
        'button[name="checkout"]',
        'input[name="checkout"]',
        "[data-kayer-checkout]",
        ".checkout-button",
        ".cart__checkout",
      ].join(", ")
    ));
    if (
      action.indexOf("checkout") < 0 &&
      action.indexOf("chekly") < 0 &&
      !checkoutSubmitter &&
      !formHasCheckout
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    routeToCheckout();
  }

  function bindDynamicUi() {
    injectB2BBlock();
  }

  persistForceCheckoutFromUrl();
  clearCartIfRequested();
  window.addEventListener("click", interceptCheckoutEvent, true);
  document.addEventListener("click", interceptCheckoutEvent, true);
  window.addEventListener("submit", interceptCheckoutSubmit, true);
  document.addEventListener("submit", interceptCheckoutSubmit, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindDynamicUi);
  } else {
    bindDynamicUi();
  }

  var observer = new MutationObserver(bindDynamicUi);
  observer.observe(document.body, { childList: true, subtree: true });
})();
