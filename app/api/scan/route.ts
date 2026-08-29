import OpenAI from "openai";
import { NextResponse } from "next/server";
import { receiptJsonSchema, receiptSchema } from "@/lib/receipt";

export const runtime = "nodejs";
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY が設定されていません。");
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File) || !image.type.startsWith("image/")) {
      return NextResponse.json({ error: "画像ファイルを選択してください。" }, { status: 400 });
    }
    if (image.size > MAX_IMAGE_SIZE) return NextResponse.json({ error: "画像は10MB以下にしてください。" }, { status: 413 });

    const bytes = Buffer.from(await image.arrayBuffer());
    const dataUrl = `data:${image.type};base64,${bytes.toString("base64")}`;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_RECEIPT_MODEL || "gpt-4o-mini",
      store: false,
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: "Extract this receipt. Return only facts visibly printed on it. Do not infer missing dates, totals, currency, or payment method. Use null for unreadable fields. Keep individual item lines when readable." },
          { type: "input_image", image_url: dataUrl, detail: "high" },
        ],
      }],
      text: { format: { type: "json_schema", name: "receipt", strict: true, schema: receiptJsonSchema } },
    });
    const receipt = receiptSchema.parse(JSON.parse(response.output_text));
    return NextResponse.json({ receipt });
  } catch (error) {
    console.error("Receipt scan failed", error);
    const message = error instanceof Error ? error.message : "読み取りに失敗しました。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
