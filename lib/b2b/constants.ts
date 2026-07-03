export const B2B_TAGS = {
  b2bFop: "B2B_FOP",
  b2bCardPayment: "B2B_FOP_CARD_PAYMENT",
  invoiceSent: "INVOICE_SENT",
  waitingIbanPayment: "WAITING_IBAN_PAYMENT",
  paymentMatched: "PAYMENT_MATCHED",
  bankTransferPaid: "BANK_TRANSFER_PAID",
  paymentConfirmed: "PAYMENT_CONFIRMED",
  deliveryNoteCreated: "DELIVERY_NOTE_CREATED",
  docsSent: "DOCS_SENT",
  needsPaymentReview: "NEEDS_PAYMENT_REVIEW",
  docError: "DOC_ERROR",
  emailError: "EMAIL_ERROR",
  cancelled: "CANCELLED",
  cardPaidNeedsReview: "CARD_PAID_NEEDS_ACCOUNTING_REVIEW",
} as const;

export const B2B_METAFIELD_NAMESPACE = "kayer_b2b";

export const B2B_METAFIELD_KEYS = [
  "buyer_type",
  "payment_preference",
  "fop_name",
  "fop_tax_id",
  "docs_email",
  "invoice_number",
  "invoice_pdf_url",
  "delivery_note_pdf_url",
  "bank_payment_status",
  "bank_transaction_id",
  "shopify_bank_transaction_id",
  "automation_status",
] as const;

export const INVOICE_NUMBER_PATTERN = /KAYER-UA-\d{4}-\d{6}/i;
