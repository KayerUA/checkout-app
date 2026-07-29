import crypto from "node:crypto";
import { getEnv } from "@/lib/env";

const TOKEN_VERSION = "invoice-pdf-v1";
const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signatureFor(documentId: string) {
  return crypto
    .createHmac("sha256", getEnv().SESSION_SECRET)
    .update(`${TOKEN_VERSION}:${documentId}`)
    .digest("base64url")
    .slice(0, 22);
}

export function publicInvoiceToken(documentId: string) {
  if (!DOCUMENT_ID_PATTERN.test(documentId)) {
    throw new Error("Invalid invoice document ID");
  }
  return `${documentId}.${signatureFor(documentId)}`;
}

export function publicInvoiceUrl(documentId: string) {
  return new URL(`/i/${publicInvoiceToken(documentId)}`, getEnv().APP_URL).toString();
}

export function invoiceDocumentIdFromToken(token: string) {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const documentId = token.slice(0, separator);
  const supplied = token.slice(separator + 1);
  if (!DOCUMENT_ID_PATTERN.test(documentId)) return null;

  const expected = signatureFor(documentId);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }

  return documentId;
}
