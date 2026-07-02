import fs from "node:fs";

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(html: string) {
  return decodeHtmlEntities(
    html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|tr|h1|h2|h3|table|tbody|thead)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "  ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  );
}

function resolveUnicodeFontPath() {
  const candidates = [
    process.env.PDF_UNICODE_FONT_PATH,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
  ].filter(Boolean) as string[];

  return candidates.find((fontPath) => fs.existsSync(fontPath));
}

export async function createSimplePdfFromHtml(html: string) {
  const fontPath = resolveUnicodeFontPath();
  if (fontPath) {
    const importModule = new Function("specifier", "return import(specifier)") as (
      specifier: string
    ) => Promise<{ default: new (options: Record<string, unknown>) => {
      on: (event: string, callback: (chunk?: Buffer) => void) => void;
      font: (path: string) => unknown;
      fontSize: (size: number) => { text: (text: string, options?: Record<string, unknown>) => unknown };
      moveDown: (lines?: number) => unknown;
      end: () => void;
    } }>;
    const { default: PDFDocument } = await importModule("pdfkit");

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 46, right: 42, bottom: 46, left: 42 },
        compress: false,
        info: { Title: "KAYER UA invoice" },
      });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk) => {
        if (chunk) chunks.push(Buffer.from(chunk));
      });
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const text = stripHtml(html);
      doc.font(fontPath);
      doc.fontSize(10).text(text, {
        width: 510,
        align: "left",
        lineGap: 3,
      });
      doc.end();
    });
  }

  const text = stripHtml(html);
  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => line.match(/.{1,88}(\s|$)/g)?.map((part) => part.trim()) ?? [line]);

  const content = [
    "BT",
    "/F1 10 Tf",
    "50 790 Td",
    "14 TL",
    ...lines.slice(0, 52).map((line) => `(${escapePdfText(line)}) Tj T*`),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf);
}

export async function createPdfFromHtml(html: string) {
  if (process.env.PDF_RENDERER !== "playwright") {
    return createSimplePdfFromHtml(html);
  }

  try {
    const importModule = new Function("specifier", "return import(specifier)") as (
      specifier: string
    ) => Promise<{ chromium?: { launch: (options: { headless: boolean }) => Promise<{
      newPage: () => Promise<{
        setContent: (content: string, options: { waitUntil: "networkidle" }) => Promise<void>;
        pdf: (options: {
          format: "A4";
          printBackground: boolean;
          margin: { top: string; right: string; bottom: string; left: string };
        }) => Promise<Uint8Array>;
      }>;
      close: () => Promise<void>;
    }> } }>;
    const { chromium } = await importModule("@playwright/test");
    if (!chromium) throw new Error("Playwright chromium is unavailable");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "18mm",
        right: "16mm",
        bottom: "18mm",
        left: "16mm",
      },
    });
    await browser.close();
    return Buffer.from(pdf);
  } catch {
    return createSimplePdfFromHtml(html);
  }
}
