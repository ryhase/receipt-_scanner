import { NextResponse } from "next/server";
import { receiptSchema } from "@/lib/receipt";
import { appendReceipt } from "@/lib/sheets";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const receipt = receiptSchema.parse(await request.json());
    const result = await appendReceipt(receipt);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Spreadsheet append failed", error);
    const message = error instanceof Error ? error.message : "スプレッドシートへの追記に失敗しました。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
