import { NextRequest, NextResponse } from "next/server";
import { endSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  endSession(req, res);
  return res;
}
