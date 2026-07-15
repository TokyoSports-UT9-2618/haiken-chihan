# Gemini APIキー設定手順（これをやらないとAI講評とPDFが動きません）

AI講評は Google の Gemini（無料枠あり・クレカ登録不要）で動くようになりました。
必要な作業は **①無料のAPIキーをもらう → ②Cloudflareに貼り付ける** の2つだけ。10分で終わります。

---

## ① Googleから無料のAPIキーをもらう

1. ブラウザで **https://aistudio.google.com/** を開く
2. 普段使っているGoogleアカウントでログイン
3. 左上あたりの「**Get API key**」（日本語なら「APIキーを取得」）をクリック
4. 「**Create API key**」ボタンを押す
   - プロジェクトを聞かれたら「Create API key in new project」でOK
5. `AIza...` で始まる長い文字列が表示される。これがAPIキー。
   **コピーしてメモ帳などに一時保存**（この画面を閉じると再表示できないことがある）

> 💡 このキーは「Googleに対する自分の身分証」。他人に見せない・SNSに貼らない。
> 無料枠は 1日あたり数百リクエスト程度（gemini-2.5-flash）。このゲームの用途なら十分。

## ② Cloudflare Pagesにキーを登録する

1. **https://dash.cloudflare.com/** を開いてログイン
2. 左メニューの「**Workers & Pages**」をクリック
3. 一覧から「**haiken-chihan**」をクリック
4. 上のタブから「**設定 (Settings)**」→「**変数とシークレット (Variables and Secrets)**」を開く
5. 「**追加 (Add)**」ボタンを押して、次のとおり入力:
   - タイプ: **シークレット (Secret)** を選ぶ
   - 変数名: `GEMINI_API_KEY` （←この綴りを正確に。コピペ推奨）
   - 値: ①でコピーした `AIza...` の文字列を貼り付け
6. 「**保存 (Save)**」を押す
7. **ここ重要**: 保存しただけでは反映されません。「**デプロイ (Deployments)**」タブを開き、
   最新のデプロイの「…」メニューから「**再デプロイ (Retry deployment / Redeploy)**」を実行
   （または、なにかコミットして git push すれば自動で反映されます）

## ③ 動作確認

1. https://haiken-chihan.pages.dev/ でゲームを進めて藩を1つ確定する
2. AI講評が数秒で表示されれば成功 🎉
3. エラーが出る場合:
   - 変数名が `GEMINI_API_KEY` と一字一句合っているか確認
   - ②-7の再デプロイを忘れていないか確認
   - キーの前後に余計なスペースが入っていないか確認

---

## 補足（読まなくてもOK）

- 使用モデルは `gemini-2.5-flash`（無料枠あり）。変えたい場合は Cloudflare の変数に
  `GEMINI_MODEL` を追加して `gemini-3-flash-preview` などのモデル名を入れる
- 以前の `ANTHROPIC_API_KEY` はもう使いません。設定済みなら削除してOK
- 仕組み: ブラウザ → `/api/ai`（Cloudflare上の中継役）→ Gemini API。
  キーはCloudflare側にだけ保存され、ブラウザには一切渡らないので安全
