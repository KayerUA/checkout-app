import { NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  "https://kayer.ua",
  "https://www.kayer.ua",
  process.env.APP_URL,
].filter(Boolean) as string[];

export function corsHeaders(origin: string | null) {
  const allowed =
    origin &&
    (ALLOWED_ORIGINS.some((o) => origin === o) ||
      origin.endsWith(".myshopify.com") ||
      process.env.NODE_ENV === "development");

  return {
    ...(allowed ? { "Access-Control-Allow-Origin": origin! } : {}),
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function withCors(response: NextResponse, origin: string | null) {
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
  return response;
}

export function handleCorsPreflight(request: Request) {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }
  return null;
}
