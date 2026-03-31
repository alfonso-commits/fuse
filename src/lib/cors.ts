import { NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  "https://fusefinance.com",
  "https://www.fusefinance.com",
  "http://localhost:3000",
];

export function corsHeaders(origin?: string | null): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export function handleCors(request: Request) {
  const origin = request.headers.get("origin");
  return NextResponse.json(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
