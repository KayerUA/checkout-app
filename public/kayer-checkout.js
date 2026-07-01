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
    },
    window.KAYER_CHECKOUT_CONFIG || {}
  );

  async function redirectToCheckout() {
    const cartRes = await fetch("/cart.js", { credentials: "same-origin" });
    if (!cartRes.ok) throw new Error("Failed to load cart");
    const cart = await cartRes.json();

    if (!cart.items || cart.items.length === 0) {
      window.location.href = "/cart";
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
        ? cartAttributes.payment_preference || getFieldValue("payment_preference") || "bank_invoice"
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
    fetch("/cart/update.js", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: attrs }),
    }).catch(function (err) {
      console.warn("[KayerCheckout] cart attributes save failed", err);
    });
  }

  function injectB2BBlock() {
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
      '<label style="display:block;margin:8px 0;"><input type="radio" name="buyer_type" value="fop_company"> ФОП / компанія</label>' +
      '<div data-kayer-fop-fields style="display:none;margin-top:12px;">' +
      '<input name="fop_name" placeholder="Назва / ПІБ ФОП" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="fop_tax_id" placeholder="ЄДРПОУ / РНОКПП" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="docs_email" type="email" placeholder="Email для документів" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="docs_phone" type="tel" placeholder="Телефон" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="fop_legal_address" placeholder="Юридична адреса" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<input name="accounting_comment" placeholder="Коментар для бухгалтерії" style="box-sizing:border-box;width:100%;margin:6px 0;padding:10px;border:1px solid #ccc;border-radius:6px;">' +
      '<label style="display:block;margin:8px 0;"><input type="radio" name="payment_preference" value="bank_invoice" checked> Оплата за рахунком</label>' +
      '<label style="display:block;margin:8px 0;"><input type="radio" name="payment_preference" value="card"> Оплата карткою</label>' +
      '<p style="font-size:12px;line-height:1.4;color:#555;margin:8px 0 0;">Для покупок від ФОП або компанії рекомендуємо оплату за рахунком з підприємницького/юридичного рахунку. Так ми зможемо автоматично підготувати документи для бухгалтерії.</p>' +
      '<p data-kayer-card-warning style="display:none;font-size:12px;line-height:1.4;color:#8a5a00;margin:8px 0 0;">Оплата карткою підходить для швидкої покупки. Якщо вам потрібна оплата саме від ФОП/компанії — оберіть оплату за рахунком.</p>' +
      "</div>";

    target.insertBefore(block, target.firstChild);
    block.addEventListener("change", function () {
      var isFop = getFieldValue("buyer_type") === "fop_company";
      var fields = block.querySelector("[data-kayer-fop-fields]");
      var warning = block.querySelector("[data-kayer-card-warning]");
      fields.style.display = isFop ? "block" : "none";
      if (!isFop) {
        var card = block.querySelector('[name="payment_preference"][value="card"]');
        if (card) card.checked = true;
      }
      warning.style.display = isFop && getFieldValue("payment_preference") === "card" ? "block" : "none";
      persistB2BAttributes();
    });
  }

  function bindButtons() {
    injectB2BBlock();
    document.querySelectorAll("[data-kayer-checkout]").forEach(function (btn) {
      if (btn.dataset.kayerBound) return;
      btn.dataset.kayerBound = "true";
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        btn.disabled = true;
        redirectToCheckout().catch(function (err) {
          console.error("[KayerCheckout]", err);
          btn.disabled = false;
          alert("Не вдалося перейти до оформлення. Спробуйте ще раз.");
        });
      });
    });
  }

  window.KayerCheckout = { redirectToCheckout: redirectToCheckout, config: config };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindButtons);
  } else {
    bindButtons();
  }

  // Re-bind for dynamic cart drawers
  var observer = new MutationObserver(bindButtons);
  observer.observe(document.body, { childList: true, subtree: true });
})();
