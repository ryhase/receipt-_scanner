import { z } from "zod";

export const receiptSchema = z.object({
  purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  merchant: z.string().trim().max(200).nullable(),
  total: z.number().finite().nonnegative().nullable(),
  currency: z.string().trim().length(3).nullable(),
  tax: z.number().finite().nonnegative().nullable(),
  paymentMethod: z.string().trim().max(100).nullable(),
  items: z.array(
    z.object({
      name: z.string().trim().min(1).max(300),
      quantity: z.number().finite().positive().nullable(),
      amount: z.number().finite().nonnegative().nullable(),
    }),
  ).max(100),
  rawText: z.string().max(15000).nullable(),
});

export type Receipt = z.infer<typeof receiptSchema>;

export const receiptJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["purchasedAt", "merchant", "total", "currency", "tax", "paymentMethod", "items", "rawText"],
  properties: {
    purchasedAt: { type: ["string", "null"], description: "Purchase date in YYYY-MM-DD, or null when not printed/readable." },
    merchant: { type: ["string", "null"], description: "Merchant/store name, or null." },
    total: { type: ["number", "null"], description: "Grand total. Never calculate it; null if unclear." },
    currency: { type: ["string", "null"], description: "ISO 4217 code inferred only from explicit currency symbol/text, or null." },
    tax: { type: ["number", "null"], description: "Tax amount, or null." },
    paymentMethod: { type: ["string", "null"], description: "Printed payment method only, or null." },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "amount"],
        properties: {
          name: { type: "string" },
          quantity: { type: ["number", "null"] },
          amount: { type: ["number", "null"] },
        },
      },
    },
    rawText: { type: ["string", "null"], description: "Visible receipt text, without adding information not present." },
  },
} as const;

export function sheetNameFor(receipt: Receipt): string {
  const source = receipt.purchasedAt ?? new Date().toISOString().slice(0, 10);
  return source.replaceAll("-", "").slice(0, 6);
}
