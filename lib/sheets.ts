import { google } from "googleapis";
import { Receipt, sheetNameFor } from "@/lib/receipt";

const HEADERS = ["利用日", "店舗名", "品目", "数量", "金額", "通貨", "税額", "支払方法", "合計", "OCRテキスト", "登録日時"];

function settings() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error("Google Sheets の環境変数が設定されていません。");
  }
  return { spreadsheetId, clientEmail, privateKey };
}

function escapeSheetName(name: string) {
  return `'${name.replaceAll("'", "''")}'`;
}

// Avoid evaluating OCR/user-provided values as formulas when using USER_ENTERED.
function safeText(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export async function appendReceipt(receipt: Receipt) {
  const { spreadsheetId, clientEmail, privateKey } = settings();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const title = sheetNameFor(receipt);
  const book = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const exists = book.data.sheets?.some((sheet) => sheet.properties?.title === title);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${escapeSheetName(title)}!A1:K1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [HEADERS] },
    });
  }

  const timestamp = new Date().toISOString();
  const common = [receipt.purchasedAt ?? "", safeText(receipt.merchant ?? "")];
  const lines = receipt.items.length ? receipt.items : [{ name: "", quantity: null, amount: null }];
  const values = lines.map((item) => [
    ...common,
    safeText(item.name),
    item.quantity ?? "",
    item.amount ?? "",
    safeText(receipt.currency ?? ""),
    receipt.tax ?? "",
    safeText(receipt.paymentMethod ?? ""),
    receipt.total ?? "",
    safeText(receipt.rawText ?? ""),
    timestamp,
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${escapeSheetName(title)}!A:K`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
  return { sheetName: title, rowCount: values.length };
}
