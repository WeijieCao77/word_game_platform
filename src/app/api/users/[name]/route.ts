import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ name: string }> };

export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const { name } = await params;
  const author = decodeURIComponent(name);
  return NextResponse.json({ author, games: getStore().listByAuthor(author) });
}
