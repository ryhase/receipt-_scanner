# 🧾 Receipt Scanner (レシートスキャナー)

**フロントエンド (FE): GitHub Pages (HTML5 + CSS3 + Vanilla JS)**  
**バックエンド (BE): Google Apps Script (GAS) + Gemini Vision AI**

スマートフォンやPCのブラウザからレシートを撮影・選択・貼り付けすると、**Gemini Vision AI** が店舗名・利用日・品目明細・金額・支払方法・カテゴリを高精度に自動抽出し、Google スプレッドシートの月別シート（例: `202608`）へ自動仕分けして追記保存するシステムです。

---

## 🏗️ システム構成

```text
[ スマートフォン / PC ブラウザ (GitHub Pages: index.html) ]
      │
      │  HTTPS POST (API_URL 定数で接続)
      ▼
[ Google Apps Script (GAS) Web App API ]
      │
      ├── ① Gemini Vision AI (画像OCR・構造化抽出・税抜/税込自動判定)
      │
      └── ② Google スプレッドシート (月別シート自動作成 & 明細追記)
```

---

## ✨ 主な機能 & 計算仕様

- 📷 **マルチ入力対応**:
  - スマートフォンのカメラ起動（`capture="environment"` によるワンタップ撮影）
  - 画像ファイル選択 / ドラッグ＆ドロップ (JPEG / PNG / WebP)
  - **クリップボード直接貼り付け (Ctrl+V / Cmd+V)**: スクリーンショットを直接貼り付けて即時読み取り
  - クライアント側 Canvas による自動リサイズ・圧縮（高速通信）
- 🧠 **高精度 AI OCR (Gemini / OpenAI)**:
  - Gemini 2.5 Flash / 1.5 Flash による高速・高精度なレシート解析
  - 自動フォールバック機構（レート制限 429 や一時エラー発生時に別モデルへ自動切替）
- 💴 **税抜き金額・税込み金額の自動計算・仕分けルール**:
  - **パターン A（品目合計 = 合計金額 の場合）**:
    - 各品目に印字されている金額を「税込み金額」と判定し、税抜き金額を逆算（`税込 / (1 + 税率)`）。
  - **パターン B（品目合計 ≠ 合計金額 の場合）**:
    - 各品目に印字されている金額を「税抜き金額」と判定し、税込み金額を算出（`税抜 * (1 + 税率)`）。
- 📊 **スプレッドシート登録項目**:
  - `['利用日', '店舗名', 'カテゴリ', '品目', '数量', '税抜き金額', '税込み金額', '通貨', '支払方法', '登録日時']`
  - ※ 不要な「OCRテキスト」「合計」「税額」列は除外され、明細ごとに税抜・税込金額が記録されます。
- 📈 **履歴 & 月別サマリーダッシュボード**:
  - 今月の総支出額、登録件数、1枚あたり平均支出の自動集計
  - 直近の登録レシート一覧テーブル、スプレッドシートへの直接リンク

---

## 📁 ディレクトリ構成

```text
receipt-_scanner/
├── index.html          # フロントエンド SPA (API_URL定数でGASと通信)
├── Code.gs             # GAS バックエンド (AI OCR解析, 税計算, スプレッドシート操作, REST API)
├── appsscript.json     # Apps Script マニフェスト (OAuthスコープ, WebApp設定)
├── README.md           # セットアップ & GitHub Pages 公開ガイド
└── .gitignore          # Git 除外設定
```

---

## 🚀 セットアップ & 公開手順

### ステップ 1: バックエンド (GAS) のセットアップ
1. [Google スプレッドシート](https://sheets.new/) を新規作成します。
2. スプレッドシートのメニューから **[拡張機能] → [Apps Script]** を開きます。
3. `Code.gs` の内容を Apps Script エディタの `Code.gs` に貼り付けます。
4. [プロジェクトの設定] (⚙️) で「マニフェスト ファイルをエディタで表示する」を有効にし、`appsscript.json` の内容を貼り付けます。
5. **スクリプト プロパティの設定**:
   Apps Script エディタの **[プロジェクトの設定] (⚙️)** → **[スクリプト プロパティ]** に以下を追加します:
   - `GEMINI_API_KEY`: [Google AI Studio](https://aistudio.google.com/) で発行した API キー
   - `SPREADSHEET_ID`: (任意) 出力先スプレッドシートID（コンテナバインドの場合は未設定でも自動検出）
6. **ウェブアプリとしてデプロイ**:
   - 右上の **[デプロイ] → [新しいデプロイ]** をクリックします。
   - 種類の選択: **[ウェブアプリ]**
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
   - **[デプロイ]** をクリックし、発行された **ウェブアプリ URL** (`https://script.google.com/macros/s/.../exec`) をコピーします。

---

### ステップ 2: index.html に API_URL を設定
`index.html` の `<script>` 先頭にある `API_URL` に、ステップ 1 で発行された URL を貼り付けます:

```javascript
const API_URL = "https://script.google.com/macros/s/あなたのデプロイID/exec";
```

---

### ステップ 3: フロントエンド (GitHub Pages) の公開
1. このリポジトリを GitHub に push します。
2. GitHub リポジトリの **[Settings]** → **[Pages]** を開きます。
3. **Build and deployment**:
   - Source: `Deploy from a branch`
   - Branch: `main` (または `master`), Folder: `/ (root)`
4. **[Save]** をクリックすると、数分後に GitHub Pages の公開 URL (`https://<username>.github.io/<repo>/`) が発行されます。
5. ブラウザでアクセスすれば、そのまま即座にレシートスキャンと登録が利用できます！
