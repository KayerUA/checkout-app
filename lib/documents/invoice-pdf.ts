import fs from "node:fs";
import path from "node:path";
import { getEnv } from "@/lib/env";
import type { B2BDocumentInput } from "@/lib/b2b/types";

// pdfkit does not publish TypeScript declarations. Use the standalone build so
// serverless deployments do not need pdfkit's AFM files at runtime.
// @ts-expect-error Missing pdfkit declarations.
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";

function resolveUnicodeFontPath() {
  const candidates = [
    process.env.PDF_UNICODE_FONT_PATH,
    path.join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ].filter(Boolean) as string[];

  return candidates.find((fontPath) => fs.existsSync(fontPath));
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function moneyNumber(amount: number) {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function lineUnitPrice(line: B2BDocumentInput["lines"][number]) {
  return Number(line.price_set?.shop_money?.amount ?? line.price ?? 0);
}

function formatOrderNumber(orderName?: string | null) {
  return (orderName ?? "").replace(/^#/, "") || "-";
}

function smallAmountInWords(amount: number) {
  const rounded = Math.floor(amount);
  const kopiyky = Math.round((amount - rounded) * 100);
  return `${moneyNumber(rounded)} гривень ${String(kopiyky).padStart(2, "0")} копійок`;
}

type PdfStream = {
  on(event: "data", listener: (chunk: Buffer) => void): PdfStream;
  on(event: "end", listener: () => void): PdfStream;
  on(event: "error", listener: (error: Error) => void): PdfStream;
  end(): void;
};

function collectPdf(doc: PdfStream) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function fitTextToHeight(
  doc: {
    heightOfString(value: string, options: { width: number; lineGap?: number }): number;
  },
  value: string,
  width: number,
  maxHeight: number,
  lineGap = 1
) {
  const normalized = value.trim() || "—";
  if (doc.heightOfString(normalized, { width, lineGap }) <= maxHeight) return normalized;

  let low = 1;
  let high = normalized.length;
  let fitted = "…";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${normalized.slice(0, middle).trimEnd()}…`;
    if (doc.heightOfString(candidate, { width, lineGap }) <= maxHeight) {
      fitted = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return fitted;
}

export async function createInvoicePdf(input: B2BDocumentInput) {
  const env = getEnv();
  const sellerName = env.SELLER_NAME || "ФОП Стаднік Людмила Миколаївна";
  const sellerTaxId = env.SELLER_TAX_ID || "2341822588";
  const sellerIban = env.SELLER_IBAN || "UA273052990000026005035040022";
  const sellerBank = env.SELLER_BANK_NAME || 'АТ КБ "ПРИВАТБАНК", м.Київ';
  const sellerAddress = env.SELLER_LEGAL_ADDRESS || "04074, м. Київ, вул Автозаводська 7, кв 5";
  const orderNumber = formatOrderNumber(input.shopifyOrderName);
  const invoiceDate =
    input.invoiceDate instanceof Date
      ? input.invoiceDate
      : new Date(input.invoiceDate as unknown as string);

  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
    compress: false,
    info: { Title: `Рахунок ${input.invoiceNumber}` },
  });

  const fontPath = resolveUnicodeFontPath();
  if (fontPath) doc.font(fs.readFileSync(fontPath));
  doc.fontSize(9).fillColor("#111111");

  const pageWidth = 595.28;
  const left = 42;
  const right = pageWidth - 42;
  const width = right - left;
  const pageBottom = 800;
  let y = 38;

  doc.lineWidth(1.1).rect(left + 30, y, width - 60, 42).stroke();
  doc.fontSize(8.2).text(
    "Увага! Оплата цього рахунку означає погодження з умовами поставки товарів. У призначенні платежу обов'язково вкажіть номер замовлення. Товар відпускається за фактом надходження коштів на п/р Постачальника.",
    left + 38,
    y + 6,
    { width: width - 76, align: "center", lineGap: 1 }
  );
  y += 56;

  doc.fontSize(11).text("Зразок заповнення платіжного доручення", left, y, {
    width,
    align: "center",
  });
  y += 16;

  doc.rect(left + 30, y, width - 30, 84).stroke();
  doc.fontSize(8.5);
  doc.text("Отримувач", left + 72, y + 19);
  doc.fontSize(8.8).text(sellerName, left + 126, y + 19, { width: 210 });
  doc.fontSize(8.5).text("Код", left + 72, y + 37);
  doc.rect(left + 126, y + 32, 112, 16).stroke();
  doc.fontSize(8.8).text(sellerTaxId, left + 126, y + 36, { width: 112, align: "center" });
  doc.fontSize(8.5).text("Банк отримувача", left + 72, y + 55);
  doc.fontSize(8.8).text(sellerBank, left + 72, y + 70, { width: 220 });
  doc.moveTo(left + 72, y + 80).lineTo(left + 240, y + 80).stroke();
  doc.fontSize(8.5).text("КРЕДИТ рах. №", left + 330, y + 52, { width: 150, align: "center" });
  doc.rect(left + 300, y + 64, 205, 16).stroke();
  doc.fontSize(8.4).text(sellerIban, left + 300, y + 68, { width: 205, align: "center" });
  y += 112;

  const heading =
    `Рахунок на оплату по замовленню № ${orderNumber} від ${formatLongDate(invoiceDate)} р.`;
  doc.fontSize(14.5);
  const headingHeight = doc.heightOfString(heading, { width });
  doc.text(heading, left, y, { width });
  y += headingHeight + 5;
  doc.lineWidth(1.8).moveTo(left, y).lineTo(right, y).stroke();
  y += 14;

  doc.fontSize(8.7);
  doc.text("Постачальник:", left, y, { width: 86, underline: true });
  const supplierText =
    `${sellerName}\nп/р ${sellerIban} у банку ${sellerBank}\n${sellerAddress}\nкод за ДРФО ${sellerTaxId}, ІПН ${sellerTaxId}`;
  const supplierHeight = doc.heightOfString(supplierText, {
    width: width - 92,
    lineGap: 1,
  });
  doc.text(supplierText, left + 92, y, {
    width: width - 92,
    lineGap: 1,
  });
  y += Math.max(52, supplierHeight + 5);

  doc.text("Покупець:", left, y, { width: 86, underline: true });
  const buyerLines = [
    input.buyer.fop_name?.trim(),
    `Код ЄДРПОУ/ІПН: ${input.buyer.fop_tax_id ?? "-"}`,
    input.buyer.docs_phone ? `Тел.: ${input.buyer.docs_phone}` : "",
    input.buyer.docs_email ? `E-mail: ${input.buyer.docs_email}` : "",
  ].filter(Boolean);
  const buyerText = buyerLines.join("\n");
  const buyerHeight = doc.heightOfString(buyerText, {
    width: width - 92,
    lineGap: 1,
  });
  doc.text(buyerText, left + 92, y, { width: width - 92, lineGap: 1 });
  y += Math.max(buyerLines.length > 2 ? 52 : 34, buyerHeight + 5);

  // Keep monetary columns wide enough for formatted UAH values. The previous
  // final column was only 41pt wide, so even ordinary five-digit totals escaped
  // the right-hand border.
  const cols = [left, left + 28, left + 293, left + 361, left + 431, right];
  const headerHeight = 22;
  const drawTableHeader = (top: number) => {
    doc.lineWidth(1.1).rect(left, top, width, headerHeight).stroke();
    doc.fontSize(8.5);
    ["№", "Товар", "Кількість", "Ціна", "Сума"].forEach((label, index) => {
      doc.text(label, cols[index] + 3, top + 7, {
        width: cols[index + 1] - cols[index] - 6,
        align: index <= 2 ? "center" : "right",
        lineBreak: false,
      });
      if (index > 0) {
        doc.moveTo(cols[index], top).lineTo(cols[index], top + headerHeight).stroke();
      }
    });
    return top + headerHeight;
  };
  const addContinuationPage = (includeTableHeader: boolean) => {
    doc.addPage();
    let top = 38;
    doc.fontSize(10).text(
      `Рахунок № ${input.invoiceNumber} · замовлення № ${orderNumber} · продовження`,
      left,
      top,
      { width, lineBreak: false }
    );
    top += 22;
    return includeTableHeader ? drawTableHeader(top) : top;
  };
  y = drawTableHeader(y);

  input.lines.forEach((line, index) => {
    const unit = lineUnitPrice(line);
    const qty = Number(line.quantity);
    doc.fontSize(8);
    const titleWidth = cols[2] - cols[1] - 8;
    const title = fitTextToHeight(doc, line.title, titleWidth, 42);
    const titleHeight = doc.heightOfString(title, { width: titleWidth, lineGap: 1 });
    const rowHeight = Math.max(24, Math.ceil(titleHeight + 10));
    if (y + rowHeight > pageBottom) {
      y = addContinuationPage(true);
    }
    doc.rect(left, y, width, rowHeight).stroke();
    cols.slice(1, -1).forEach((x) => doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke());
    const verticallyCenteredY = y + Math.max(5, (rowHeight - 9) / 2);
    doc.text(String(index + 1), cols[0] + 3, verticallyCenteredY, {
      width: cols[1] - cols[0] - 6,
      align: "center",
      lineBreak: false,
    });
    doc.text(title, cols[1] + 4, y + 5, {
      width: titleWidth,
      height: rowHeight - 10,
      lineGap: 1,
      ellipsis: true,
    });
    doc.text(`${qty} шт`, cols[2] + 4, verticallyCenteredY, {
      width: cols[3] - cols[2] - 8,
      align: "center",
      lineBreak: false,
    });
    doc.text(moneyNumber(unit), cols[3] + 4, verticallyCenteredY, {
      width: cols[4] - cols[3] - 8,
      align: "right",
      lineBreak: false,
    });
    doc.text(moneyNumber(unit * qty), cols[4] + 4, verticallyCenteredY, {
      width: cols[5] - cols[4] - 8,
      align: "right",
      lineBreak: false,
    });
    y += rowHeight;
  });

  if (y + 150 > pageBottom) {
    y = addContinuationPage(false);
  }
  y += 10;
  doc.fontSize(10).text("Разом:", left + 332, y, { width: 100, align: "right" });
  doc.fontSize(11).text(moneyNumber(input.amount), left + 438, y, { width: 90, align: "right" });
  y += 26;

  doc.fontSize(8.5).text(`Всього найменувань ${input.lines.length}, на суму ${moneyNumber(input.amount)} грн.`, left, y);
  y += 16;
  doc.fontSize(10).text(smallAmountInWords(input.amount), left, y, { width });
  y += 22;
  doc.fontSize(8.3).text(`Призначення платежу: ${input.paymentPurpose}`, left, y, {
    width,
    lineGap: 1,
  });
  y += 28;
  doc.lineWidth(1.8).moveTo(left, y).lineTo(right, y).stroke();
  y += 20;

  doc.fillColor("#111111").fontSize(9);
  doc.moveTo(left + 330, y + 50).lineTo(right, y + 50).stroke();

  return collectPdf(doc);
}
