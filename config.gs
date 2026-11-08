/**
 * 設定・定数
 * シート構成はここで定義し、コード中で列番号をハードコードしない。
 */
const CONFIG = {
  sheetName: 'リポジトリ',

  // Script Properties のキー
  props: {
    token: 'GITHUB_TOKEN',   // GitHub の Personal Access Token
    target: 'GITHUB_TARGET', // 空 = 自分のリポジトリ / 文字列 = Organization 名
  },

  github: {
    apiBase: 'https://api.github.com',
    apiVersion: '2022-11-28',
    perPage: 100,
    maxDescriptionLength: 350, // GitHub の説明文の上限
    batchSize: 20,             // 一度に並列送信する更新リクエスト数
  },

  // 列定義（並び順＝シート上の並び順）。key でコードから参照する。
  columns: [
    { key: 'selected',    label: '選択',           width: 50,  editable: true, checkbox: true },
    { key: 'id',        label: 'ID',             width: 90 },
    { key: 'fullName',    label: 'リポジトリ',     width: 260 },
    { key: 'description', label: '説明（編集可）', width: 420, editable: true },
    { key: 'visibility',  label: '公開範囲',       width: 80 },
    { key: 'archived',    label: 'アーカイブ',     width: 80 },
    { key: 'admin',       label: '編集権限',       width: 80 },
    { key: 'url',         label: 'URL',            width: 280 },
    { key: 'pushedAt',    label: '最終プッシュ',   width: 140 },
    { key: 'result',      label: '反映結果',       width: 260 },
    { key: 'original',    label: '_取得時の説明',  width: 200, hidden: true },
  ],
};
