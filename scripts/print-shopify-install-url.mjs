#!/usr/bin/env node
/**
 * Prints Shopify OAuth install URL for kayer.
 * Usage: node scripts/print-shopify-install-url.mjs [shop-domain]
 */
const appUrl = process.env.APP_URL ?? "https://checkout.kayer.ua";
const shop = process.argv[2] ?? "kayer.myshopify.com";
const normalized = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;

console.log(`Install URL:\n${appUrl}/api/auth/shopify/install?shop=${normalized}`);
