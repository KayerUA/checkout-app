import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { invoiceDocumentIdFromToken } from "@/lib/documents/public-invoice-link";
import { freshDocumentDownloadUrl } from "@/lib/supabase/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const documentId = invoiceDocumentIdFromToken(token);
  if (!documentId) {
    return new NextResponse("Invoice not found", { status: 404 });
  }

  const invoice = await prisma.b2BDocument.findFirst({
    where: { id: documentId, type: "invoice" },
    select: { pdfUrl: true },
  });
  if (!invoice) {
    return new NextResponse("Invoice not found", { status: 404 });
  }

  const downloadUrl = await freshDocumentDownloadUrl({
    pdfUrl: invoice.pdfUrl,
  });
  if (!downloadUrl) {
    return new NextResponse("Invoice is temporarily unavailable", { status: 503 });
  }

  const response = NextResponse.redirect(downloadUrl, 307);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
