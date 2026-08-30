/**
 * ==============================================================================
 * Receipt Scanner (レシートスキャナー) - GAS Backend
 * ==============================================================================
 * 
 * 概要:
 *  レシート画像を Gemini Vision API (または OpenAI API) で高精度にOCR解析し、
 *  確認・編集したデータを Google スプレッドシートの月別シート (YYYYMM) に自動保存します。
 * 
 * 主な機能:
 *  1. WebアプリUIの配信 (doGet)
 *  2. REST API エンドポイント (doGet / doPost)
 *  3. Gemini / OpenAI によるマルチモーダルOCR解析 (scanReceipt)
 *  4. 自動フォールバック機構 (複数Geminiモデルの順次試行)
 *  5. スプレッドシート月別自動仕分け・保存 (appendReceipt)
 *     - 税抜き金額・税込み金額の自動計算・分割登録
 *  6. 登録履歴・月別集計データの取得 (getRecentReceipts, getMonthlySummary)
 *     - 品目別・カテゴリ別の内訳集計（円グラフ対応）
 *  7. スクリプトプロパティの診断・接続テスト (testConnection, setupSheets)
 * ==============================================================================
 */

// 設定プロパティのキー名定義
const SETTINGS = {
  GEMINI_KEY: 'GEMINI_API_KEY',
  OPENAI_KEY: 'OPENAI_API_KEY',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  GEMINI_MODEL: 'GEMINI_MODEL',
  OPENAI_MODEL: 'OPENAI_MODEL'
};

// スプレッドシートの標準ヘッダー定義 (OCRテキスト・合計・税額を除外し、税抜き・税込み金額を記録)
const HEADERS = [
  '利用日',
  '店舗名',
  'カテゴリ',
  '品目',
  '数量',
  '税抜き金額',
  '税込み金額',
  '通貨',
  '支払方法',
  '登録日時'
];

// 最大画像サイズ (10MB)
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// 利用可能なカテゴリ一覧
const CATEGORIES = [
  '食費',
  '外食',
  '日用品',
  '交通費',
  '交際費',
  '消耗品費',
  '書籍・教育',
  '医療費',
  '水道光熱費',
  '通信費',
  '趣味・娯楽',
  'その他'
];

/**
 * ------------------------------------------------------------------------------
 * Web アプリケーション / API エントリポイント
 * ------------------------------------------------------------------------------
 */

/**
 * Webアプリ表示および GET API ディスパッチャ
 */
