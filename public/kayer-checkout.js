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
      audienceMode: "all",
      customerTags: [],
      customerEmail: "",
      allowedCustomerTags: [],
      allowedCustomerEmails: [],
      queryParam: "custom_checkout",
      showB2BBlock: true,
    },
    window.KAYER_CHECKOUT_CONFIG || {}
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
    var params = new URLSearchParams(window.location.search);
    if (params.get(config.queryParam) === "1") return true;
    if (params.get("force_checkout") === "custom") return true;
    if (params.get("force_checkout") === "shopify") return false;

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

  function findCheckoutElement(el) {
    if (!el || !el.closest) return null;
    return el.closest(
      [
        "[data-kayer-checkout]",
        "[data-chekly]",
        "[data-chekly-checkout]",
        "[data-checkout]",
        "[formaction*='checkout']",
        'button[name="checkout"]',
        'input[name="checkout"]',
        'input[type="submit"][name="checkout"]',
        'a[href="/checkout"]',
        'a[href$="/checkout"]',
        'a[href*="/checkout"]',
        'a[href*="/checkouts/"]',
        'a[href*="checkout"]',
        'a[href*="chekly-app.com"]',
        'button[class*="checkout"]',
        'a[class*="checkout"]',
        'button[class*="chekly"]',
        'a[class*="chekly"]',
        '[role="button"][class*="checkout"]',
        '[role="button"][aria-label*="checkout"]',
        ".checkout-button",
        ".cart__checkout",
        ".btn--checkout",
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
      "[data-chekly]",
      "[data-chekly-checkout]",
      "[data-checkout]",
      "[formaction*='checkout']",
      'button[name="checkout"]',
      'input[name="checkout"]',
      'input[type="submit"][name="checkout"]',
      'a[href="/checkout"]',
      'a[href$="/checkout"]',
      'a[href*="/checkout"]',
      'a[href*="/checkouts/"]',
      'a[href*="checkout"]',
      'a[href*="chekly-app.com"]',
      'button[class*="checkout"]',
      'a[class*="checkout"]',
      'button[class*="chekly"]',
      'a[class*="chekly"]',
      '[role="button"][class*="checkout"]',
      '[role="button"][aria-label*="checkout"]',
      ".checkout-button",
      ".cart__checkout",
      ".btn--checkout",
    ];
  }

  function isForcedCustomCheckout() {
    var params = new URLSearchParams(window.location.search);
    return params.get(config.queryParam) === "1" || params.get("force_checkout") === "custom";
  }

  function shopifyRoot() {
    var root =
      (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    return root.endsWith("/") ? root : root + "/";
  }

  function eventPath(event) {
    if (event && typeof event.composedPath === "function") return event.composedPath();
    var path = [];
    var node = event && event.target;
    while (node) {
      path.push(node);
      node = node.parentNode;
    }
    return path;
  }

  function eventLooksLikeCheckout(event) {
    var path = eventPath(event);
    for (var i = 0; i < path.length; i += 1) {
      var el = path[i];
      if (!el || el === window || el === document) continue;
      if (findLikelyCheckoutTrigger(el)) return true;
      if (el.matches && el.matches("form") && looksLikeCheckoutElement(el)) return true;
    }
    return false;
  }

  function handleRedirectError(err, trigger) {
    window.__kayerRedirectInProgress = false;
    console.error("[KayerCheckout]", err);
    if (trigger && trigger.disabled !== undefined) trigger.disabled = false;
    if (isForcedCustomCheckout()) {
      alert("Не вдалося відкрити checkout KAYER. Оновіть кошик і спробуйте ще раз.");
      return;
    }
    window.location.href = config.fallbackUrl;
  }

  async function redirectToCheckout() {
    if (window.__kayerRedirectInProgress) return;
    window.__kayerRedirectInProgress = true;

    const root = shopifyRoot();
    const cartRes = await fetch(root + "cart.js", { credentials: "same-origin" });
    if (!cartRes.ok) throw new Error("Failed to load cart");
    const cart = await cartRes.json();

    if (!cart.items || cart.items.length === 0) {
      window.location.href = root + "cart";
      return;
    }

    const cartLines = cart.items.map(function (item) {
      return {
        variantGid: "gid://shopify/ProductVariant/" + item.variant_id,
        quantity: item.quantity,
      };
    });

    const sessionRes = await fetch(
      config.checkoutApiUrl + "/api/public/checkout-sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopDomain: config.shopDomain,
          cartLines: cartLines,
          customAttributes: readB2BAttributes(cart.attributes || {}),
          sourceUrl: window.location.href,
        }),
      }
    );

    if (!sessionRes.ok) {
      const err = await sessionRes.json().catch(function () {
        return {};
      });
      throw new Error(err.error || "Checkout session failed");
    }

    const data = await sessionRes.json();
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
      docs_email: cartAttributes.docs_email || getFieldValue("docs_email") || "",
      docs_phone: cartAttributes.docs_phone || getFieldValue("docs_phone") || "",
      accounting_comment:
        cartAttributes.accounting_comment || getFieldValue("accounting_comment") || "",
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
      '<p style="font-size:12px;line-height:1.4;color:#555;margin:8px 0 0;">Для покупок від ФОП або компанії доступна оплата тільки за рахунком з підприємницького/юридичного рахунку. Так ми зможемо автоматично підготувати документи для бухгалтерії.</p>' +
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
        redirectToCheckout().catch(function (err) {
          handleRedirectError(err, btn);
        });
      });
    });
  }

  function hardenNativeCheckoutTriggers() {
    if (!isForcedCustomCheckout()) return;

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
      if (action.indexOf("checkout") < 0 && action.indexOf("chekly") < 0 && !hasCheckoutTrigger) return;

      form.dataset.kayerFormHardened = "true";
      form.addEventListener("submit", interceptCheckoutSubmit, true);
    });
  }

  function interceptCheckoutEvent(event) {
    if (!isAudienceEligible()) return;
    var target = findLikelyCheckoutTrigger(event.target);
    if (!target && (!isForcedCustomCheckout() || !eventLooksLikeCheckout(event))) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (target.disabled !== undefined) target.disabled = true;
    redirectToCheckout().catch(function (err) {
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
    if (
      action.indexOf("checkout") < 0 &&
      action.indexOf("chekly") < 0 &&
      !checkoutSubmitter
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    redirectToCheckout().catch(function (err) {
      handleRedirectError(err, null);
    });
  }

  function installForcedCheckoutGuards() {
    if (!isForcedCustomCheckout() || window.__kayerForcedCheckoutGuardsInstalled) return;
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
      if (isAudienceEligible() && isForcedCustomCheckout() && looksLikeCheckoutElement(this)) {
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
          isForcedCustomCheckout() &&
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

  function shouldAutoOpenForcedCheckout() {
    var params = new URLSearchParams(window.location.search);
    var explicitlyForced =
      params.get(config.queryParam) === "1" ||
      params.get("force_checkout") === "custom";
    if (!explicitlyForced) return false;
    if (params.get("kayer_no_auto") === "1") return false;
    return window.location.pathname.indexOf("/cart") >= 0;
  }

  function scheduleForcedAutoOpen() {
    if (!shouldAutoOpenForcedCheckout() || window.__kayerForcedAutoOpenScheduled) return;
    window.__kayerForcedAutoOpenScheduled = true;

    window.setTimeout(function () {
      redirectToCheckout().catch(function (err) {
        handleRedirectError(err, null);
      });
    }, 180);
  }

  // Chekly is loaded earlier in the Shopify theme. Window-level capture runs before
  // document/body capture handlers, so forced KAYER checkout can still win.
  window.addEventListener("click", interceptCheckoutEvent, true);
  document.addEventListener("click", interceptCheckoutEvent, true);
  window.addEventListener("submit", interceptCheckoutSubmit, true);
  document.addEventListener("submit", interceptCheckoutSubmit, true);
  installForcedCheckoutGuards();
  scheduleForcedAutoOpen();

  window.KayerCheckout = { redirectToCheckout: redirectToCheckout, config: config };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bindButtons();
      scheduleForcedAutoOpen();
    });
  } else {
    bindButtons();
    scheduleForcedAutoOpen();
  }

  // Re-bind for dynamic cart drawers
  var observer = new MutationObserver(bindButtons);
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(function () {
    if (isAudienceEligible()) hardenNativeCheckoutTriggers();
  }, 500);
})();
