# GitHub リポジトリ説明 一括編集シート

Google スプレッドシートに GitHub のリポジトリ一覧を取り込み、シート上で書き換えた説明（Description）を GitHub に反映する Apps Script です。

## できること

- 自分が所有するリポジトリ、または指定した Organization のリポジトリを一覧で取得する
- 「説明（編集可）」列を書き換えると、そのセルが黄色になる（未反映の印）
- メニューから実行すると、書き換えた行だけを GitHub に送る
- 結果は「反映結果」列に残る。アーカイブ済み、編集権限なし、350 文字超えの行は送らずにスキップする

## シートの列

| 列 | 内容 |
|---|---|
| ID / リポジトリ | GitHub のリポジトリ ID と `owner/name` |
| **説明（編集可）** | ここだけを書き換える |
| 公開範囲 / アーカイブ / 編集権限 | 取得時の状態 |
| URL / 最終プッシュ | 参考情報 |
| 反映結果 | 最後に反映した日時、または失敗・スキップの理由 |
| _取得時の説明（非表示） | 変更を判定するための元の値。触らないでください |

「説明（編集可）」以外の列には警告付きの保護がかかっています。誤って編集しようとすると確認が出ます。

## セットアップ

### 1. GitHub のトークンを作る

GitHub の Settings → Developer settings → Personal access tokens で作成します。

- **Fine-grained token（推奨）**
  - Repository access：対象のリポジトリ（すべて、または選択）
  - Repository permissions：`Administration: Read and write`、`Metadata: Read-only`
  - Organization のリポジトリを扱う場合は、Resource owner にその Organization を選ぶ
- **Classic token**：`repo` スコープ（公開リポジトリだけなら `public_repo`）

### 2. スプレッドシートにスクリプトを入れる

1. 新しい Google スプレッドシートを作る
2. 「拡張機能」→「Apps Script」を開く
3. 次の 4 ファイルを作り、同名ファイルの中身を貼り付ける
   `config.gs` / `main.gs` / `service_github.gs` / `repo_sheet.gs`
4. 「プロジェクトの設定」で「appsscript.json マニフェスト ファイルをエディタで表示する」をオンにし、`appsscript.json` の中身を貼り付ける
5. 保存してスプレッドシートを再読み込みすると、メニューに「GitHub」が出る

#### clasp を使う場合

`.clasp.json` は各自の環境ごとに異なるため、Git では管理していません（`.gitignore` に記載）。`.clasp.json.example` をコピーして `.clasp.json` を作り、`scriptId` を、スクリプトを入れたいスプレッドシートの Apps Script のスクリプト ID に書き換えてから push します。スクリプト ID は Apps Script エディタの「プロジェクトの設定」で確認できます。

```bash
npm install -g @google/clasp
cp .clasp.json.example .clasp.json
clasp login
clasp push
```

push の対象は `.gs` ファイルと `appsscript.json` だけです（`.claspignore` で指定）。

スプレッドシートを新しく作る場合は、`.clasp.json` を作らずに `clasp create --type sheets --title "GitHub リポジトリ管理" --rootDir .` を実行すると、スプレッドシートと `.clasp.json` が作られます。

### 3. 初期設定

1. 「GitHub」→「初期設定（トークン・取得対象）」を実行する（初回は Google の承認画面が出る）
2. トークンを入力する
3. 取得対象を入力する。自分のリポジトリなら空欄、Organization なら Organization 名
4. 「GitHub ユーザー〇〇として接続できました」と出れば完了

トークンは Script Properties に保存され、シートには書かれません。入力ダイアログには入力中の文字がそのまま表示されるので、画面共有中は避けてください。

## 使い方

1. 「GitHub」→「リポジトリ一覧を取得」
2. 「説明（編集可）」列を書き換える（変更したセルは黄色になる）
3. 「GitHub」→「説明の変更を GitHub に反映」で、確認ダイアログの内容を見て「はい」

一覧を取得し直すとシートは作り直されます。未反映の変更が残っている場合は、取得前に確認が出ます。

## 注意点

- 説明内の改行はスペースに置き換えて送ります
- 説明を空欄にすると、GitHub 側の説明も空になります
- 取得後にリポジトリ名が変わった場合、そのリポジトリの更新は失敗します。一覧を取得し直してください
- 自分のリポジトリは「自分が所有するもの」だけを取得します（コラボレーターとして参加しているものは含みません）
