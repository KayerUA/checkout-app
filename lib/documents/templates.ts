import { getEnv } from "@/lib/env";
import type { B2BDocumentInput } from "@/lib/b2b/types";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency,
  }).format(amount);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("uk-UA").format(date);
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function invoicePaymentPurpose(invoiceNumber: string, invoiceDate: Date, orderName?: string | null) {
  const order = formatOrderNumber(orderName);
  return `Оплата за рахунком ${invoiceNumber} від ${formatDate(invoiceDate)}, замовлення Shopify #${order}, без ПДВ`.trim();
}

function formatOrderNumber(orderName?: string | null) {
  return (orderName ?? "").replace(/^#/, "") || "—";
}

function formatQuantity(quantity: number) {
  return `${quantity} шт`;
}

function moneyNumber(amount: number) {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

const ones = [
  "",
  "одна",
  "дві",
  "три",
  "чотири",
  "п'ять",
  "шість",
  "сім",
  "вісім",
  "дев'ять",
];
const teens = [
  "десять",
  "одинадцять",
  "дванадцять",
  "тринадцять",
  "чотирнадцять",
  "п'ятнадцять",
  "шістнадцять",
  "сімнадцять",
  "вісімнадцять",
  "дев'ятнадцять",
];
const tens = ["", "", "двадцять", "тридцять", "сорок", "п'ятдесят", "шістдесят", "сімдесят", "вісімдесят", "дев'яносто"];
const hundreds = ["", "сто", "двісті", "триста", "чотириста", "п'ятсот", "шістсот", "сімсот", "вісімсот", "дев'ятсот"];

function smallNumberToWords(value: number) {
  const parts: string[] = [];
  parts.push(hundreds[Math.floor(value / 100)]);
  const rest = value % 100;
  if (rest >= 10 && rest < 20) {
    parts.push(teens[rest - 10]);
  } else {
    parts.push(tens[Math.floor(rest / 10)]);
    parts.push(ones[rest % 10]);
  }
  return parts.filter(Boolean).join(" ");
}

function amountInWords(amount: number) {
  const hryvnias = Math.floor(amount);
  const kopiyky = Math.round((amount - hryvnias) * 100);
  const thousands = Math.floor(hryvnias / 1000);
  const rest = hryvnias % 1000;
  const words = [
    thousands ? `${smallNumberToWords(thousands)} тисячі` : "",
    rest ? smallNumberToWords(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
  const sentence = words || "нуль";
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} гривень ${String(kopiyky).padStart(2, "0")} копійок`;
}

export function renderInvoiceHtml(input: B2BDocumentInput) {
  const env = getEnv();
  const orderNumber = formatOrderNumber(input.shopifyOrderName);
  const sellerName = env.SELLER_NAME || "ФОП Стаднік Людмила Миколаївна";
  const sellerTaxId = env.SELLER_TAX_ID || "2341822588";
  const sellerIban = env.SELLER_IBAN || "UA273052990000026005035040022";
  const sellerBank = env.SELLER_BANK_NAME || "АТ КБ \"ПРИВАТБАНК\", м.Київ";
  const sellerAddress = env.SELLER_LEGAL_ADDRESS || "04074, м. Київ, вул Автозаводська 7, кв 5";
  const sellerSignatureName = env.SELLER_SIGNATURE_NAME || "Стаднік Л.М.";

  const rows = input.lines
    .map((line, index) => {
      const unit = Number(line.price_set?.shop_money?.amount ?? line.price ?? 0);
      const qty = Number(line.quantity);
      return `
        <tr>
          <td class="num">${index + 1}</td>
          <td>${escapeHtml(line.title)}</td>
          <td class="center">${formatQuantity(qty)}</td>
          <td class="money">${moneyNumber(unit)}</td>
          <td class="money">${moneyNumber(unit * qty)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <html lang="uk">
      <head>
        <meta charset="utf-8" />
        <title>Рахунок ${escapeHtml(input.invoiceNumber)}</title>
        <style>
          @page { size: A4; margin: 18mm 16mm; }
          body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
          .notice { border: 1.5px solid #111; padding: 7px 10px; text-align: center; font-weight: 700; line-height: 1.25; }
          .sample-title { text-align: center; font-size: 15px; font-weight: 700; margin: 10px 0 4px; }
          .payment-box { border: 1.5px solid #111; padding: 18px 38px 20px; margin-bottom: 28px; }
          .payment-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; align-items: end; }
          .label { display: inline-block; width: 90px; font-weight: 400; }
          .strong { font-weight: 700; }
          .boxed { display: inline-block; min-width: 150px; border: 1.5px solid #111; padding: 4px 18px; text-align: center; font-weight: 700; }
          .underline { display: inline-block; min-width: 220px; border-bottom: 1.5px solid #111; padding-bottom: 4px; font-weight: 700; }
          .iban-box { border: 1.5px solid #111; padding: 6px 20px; text-align: center; font-weight: 700; }
          h1 { font-size: 20px; margin: 0 0 14px; padding-bottom: 4px; border-bottom: 3px solid #111; }
          .details { width: 100%; margin-bottom: 12px; }
          .details td { border: 0; padding: 3px 4px; vertical-align: top; }
          .details .caption { width: 125px; font-weight: 700; text-decoration: underline; }
          table.goods { border-collapse: collapse; width: 100%; font-size: 11px; }
          .goods th, .goods td { border: 1.5px solid #111; padding: 4px 6px; }
          .goods th { background: #eee; text-align: center; font-size: 12px; }
          .num { width: 34px; text-align: center; }
          .center { text-align: center; white-space: nowrap; }
          .money { text-align: right; white-space: nowrap; }
          .total-row { display: grid; grid-template-columns: 1fr 170px; gap: 16px; margin: 10px 4px 14px; font-size: 14px; font-weight: 700; }
          .total-label { text-align: right; }
          .words { margin-top: 4px; font-weight: 700; font-size: 14px; }
          .line { border-top: 3px solid #111; margin: 12px 0 18px; }
          .signature { display: grid; grid-template-columns: 1fr 300px; gap: 40px; align-items: end; margin-top: 18px; }
          .stamp { justify-self: center; width: 120px; height: 120px; border: 2px solid #1d4ed8; border-radius: 50%; color: #1d4ed8; display: flex; align-items: center; justify-content: center; text-align: center; font-weight: 700; transform: rotate(-8deg); opacity: .85; }
          .sig-line { border-bottom: 1.5px solid #111; padding-bottom: 4px; text-align: center; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="notice">
          Увага! Оплата цього рахунку означає погодження з умовами поставки товарів.
          В призначенні платежу обов'язково вкажіть номер замовлення.
          Товар відпускається за фактом надходження коштів на п/р Постачальника.
        </div>

        <div class="sample-title">Зразок заповнення платіжного доручення</div>
        <div class="payment-box">
          <div class="payment-grid">
            <div>
              <p><span class="label">Отримувач</span> <span class="strong">${escapeHtml(sellerName)}</span></p>
              <p><span class="label">Код</span> <span class="boxed">${escapeHtml(sellerTaxId)}</span></p>
              <p><span class="label">Банк отримувача</span></p>
              <p><span class="underline">${escapeHtml(sellerBank)}</span></p>
            </div>
            <div>
              <p class="center strong">КРЕДИТ рах. №</p>
              <div class="iban-box">${escapeHtml(sellerIban)}</div>
            </div>
          </div>
        </div>

        <h1>Рахунок на оплату по замовленню № ${escapeHtml(orderNumber)} від ${formatLongDate(input.invoiceDate)} р.</h1>

        <table class="details">
          <tbody>
            <tr>
              <td class="caption">Постачальник:</td>
              <td>
                <strong>${escapeHtml(sellerName)}</strong><br />
                п/р ${escapeHtml(sellerIban)} у банку ${escapeHtml(sellerBank)}<br />
                ${escapeHtml(sellerAddress)}<br />
                код за ДРФО ${escapeHtml(sellerTaxId)}, ІПН ${escapeHtml(sellerTaxId)}
              </td>
            </tr>
            <tr>
              <td class="caption">Покупець:</td>
              <td>
                <strong>${escapeHtml(input.buyer.fop_name)}</strong><br />
                Код ЄДРПОУ/ІПН: ${escapeHtml(input.buyer.fop_tax_id)}<br />
                ${input.buyer.docs_phone ? `Тел.: ${escapeHtml(input.buyer.docs_phone)}<br />` : ""}
                ${input.buyer.docs_email ? `E-mail: ${escapeHtml(input.buyer.docs_email)}` : ""}
              </td>
            </tr>
            <tr>
              <td class="caption">Договір:</td>
              <td><strong>Основний договір</strong></td>
            </tr>
          </tbody>
        </table>

        <table class="goods">
          <thead>
            <tr><th>№</th><th>Товар</th><th>Кількість</th><th>Ціна</th><th>Сума</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="total-row">
          <div class="total-label">Разом:</div>
          <div class="money">${moneyNumber(input.amount)}</div>
        </div>

        <p>Всього найменувань ${input.lines.length}, на суму ${moneyNumber(input.amount)} грн.</p>
        <p class="words">${amountInWords(input.amount)}</p>
        <p><strong>Призначення платежу:</strong> ${escapeHtml(input.paymentPurpose)}</p>
        <div class="line"></div>

        <div class="signature">
          <div class="stamp">М.П.<br />${escapeHtml(sellerName)}</div>
          <div>
            <div class="sig-line">${escapeHtml(sellerSignatureName)}</div>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function renderDeliveryNoteHtml(input: B2BDocumentInput) {
  return `
    <html lang="uk">
      <head><meta charset="utf-8" /><title>Видаткова накладна ${escapeHtml(input.invoiceNumber)}</title></head>
      <body>
        <h1>Видаткова накладна до рахунку ${escapeHtml(input.invoiceNumber)}</h1>
        <p>Дата: ${formatDate(new Date())}</p>
        <p>Покупець: ${escapeHtml(input.buyer.fop_name)}</p>
        <p>ЄДРПОУ / РНОКПП: ${escapeHtml(input.buyer.fop_tax_id)}</p>
        <p>Замовлення: ${escapeHtml(input.shopifyOrderName)}</p>
        <p>Сума: ${formatMoney(input.amount, input.currency)}</p>
        <p>Документ створено автоматично після підтвердження банківської оплати.</p>
      </body>
    </html>
  `;
}
