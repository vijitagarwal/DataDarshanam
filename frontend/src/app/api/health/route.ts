import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "DataDarshan API",
    ai_configured: !!process.env.GROQ_API_KEY,
  });
}