function doGet(e) {
  // API アクションの処理
  if (e && e.parameter && e.parameter.action) {
    return handleGetApi_(e.parameter);
  }

  // WebアプリUI (index.html) の配信
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Receipt Scanner - レシートスキャナー')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * POST API ディスパッチャ
 */
function doPost(e) {
  try {
    const postData = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = (e && e.parameter && e.parameter.action) || postData.action;

    let result;
    switch (action) {
      case 'scanReceipt':
        result = scanReceipt(postData.payload || postData);
        break;
      case 'appendReceipt':
        result = appendReceipt(postData.receipt || postData);
        break;
      case 'getRecentReceipts':
        result = getRecentReceipts(postData.limit, postData.sheetName);
        break;
      case 'getMonthlySummary':
        result = getMonthlySummary(postData.sheetName);
        break;
      case 'testConnection':
        result = testConnection();
        break;
      case 'setupSheets':
        result = setupSheets();
        break;
      default:
        throw new Error('未知のアクションです: ' + action);
    }

    return jsonResponse({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('doPost Error:', err);
    return jsonResponse({
      success: false,
      error: err.message || String(err)
    });
  }
}

/**
 * GET API リクエストのディスパッチ
 */
function handleGetApi_(params) {
  try {
    const action = params.action;
    let result;

    switch (action) {
      case 'getSettings':
        result = getSettingsInfo();
        break;
      case 'getRecentReceipts':
        result = getRecentReceipts(params.limit ? Number(params.limit) : 20, params.sheetName);
        break;
      case 'getMonthlySummary':
        result = getMonthlySummary(params.sheetName);
        break;
      case 'getSheets':
        result = getAvailableSheets();
        break;
      case 'testConnection':
        result = testConnection();
        break;
      case 'setupSheets':
        result = setupSheets();
        break;
      default:
        throw new Error('未知のアクションです: ' + action);
    }

    return jsonResponse({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('handleGetApi_ Error:', err);
    return jsonResponse({
      success: false,
      error: err.message || String(err)
    });
  }
}

/**
 * ------------------------------------------------------------------------------
 * OCR 解析ロジック (Gemini / OpenAI)
 * ------------------------------------------------------------------------------
 */

/**
 * レシート画像をOCR解析し、構造化データとして返却
 * @param {Object} payload { dataUrl: string, engine?: 'gemini' | 'openai' }
 * @return {Object} 構造化されたレシート情報
 */
function scanReceipt(payload) {
  validateImagePayload_(payload);
  const properties = PropertiesService.getScriptProperties();

  const geminiKey = properties.getProperty(SETTINGS.GEMINI_KEY);
  const openAiKey = properties.getProperty(SETTINGS.OPENAI_KEY);

  if (!geminiKey && !openAiKey) {
    throw new Error('スクリプト プロパティに GEMINI_API_KEY または OPENAI_API_KEY が設定されていません。プロジェクトの設定から追加してください。');
  }

  // エンジン選択（指定があれば優先、なければGemini優先）
  const engine = payload.engine || (geminiKey ? 'gemini' : 'openai');

  let rawResult;
  if (engine === 'gemini' && geminiKey) {
    rawResult = scanWithGemini_(payload.dataUrl, geminiKey);
  } else if (openAiKey) {
    rawResult = scanWithOpenAi_(payload.dataUrl, openAiKey);
  } else {
    rawResult = scanWithGemini_(payload.dataUrl, geminiKey);
  }

  return normalizeReceipt_(rawResult);
}

/**
 * Gemini API によるレシートOCR解析
 */
function scanWithGemini_(dataUrl, apiKey) {
  const base64Data = dataUrl.split(',')[1];
  const mimeType = (dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/) || [])[1] || 'image/jpeg';

  const prompt = `あなたは高精度なレシート・領収書解析専門のAIアシスタントです。
提供されたレシート画像を詳細に読み取り、以下の情報を厳密に抽出してJSONオブジェクト形式で出力してください。

【抽出ルール】
1. 利用日 (purchasedAt): レシートに印字されている購入日を "YYYY-MM-DD" 形式で抽出してください。和暦（例: 令和6年）の場合は西暦に変換してください。読み取れない・記載がない場合は null にしてください。
2. 店舗名 (merchant): 発行元・店舗名・会社名を抽出してください。支店名がある場合は含めて構いません。
3. 合計金額 (total): 最終的な支払合計金額（税込合計）を数値 (number) で抽出してください。推測せず、印字されている合計額を採用してください。
4. 通貨 (currency): 通貨コード (JPY, USD, EUR等) を抽出してください。日本のレシートは "JPY" としてください。
5. 税額 (tax): 消費税等の税額が明記されている場合は数値で抽出してください。
6. 支払方法 (paymentMethod): 現金、クレジットカード、PayPay、交通系IC、iD、QUICPay、電子マネー等の支払手段を抽出してください。
7. カテゴリ (category): 店舗名や品目から最も適したカテゴリを以下から1つ選択してください:
   ["食費", "外食", "日用品", "交通費", "交際費", "消耗品費", "書籍・教育", "医療費", "水道光熱費", "通信費", "趣味・娯楽", "その他"]
8. 品目一覧 (items): 読み取れる商品・品目明細の配列。
   各品目は以下の形式:
   - name: 商品名・品目名 (string)
   - quantity: 数量 (number または null)
   - amount: レシートに印字されている金額 (number または null)
   - category: カテゴリ (string または null)
   品目が読み取れない場合は空配列 [] にしてください。
9. OCRテキスト (rawText): レシートに印字されている文字テキスト。

【出力フォーマット (JSON Schema準拠)】
以下のJSON構造のみを返してください。マークダウン等の装飾（\`\`\`json等）は付けず、純粋なJSON文字列として出力してください。
{
  "purchasedAt": "2026-08-29",
  "merchant": "店舗名",
  "total": 1280,
  "currency": "JPY",
  "tax": 116,
  "paymentMethod": "クレジットカード",
  "category": "食費",
  "items": [
    { "name": "商品A", "quantity": 1, "amount": 500, "category": "食費" },
    { "name": "商品B", "quantity": 2, "amount": 780, "category": "食費" }
  ],
  "rawText": "レシート全文テキスト..."
}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  const responseJson = callGeminiWithFallback_(payload, apiKey);
  const text = responseJson.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Geminiから応答テキストを取得できませんでした。');
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('Gemini JSON Parse Error:', text);
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleaned);
  }
}

/**
 * Gemini API のモデルフォールバック呼び出し
 */
function callGeminiWithFallback_(payload, apiKey) {
  const properties = PropertiesService.getScriptProperties();
  const configuredModel = properties.getProperty(SETTINGS.GEMINI_MODEL);

  const modelCandidates = [
    configuredModel,
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.5-flash'
  ].filter(function(item, pos, self) {
    return item && self.indexOf(item) === pos;
  });

  let lastError = null;

  for (let i = 0; i < modelCandidates.length; i++) {
    const model = modelCandidates[i];
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';

    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': apiKey },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const statusCode = response.getResponseCode();
      const responseBody = response.getContentText();

      if (statusCode >= 200 && statusCode < 300) {
        return JSON.parse(responseBody);
      }

      console.warn('Gemini model ' + model + ' returned HTTP ' + statusCode + ': ' + responseBody);
      lastError = new Error('Gemini APIエラー (' + model + '): HTTP ' + statusCode + ' - ' + responseBody);

      if (statusCode === 429 || statusCode === 503 || statusCode === 500) {
        continue;
      } else {
        throw lastError;
      }
    } catch (err) {
      lastError = err;
      console.warn('Gemini call error on model ' + model + ':', err);
    }
  }

  throw lastError || new Error('利用可能なすべてのGeminiモデルへの接続に失敗しました。');
}

/**
 * OpenAI API によるレシートOCR解析 (フォールバック / 代替)
 */
function scanWithOpenAi_(dataUrl, apiKey) {
  const properties = PropertiesService.getScriptProperties();
  const model = properties.getProperty(SETTINGS.OPENAI_MODEL) || 'gpt-4o-mini';

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['purchasedAt', 'merchant', 'total', 'currency', 'tax', 'paymentMethod', 'category', 'items', 'rawText'],
    properties: {
      purchasedAt: { type: ['string', 'null'], description: 'Purchase date in YYYY-MM-DD format, or null' },
      merchant: { type: ['string', 'null'], description: 'Store / merchant name, or null' },
      total: { type: ['number', 'null'], description: 'Grand total amount, or null' },
      currency: { type: ['string', 'null'], description: 'ISO 4217 currency code like JPY, USD' },
      tax: { type: ['number', 'null'], description: 'Tax amount, or null' },
      paymentMethod: { type: ['string', 'null'], description: 'Payment method like Cash, Credit Card, PayPay' },
      category: { type: ['string', 'null'], description: 'Expense category' },
      rawText: { type: ['string', 'null'], description: 'Full visible text printed on receipt' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'quantity', 'amount', 'category'],
          properties: {
            name: { type: 'string' },
            quantity: { type: ['number', 'null'] },
            amount: { type: ['number', 'null'] },
            category: { type: ['string', 'null'] }
          }
        }
      }
    }
  };

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({
      model: model,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: 'You are an accurate receipt OCR parser. Extract all receipt information cleanly into structured JSON.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract this receipt. Return only facts visibly printed on it. Do not infer missing dates, totals, currency, or payment method. Use null for unreadable fields. Keep individual item lines when readable.'
            },
            {
              type: 'image_url',
              image_url: { url: dataUrl, detail: 'high' }
            }
          ]
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receipt_extraction',
          strict: true,
          schema: schema
        }
      }
    }),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const body = JSON.parse(response.getContentText());

  if (status < 200 || status >= 300) {
    console.error('OpenAI API Error:', JSON.stringify(body));
    const msg = (body.error && body.error.message) || response.getContentText();
    throw new Error('OpenAI APIエラー (HTTP ' + status + '): ' + msg);
  }

  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAIから応答メッセージを取得できませんでした。');
  }

  return JSON.parse(content);
}

/**
 * ------------------------------------------------------------------------------
 * スプレッドシート 連携・操作ロジック
 * ------------------------------------------------------------------------------
 */

/**
 * 利用先スプレッドシートの取得
 */
function getSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty(SETTINGS.SPREADSHEET_ID);

  if (spreadsheetId) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (e) {
      throw new Error('スプレッドシートID (' + spreadsheetId + ') を開けませんでした。IDが正しいか、スクリプトに閲覧/編集権限があるか確認してください。');
    }
  }

  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {
    // スタンドアロン実行でactiveが無い場合
  }

  throw new Error('スプレッドシートが設定されていません。スクリプト プロパティに「SPREADSHEET_ID」を設定してください。');
}

/**
 * 確認済みレシートデータを月別シート (YYYYMM) に追加
 * @param {Object} receipt レシート情報
 * @return {Object} 登録結果 { sheetName, rowCount, spreadsheetUrl }
 */
function appendReceipt(receipt) {
  const safeReceipt = normalizeReceipt_(receipt);
  const spreadsheet = getSpreadsheet_();
  const sheetTitle = sheetNameFor_(safeReceipt.purchasedAt);

  let sheet = spreadsheet.getSheetByName(sheetTitle);
  const isNewSheet = !sheet;

  if (isNewSheet) {
    sheet = spreadsheet.insertSheet(sheetTitle);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    
    // スタイル設定 (ヘッダー行)
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setBackground('#1e293b');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');
  }

  const registeredAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  
  // 明細がある場合は品目ごと、なければ合計行のみ
  const lines = safeReceipt.items && safeReceipt.items.length > 0
    ? safeReceipt.items
    : [{
        name: '',
        quantity: null,
        amountWithoutTax: safeReceipt.amountWithoutTax,
        amountWithTax: safeReceipt.amountWithTax || safeReceipt.total,
        category: safeReceipt.category
      }];

  const rows = lines.map(function(item) {
    return [
      safeReceipt.purchasedAt || '',
      safeText_(safeReceipt.merchant || ''),
      safeText_(item.category || safeReceipt.category || 'その他'),
      safeText_(item.name || ''),
      item.quantity === null || item.quantity === undefined ? '' : item.quantity,
      item.amountWithoutTax === null || item.amountWithoutTax === undefined ? '' : item.amountWithoutTax,
      item.amountWithTax === null || item.amountWithTax === undefined ? '' : item.amountWithTax,
      safeText_(safeReceipt.currency || 'JPY'),
      safeText_(safeReceipt.paymentMethod || ''),
      registeredAt
    ];
  });

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, HEADERS.length).setValues(rows);

  // 金額列のフォーマット (F:税抜き金額, G:税込み金額)
  try {
    sheet.getRange(startRow, 6, rows.length, 2).setNumberFormat('#,##0');
  } catch (e) {
    // フォーマット適用失敗時は継続
  }

  return {
    sheetName: sheetTitle,
    rowCount: rows.length,
    spreadsheetUrl: spreadsheet.getUrl(),
    registeredAt: registeredAt
  };
}

/**
 * 直近の登録レシート履歴を取得
 */
function getRecentReceipts(limit, targetSheetName) {
  limit = limit || 20;
  const spreadsheet = getSpreadsheet_();
  const sheets = spreadsheet.getSheets();
  
  if (sheets.length === 0) return [];

  let targetSheet = null;
  if (targetSheetName) {
    targetSheet = spreadsheet.getSheetByName(targetSheetName);
  } else {
    const monthSheets = sheets
      .map(function(s) { return s.getName(); })
      .filter(function(name) { return /^\d{6}$/.test(name) || /^\d{4}-\d{2}$/.test(name); })
      .sort()
      .reverse();

    if (monthSheets.length > 0) {
      targetSheet = spreadsheet.getSheetByName(monthSheets[0]);
    } else {
      targetSheet = sheets[0];
    }
  }

  if (!targetSheet || targetSheet.getLastRow() <= 1) {
    return [];
  }

  const lastRow = targetSheet.getLastRow();
  const startRow = Math.max(2, lastRow - limit + 1);
  const numRows = lastRow - startRow + 1;
  
  const values = targetSheet.getRange(startRow, 1, numRows, targetSheet.getLastColumn()).getValues();
  const headers = targetSheet.getRange(1, 1, 1, targetSheet.getLastColumn()).getValues()[0];

  const colMap = {};
  headers.forEach(function(h, i) {
    if (h) colMap[String(h).trim()] = i;
  });

  const results = [];
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    
    const amountWithoutTax = colMap['税抜き金額'] !== undefined ? row[colMap['税抜き金額']] : '';
    const amountWithTax = colMap['税込み金額'] !== undefined ? row[colMap['税込み金額']] : (colMap['金額'] !== undefined ? row[colMap['金額']] : (colMap['合計'] !== undefined ? row[colMap['合計']] : ''));

    results.push({
      purchasedAt: formatDateValue_(row[colMap['利用日']]),
      merchant: row[colMap['店舗名']] || '',
      category: row[colMap['カテゴリ']] || '',
      itemName: row[colMap['品目']] || '',
      quantity: row[colMap['数量']],
      amountWithoutTax: amountWithoutTax,
      amountWithTax: amountWithTax,
      currency: row[colMap['通貨']] || 'JPY',
      paymentMethod: row[colMap['支払方法']] || '',
      registeredAt: formatDateValue_(row[colMap['登録日時']]),
      sheetName: targetSheet.getName()
    });
  }

  return results;
}

/**
 * 月別の集計サマリーを取得 (品目別・カテゴリ別の内訳集計を含む)
 */
function getMonthlySummary(targetSheetName) {
  const spreadsheet = getSpreadsheet_();
  const sheets = spreadsheet.getSheets();

  const monthSheets = sheets
    .map(function(s) { return s.getName(); })
    .filter(function(name) { return /^\d{6}$/.test(name) || /^\d{4}-\d{2}$/.test(name); })
    .sort()
    .reverse();

  const currentSheetName = targetSheetName || (monthSheets.length > 0 ? monthSheets[0] : null);
  if (!currentSheetName) {
    return {
      currentMonth: '',
      availableMonths: [],
      totalSpent: 0,
      receiptCount: 0,
      categorySummary: {},
      itemSummary: [],
      paymentMethodSummary: {}
    };
  }

  const sheet = spreadsheet.getSheetByName(currentSheetName);
  if (!sheet || sheet.getLastRow() <= 1) {
    return {
      currentMonth: currentSheetName,
      availableMonths: monthSheets,
      totalSpent: 0,
      receiptCount: 0,
      categorySummary: {},
      itemSummary: [],
      paymentMethodSummary: {}
    };
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const colMap = {};
  headers.forEach(function(h, i) {
    if (h) colMap[String(h).trim()] = i;
  });

  let totalSpent = 0;
  const receipts = new Set();
  const categorySummary = {};
  const itemMap = {};
  const paymentMethodSummary = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    
    // 税込み金額をベースに総支出を集計 (なければ旧金額/合計)
    let itemAmtWithTax = colMap['税込み金額'] !== undefined ? Number(row[colMap['税込み金額']]) : NaN;
    if (isNaN(itemAmtWithTax)) {
      itemAmtWithTax = colMap['金額'] !== undefined ? Number(row[colMap['金額']]) : Number(row[colMap['合計']]);
    }

    if (isNaN(itemAmtWithTax) || itemAmtWithTax <= 0) continue;

    const itemName = String(row[colMap['品目']] || '').trim() || String(row[colMap['店舗名']] || 'その他').trim();
    const category = String(row[colMap['カテゴリ']] || 'その他').trim();
    const payment = String(row[colMap['支払方法']] || '未指定').trim();
    const registeredAt = String(row[colMap['登録日時']] || i);

    totalSpent += itemAmtWithTax;
    categorySummary[category] = (categorySummary[category] || 0) + itemAmtWithTax;
    itemMap[itemName] = (itemMap[itemName] || 0) + itemAmtWithTax;

    if (payment) {
      paymentMethodSummary[payment] = (paymentMethodSummary[payment] || 0) + 1;
    }

    receipts.add(registeredAt);
  }

  // 品目別集計を金額降順でソート（上位10品目 + その他に整理）
  const sortedItems = Object.keys(itemMap)
    .map(function(name) { return { name: name, amount: itemMap[name] }; })
    .sort(function(a, b) { return b.amount - a.amount; });

  const topItems = sortedItems.slice(0, 10);
  const otherItemsAmount = sortedItems.slice(10).reduce(function(sum, it) { return sum + it.amount; }, 0);
  if (otherItemsAmount > 0) {
    topItems.push({ name: 'その他 (' + (sortedItems.length - 10) + '品目)', amount: otherItemsAmount });
  }

  return {
    currentMonth: currentSheetName,
    availableMonths: monthSheets,
    totalSpent: totalSpent,
    receiptCount: receipts.size,
    categorySummary: categorySummary,
    itemSummary: topItems,
    paymentMethodSummary: paymentMethodSummary,
    spreadsheetUrl: spreadsheet.getUrl()
  };
}

/**
 * 利用可能な月別シート一覧を取得
 */
function getAvailableSheets() {
  const spreadsheet = getSpreadsheet_();
  return spreadsheet.getSheets().map(function(s) {
    return {
      name: s.getName(),
      rowCount: s.getLastRow()
    };
  });
}

/**
 * 初期セットアップ（シート作成・ヘッダー準備）
 */
function setupSheets() {
  const spreadsheet = getSpreadsheet_();
  const currentMonth = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyyMM');
  
  let sheet = spreadsheet.getSheetByName(currentMonth);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(currentMonth);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setBackground('#1e293b');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');
  }

  return {
    message: 'セットアップ完了: シート [' + currentMonth + '] を準備しました。',
    sheetName: currentMonth,
    spreadsheetUrl: spreadsheet.getUrl()
  };
}

/**
 * 設定・接続テスト
 */
function testConnection() {
  const properties = PropertiesService.getScriptProperties();
  const geminiKey = properties.getProperty(SETTINGS.GEMINI_KEY);
  const openAiKey = properties.getProperty(SETTINGS.OPENAI_KEY);
  const spreadsheetId = properties.getProperty(SETTINGS.SPREADSHEET_ID);

  const results = {
    gemini: { configured: !!geminiKey, ok: false, message: '' },
    openai: { configured: !!openAiKey, ok: false, message: '' },
    spreadsheet: { configured: !!spreadsheetId, ok: false, message: '', title: '', url: '' }
  };

  // Gemini テスト
  if (geminiKey) {
    try {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': geminiKey },
        payload: JSON.stringify({
          contents: [{ parts: [{ text: 'Respond with OK.' }] }]
        }),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() === 200) {
        results.gemini.ok = true;
        results.gemini.message = '接続成功 (Gemini API 正常稼働)';
      } else {
        results.gemini.message = 'HTTP ' + res.getResponseCode() + ': ' + res.getContentText();
      }
    } catch (e) {
      results.gemini.message = 'エラー: ' + e.message;
    }
  } else {
    results.gemini.message = 'GEMINI_API_KEY が未設定です';
  }

  // OpenAI テスト
  if (openAiKey) {
    try {
      const res = UrlFetchApp.fetch('https://api.openai.com/v1/models', {
        method: 'get',
        headers: { Authorization: 'Bearer ' + openAiKey },
        muteHttpExceptions: true
      });
      if (res.getResponseCode() === 200) {
        results.openai.ok = true;
        results.openai.message = '接続成功 (OpenAI API 正常稼働)';
      } else {
        results.openai.message = 'HTTP ' + res.getResponseCode() + ': ' + res.getContentText();
      }
    } catch (e) {
      results.openai.message = 'エラー: ' + e.message;
    }
  } else {
    results.openai.message = 'OPENAI_API_KEY が未設定です';
  }

  // スプレッドシート テスト
  try {
    const ss = getSpreadsheet_();
    results.spreadsheet.ok = true;
    results.spreadsheet.title = ss.getName();
    results.spreadsheet.url = ss.getUrl();
    results.spreadsheet.message = '接続成功 (' + ss.getName() + ')';
  } catch (e) {
    results.spreadsheet.message = e.message;
  }

  return results;
}

/**
 * 現在の設定情報の概要を取得
 */
function getSettingsInfo() {
  const properties = PropertiesService.getScriptProperties();
  const geminiKey = properties.getProperty(SETTINGS.GEMINI_KEY);
  const openAiKey = properties.getProperty(SETTINGS.OPENAI_KEY);
  const spreadsheetId = properties.getProperty(SETTINGS.SPREADSHEET_ID);
  const geminiModel = properties.getProperty(SETTINGS.GEMINI_MODEL) || 'gemini-2.5-flash';
  const openAiModel = properties.getProperty(SETTINGS.OPENAI_MODEL) || 'gpt-4o-mini';

  let spreadsheetName = '';
  let spreadsheetUrl = '';
  try {
    const ss = getSpreadsheet_();
    spreadsheetName = ss.getName();
    spreadsheetUrl = ss.getUrl();
  } catch (e) {
    // 未設定またはエラー
  }

  return {
    hasGeminiKey: !!geminiKey,
    hasOpenAiKey: !!openAiKey,
    hasSpreadsheetId: !!spreadsheetId,
    spreadsheetName: spreadsheetName,
    spreadsheetUrl: spreadsheetUrl,
    geminiModel: geminiModel,
    openAiModel: openAiModel,
    categories: CATEGORIES
  };
}

/**
 * ------------------------------------------------------------------------------
 * ヘルパー・税額計算・バリデーション関数
 * ------------------------------------------------------------------------------
 */

function validateImagePayload_(payload) {
  if (!payload || typeof payload.dataUrl !== 'string' || !/^data:image\/[a-zA-Z0-9+.-]+;base64,/.test(payload.dataUrl)) {
    throw new Error('有効な画像データ (JPEG, PNG, WebP等) を指定してください。');
  }
  const base64 = payload.dataUrl.split(',')[1] || '';
  if (base64.length * 0.75 > MAX_IMAGE_BYTES) {
    throw new Error('画像サイズが大きすぎます (最大10MB)。');
  }
}

/**
 * レシートデータの正規化および「税抜き金額」「税込み金額」の自動計算
 */
function normalizeReceipt_(value) {
  value = value || {};

  const nullableText = function(input, maxLength) {
    if (input === null || input === undefined) return null;
    const text = String(input).trim().slice(0, maxLength || 500);
    return text || null;
  };

  const nullableNumber = function(input) {
    if (input === null || input === undefined || input === '') return null;
    const num = Number(input);
    return !isNaN(num) && isFinite(num) && num >= 0 ? Math.round(num * 100) / 100 : null;
  };

  const dateRaw = nullableText(value.purchasedAt, 30);
  let dateFormatted = null;
  if (dateRaw) {
    const match = dateRaw.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    if (match) {
      const y = match[1];
      const m = match[2].padStart(2, '0');
      const d = match[3].padStart(2, '0');
      dateFormatted = y + '-' + m + '-' + d;
    }
  }

  const rawTotal = nullableNumber(value.total);
  const rawItems = Array.isArray(value.items) ? value.items : [];

  // 品目金額の合計を算出
  let itemSum = 0;
  let hasItemAmounts = false;
  rawItems.forEach(function(item) {
    if (item && item.amount !== null && item.amount !== undefined && !isNaN(item.amount)) {
      itemSum += Number(item.amount);
      hasItemAmounts = true;
    }
  });

  // 品目合計と合計金額が等しいかどうかの判定 (端数誤差1円以内を許容)
  const isSumEqualToTotal = hasItemAmounts && rawTotal !== null && Math.abs(itemSum - rawTotal) <= 1;

  const items = rawItems.slice(0, 100).map(function(item) {
    if (!item) return null;
    const name = nullableText(item.name, 300);
    if (!name) return null;

    const rawAmt = nullableNumber(item.amount);
    const category = nullableText(item.category, 50) || value.category || 'その他';
    const taxRate = category === '食費' ? 0.08 : 0.10;

    let amtWithoutTax = nullableNumber(item.amountWithoutTax);
    let amtWithTax = nullableNumber(item.amountWithTax);

    if (amtWithoutTax === null && amtWithTax === null && rawAmt !== null) {
      if (isSumEqualToTotal) {
        amtWithTax = rawAmt;
        amtWithoutTax = Math.round(rawAmt / (1 + taxRate));
      } else {
        amtWithoutTax = rawAmt;
        amtWithTax = Math.round(rawAmt * (1 + taxRate));
      }
    } else if (amtWithoutTax !== null && amtWithTax === null) {
      amtWithTax = Math.round(amtWithoutTax * (1 + taxRate));
    } else if (amtWithTax !== null && amtWithoutTax === null) {
      amtWithoutTax = Math.round(amtWithTax / (1 + taxRate));
    }

    return {
      name: name,
      quantity: nullableNumber(item.quantity) || 1,
      amount: rawAmt,
      amountWithoutTax: amtWithoutTax,
      amountWithTax: amtWithTax,
      category: category
    };
  }).filter(Boolean);

  let overallAmtWithoutTax = nullableNumber(value.amountWithoutTax);
  let overallAmtWithTax = nullableNumber(value.amountWithTax);
  if (rawTotal !== null) {
    if (overallAmtWithTax === null) overallAmtWithTax = rawTotal;
    if (overallAmtWithoutTax === null) overallAmtWithoutTax = Math.round(rawTotal / 1.10);
  }

  return {
    purchasedAt: dateFormatted,
    merchant: nullableText(value.merchant, 200),
    total: rawTotal,
    amountWithoutTax: overallAmtWithoutTax,
    amountWithTax: overallAmtWithTax,
    currency: nullableText(value.currency, 10) || 'JPY',
    tax: nullableNumber(value.tax),
    paymentMethod: nullableText(value.paymentMethod, 100),
    category: nullableText(value.category, 50) || 'その他',
    items: items,
    rawText: nullableText(value.rawText, 20000)
  };
}

function sheetNameFor_(dateString) {
  if (dateString) {
    const clean = dateString.replace(/[-/.]/g, '');
    if (clean.length >= 6) {
      return clean.slice(0, 6);
    }
  }
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyyMM');
}

/**
 * スプレッドシートの数式インジェクション防止
 */
function safeText_(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  return /^[=+\-@]/.test(str) ? "'" + str : str;
}

function formatDateValue_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
