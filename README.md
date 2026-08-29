# Receipt Flow

ブラウザからレシートを撮影または選択し、AI で読み取った内容を確認してから Google スプレッドシートへ記録する Web アプリです。利用日が `2026-08-29` なら `202608` シートへ追記します。対象シートがなければ、見出し付きで自動作成します。

## できること

- スマートフォンのカメラ／画像ファイルからレシートを読み取り
- 店舗名、利用日、品目、金額、税額、合計などをフォームで修正してから保存
- 月ごとの `YYYYMM` シートを自動作成し、品目ごとに1行ずつ追記
- 画像ファイルをアプリ側で永続保存しない設計

## 必要なもの

- Node.js 20 以上
- OpenAI API キー
- Google Cloud プロジェクトと Google Sheets API
- 記録先として空の Google スプレッドシート 1 つ

## 導入手順

### 1. インストール

```bash
git clone <YOUR_REPOSITORY_URL>
cd receipt-_scanner
npm install
cp .env.example .env.local
```

`<YOUR_REPOSITORY_URL>` はご自身のリポジトリ URL に置き換えてください。個人用の URL やキーを README に書き込まないでください。

### 2. OpenAI API キーを設定

`.env.local` の `OPENAI_API_KEY` に、サーバー専用の API キーを設定します。キーにブラウザからアクセスできる `NEXT_PUBLIC_` 接頭辞を付けないでください。`OPENAI_RECEIPT_MODEL` は省略時 `gpt-4o-mini` です。

### 3. Google スプレッドシートを接続

1. Google Cloud でプロジェクトを作成し、**Google Sheets API** を有効にします。
2. サービスアカウントを作成し、JSON キーを安全な場所にダウンロードします。キー本体はリポジトリに置かないでください。
3. 記録先のスプレッドシートを作成し、サービスアカウントのメールアドレスに **編集者** 権限を付与します。
4. スプレッドシート URL の `/d/` と次の `/` の間にある ID を `GOOGLE_SHEETS_SPREADSHEET_ID` に設定します。
5. JSON キーの `client_email` を `GOOGLE_SERVICE_ACCOUNT_EMAIL`、`private_key` を `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` に設定します。秘密鍵内の改行は `\n` のまま1行で設定できます。

設定例は [`.env.example`](.env.example) のプレースホルダーだけを参照してください。

### 4. 起動

```bash
npm run dev
```

`http://localhost:3000` を開きます。スマートフォンから利用する場合は、同一ネットワーク上の開発端末の IP でアクセスするか、HTTPS を提供するデプロイ先を使ってください。カメラ API は通常 HTTPS（または localhost）でのみ使えます。

## スプレッドシートの列

作成される各月シートには以下の列を追加します。

`利用日 / 店舗名 / 品目 / 数量 / 金額 / 通貨 / 税額 / 支払方法 / 合計 / OCRテキスト / 登録日時`

日付が読めなかった場合は、保存時点の月のシートに追記されます。保存前に利用日を修正すれば、任意の月へ変更できます。

## セキュリティと個人情報

- `.env.local`、サービスアカウント JSON、API キーは `.gitignore` の対象です。コミット・PR・Issue・画面共有に含めないでください。
- レシート画像は OCR リクエストのために OpenAI API へ送信されますが、本アプリはディスクやデータベースに保存しません。組織のデータ取り扱い方針を確認して運用してください。
- Google スプレッドシートへの保存内容は、利用者自身が確認・編集した結果です。カード番号など不要な値が OCR テキストに含まれる場合は、保存前に削除してください。
- 公開リポジトリには実在のレシート画像、スプレッドシート ID、メールアドレス、鍵、個人名を追加しないでください。

## 検証・本番起動

```bash
npm run typecheck
npm run build
npm run start
```

環境変数はデプロイ先のシークレット管理機能に登録してください。公開環境では、アプリへの認証を追加し、利用者以外が OCR やスプレッドシート書き込みを実行できないようにしてください。

## 参考にした設計

`mtg_scanner` の「ブラウザでの撮影→OCR→確認」の操作フローを参考に、レシート用に画像アップロードと確認画面へ置き換えています。OCR の構造化出力は [official OpenAI documentation](https://platform.openai.com/docs/quickstart/make-your-first-api-request) の画像入力・Responses API の形式に沿っています。
