type InvoiceEmailInput = {
  invoiceNumber: string;
  orderName?: string | null;
  paymentPurpose: string;
  pdfUrl?: string | null;
};

type DeliveryNoteEmailInput = {
  documentNumber?: string | null;
  orderName?: string | null;
  pdfUrl?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function emailShell(input: {
  preheader: string;
  title: string;
  intro: string;
  ctaLabel?: string;
  ctaUrl?: string | null;
  detailsHtml?: string;
  noteHtml?: string;
}) {
  const cta = input.ctaUrl
    ? `
      <tr>
        <td style="padding:0 32px 26px;">
          <a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;line-height:20px;padding:15px 24px;border-radius:999px;">
            ${escapeHtml(input.ctaLabel ?? "Відкрити документ")}
          </a>
        </td>
      </tr>
    `
    : "";

  return `<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;background:#f7f2ef;color:#191715;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(input.preheader)}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f2ef;padding:28px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #eadfd9;border-radius:22px;overflow:hidden;box-shadow:0 18px 50px rgba(33,24,20,0.08);">
            <tr>
              <td style="padding:30px 32px 12px;">
                <div style="font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:#9a7669;font-weight:700;">KAYER UA</div>
                <h1 style="margin:14px 0 10px;font-size:30px;line-height:1.15;color:#111111;font-weight:700;">${escapeHtml(input.title)}</h1>
                <p style="margin:0;color:#5f5752;font-size:16px;line-height:1.6;">${escapeHtml(input.intro)}</p>
              </td>
            </tr>
            ${cta}
            ${
              input.detailsHtml
                ? `<tr><td style="padding:0 32px 26px;">${input.detailsHtml}</td></tr>`
                : ""
            }
            ${
              input.noteHtml
                ? `<tr><td style="padding:0 32px 30px;">${input.noteHtml}</td></tr>`
                : ""
            }
            <tr>
              <td style="background:#fbf8f6;padding:20px 32px;color:#796f69;font-size:13px;line-height:1.6;">
                Якщо маєте питання щодо оплати або документів, напишіть нам у відповідь на цей лист.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function detailRow(label: string, value?: string | null) {
  if (!value) return "";
  return `
    <tr>
      <td style="padding:10px 0;color:#796f69;font-size:14px;">${escapeHtml(label)}</td>
      <td align="right" style="padding:10px 0;color:#111111;font-size:14px;font-weight:700;">${escapeHtml(value)}</td>
    </tr>
  `;
}

export function renderInvoiceEmailHtml(input: InvoiceEmailInput) {
  const details = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #efe5df;border-bottom:1px solid #efe5df;">
      ${detailRow("Рахунок", input.invoiceNumber)}
      ${detailRow("Замовлення", input.orderName)}
    </table>
    <div style="margin-top:18px;padding:16px 18px;border-radius:16px;background:#f7f2ef;border:1px solid #eadfd9;">
      <div style="font-size:13px;color:#796f69;margin-bottom:8px;">Призначення платежу</div>
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111111;font-weight:700;">${escapeHtml(input.paymentPurpose)}</div>
    </div>
  `;

  const note = `
    <div style="padding:18px;border-radius:16px;background:#fff8ee;border:1px solid #f0dfc5;color:#594b3b;font-size:14px;line-height:1.6;">
      Оплатіть рахунок з підприємницького або корпоративного рахунку. Після надходження коштів замовлення автоматично перейде в обробку.
    </div>
  `;

  return emailShell({
    preheader: `Рахунок ${input.invoiceNumber} готовий до оплати.`,
    title: `Рахунок ${input.invoiceNumber}`,
    intro: "Дякуємо за замовлення. Ми підготували рахунок для оплати від ФОП або компанії.",
    ctaLabel: "Завантажити рахунок PDF",
    ctaUrl: input.pdfUrl,
    detailsHtml: details,
    noteHtml: note,
  });
}

export function renderInvoiceEmailText(input: InvoiceEmailInput) {
  return [
    `KAYER UA`,
    `Рахунок ${input.invoiceNumber} готовий до оплати.`,
    input.orderName ? `Замовлення: ${input.orderName}` : "",
    `Призначення платежу: ${input.paymentPurpose}`,
    input.pdfUrl ? `Завантажити рахунок PDF: ${input.pdfUrl}` : "",
    "Оплатіть рахунок з підприємницького або корпоративного рахунку.",
    "Після надходження коштів замовлення автоматично перейде в обробку.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function renderDeliveryNoteEmailHtml(input: DeliveryNoteEmailInput) {
  const details = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #efe5df;border-bottom:1px solid #efe5df;">
      ${detailRow("Документ", input.documentNumber)}
      ${detailRow("Замовлення", input.orderName)}
    </table>
  `;

  return emailShell({
    preheader: "Оплату отримано, документи готові.",
    title: "Оплату отримано",
    intro: "Замовлення передано в обробку. Видаткову накладну можна відкрити за кнопкою нижче.",
    ctaLabel: "Відкрити накладну PDF",
    ctaUrl: input.pdfUrl,
    detailsHtml: details,
  });
}
