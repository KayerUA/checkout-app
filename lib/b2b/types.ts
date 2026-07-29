export type BuyerType = "individual" | "fop_company";
export type PaymentPreference = "card" | "bank_invoice";

export type FopOrderAttributes = {
  buyer_type: BuyerType;
  payment_preference: PaymentPreference;
  fop_name?: string;
  fop_tax_id?: string;
  fop_legal_address?: string;
  docs_email?: string;
  docs_phone?: string;
  accounting_comment?: string;
  legal_entity_id?: string;
  legal_entity_snapshot?: import("@/lib/legal-entities/model").LegalEntitySnapshot;
};

export type ShopifyOrderLine = {
  sku?: string | null;
  title: string;
  dilovodInvoiceName?: string | null;
  quantity: number;
  price?: string | number | null;
  price_set?: {
    shop_money?: {
      amount?: string;
      currency_code?: string;
    };
  };
};

export type ShopifyOrderPayload = {
  id: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  email?: string;
  contact_email?: string;
  phone?: string;
  billing_address?: { phone?: string | null } | null;
  shipping_address?: { phone?: string | null } | null;
  myshopify_domain?: string;
  shop_domain?: string;
  total_price?: string;
  currency?: string;
  note_attributes?: Array<{ name?: string; key?: string; value?: string | number | null }>;
  customAttributes?: Array<{ key?: string; name?: string; value?: string | number | null }>;
  line_items?: ShopifyOrderLine[];
  tags?: string;
  financial_status?: string;
};

export type B2BDocumentInput = {
  shopifyOrderId: string;
  shopifyOrderName?: string | null;
  invoiceNumber: string;
  invoiceDate: Date;
  buyer: FopOrderAttributes;
  amount: number;
  currency: string;
  lines: ShopifyOrderLine[];
  paymentPurpose: string;
};
