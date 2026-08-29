# 🧾 Receipt Scanner (レシートスキャナー)

**フロントエンド (FE): GitHub Pages (HTML5 + CSS3 + Vanilla JS)**  
**バックエンド (BE): Google Apps Script (GAS) + Gemini Vision AI**

スマートフォンやPCのブラウザからレシートを撮影・選択・貼り付けすると、**Gemini Vision AI** が店舗名・利用日・品目明細・金額・税額・支払方法・カテゴリを高精度に自動抽出し、Google スプレッドシートの月別シート（例: `202608`）へ自動仕分けして追記保存するシステムです。

---

## 🏗️ システム構成

```text
[ スマートフォン / PC ブラウザ (GitHub Pages: index.html) ]
      │
      │  HTTPS POST (API_URL 定数で接続)
      ▼
[ Google Apps Script (GAS) Web App API ]
      │
      ├── ① Gemini Vision AI (画像OCR・構造化抽出・フォールバック)
      │
      └── ② Google スプレッドシート (月別シート自動作成 & 追記)
```

---

## ✨ 主な機能

- 📷 **マルチ入力対応**:
  - スマートフォンのカメラ起動（`capture="environment"` によるワンタップ撮影）
  - 画像ファイル選択 / ドラッグ＆ドロップ (JPEG / PNG / WebP)
  - **クリップボード直接貼り付け (Ctrl+V / Cmd+V)**: スクリーンショットを直接貼り付けて即時読み取り
  - クライアント側 Canvas による自動リサイズ・圧縮（通信負荷とレスポンス時間を最適化）
- 🧠 **高精度 AI OCR (Gemini / OpenAI)**:
  - Gemini 2.5 Flash / 1.5 Flash による高速・高精度なレシート解析
  - 自動フォールバック機構（レート制限 429 や一時エラー発生時に別モデルへ自動切替）
  - OpenAI (gpt-4o-mini) へのフォールバック対応
- ✍️ **インタラクティブな確認・編集**:
  - 利用日、店舗名、カテゴリ（クイックチップ選択）、支払方法、合計金額、内消費税額の修正
  - 品目明細一覧のエディタ（追加・削除・インライン編集）
  - 「品目合計から合計金額を自動計算」ワンクリックアシスト
  - OCR全文テキストの確認・編集
- 📊 **スプレッドシート月別自動仕分け**:
  - レシートの利用日に応じて `YYYYMM`（例: `202608`）シートを自動作成し、明細行を整形して追記
  - カラム構造: `['利用日', '店舗名', 'カテゴリ', '品目', '数量', '金額', '合計', '税額', '通貨', '支払方法', 'OCRテキスト', '登録日時']`
  - 数式インジェクション防止（`safeText_`）とヘッダー書式設定
- 📈 **履歴 & 月別サマリーダッシュボード**:
  - 今月の総支出額、登録件数、1枚あたり平均支出の自動集計
  - 直近の登録レシート一覧テーブル、スプレッドシートへの直接リンク
- ⚙️ **設定 & 診断機能**:
  - `index.html` 内の `API_URL` 定数で GAS バックエンドと直接通信
  - APIキー、スプレッドシート接続テスト
  - 初回シート初期化 (`setupSheets`)

---

## 📁 ディレクトリ構成

```text
receipt-_scanner/
├── index.html          # フロントエンド SPA (API_URL定数でGASと通信)
├── Code.gs             # GAS バックエンド (AI OCR解析, スプレッドシート操作, REST API)
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

---

## 📱 スマートフォンのホーム画面に追加 (PWA風利用)
GitHub Pages の URL をスマートフォンの Safari (iOS) または Chrome (Android) で開き、ブラウザメニューから **「ホーム画面に追加」** することで、ネイティブアプリのような全画面で快適に利用できます。
