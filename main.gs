/**
 * エントリポイント：スプレッドシートのメニュー
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('GitHub')
    .addItem('リポジトリ一覧を取得', 'menuFetchRepos')
    .addItem('説明の変更を GitHub に反映', 'menuApplyDescriptions')
    .addSeparator()
    .addItem('初期設定（トークン・取得対象）', 'menuSetup')
    .addToUi();
}

/** 初期設定：トークンと取得対象を Script Properties に保存する */
function menuSetup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const hasToken = !!props.getProperty(CONFIG.props.token);
  const tokenRes = ui.prompt(
    'GitHub トークン',
    (hasToken ? '設定済みです。変更する場合のみ入力してください（空欄で現状維持）。\n\n' : '') +
      'Personal Access Token を入力してください。\n' +
      '・Fine-grained: Repository permissions の「Administration: Read and write」と「Metadata: Read」\n' +
      '・Classic: 「repo」スコープ（公開リポジトリだけなら「public_repo」）',
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenRes.getSelectedButton() !== ui.Button.OK) return;
  const token = tokenRes.getResponseText().trim();
  if (token) props.setProperty(CONFIG.props.token, token);
  if (!token && !hasToken) {
    ui.alert('トークンが未入力のため、設定を中断しました。');
    return;
  }

  const current = props.getProperty(CONFIG.props.target) || '';
  const targetRes = ui.prompt(
    '取得対象',
    '自分が所有するリポジトリを取得する場合は空欄のまま OK。\n' +
      'Organization のリポジトリを取得する場合は Organization 名を入力してください。\n\n' +
      '現在の設定：' + (current || '（自分のリポジトリ）'),
    ui.ButtonSet.OK_CANCEL
  );
  if (targetRes.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty(CONFIG.props.target, targetRes.getResponseText().trim());

  // 接続確認
  try {
    const login = getAuthenticatedLogin_();
    ui.alert('設定を保存しました。\nGitHub ユーザー「' + login + '」として接続できました。');
  } catch (e) {
    ui.alert('設定は保存しましたが、接続確認に失敗しました。\n' + e.message);
  }
}

/** メニュー：リポジトリ一覧を取得してシートを作り直す */
function menuFetchRepos() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 未反映の編集があれば上書き前に確認する
  const sheet = ss.getSheetByName(CONFIG.sheetName);
  if (sheet) {
    const pending = readRows_(sheet).filter(isChanged_).length;
    if (pending > 0) {
      const res = ui.alert(
        '未反映の変更があります',
        pending + ' 件の説明が GitHub に未反映です。取得し直すとこの変更は失われます。続けますか？',
        ui.ButtonSet.YES_NO
      );
      if (res !== ui.Button.YES) return;
    }
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    ui.alert('他の処理が実行中です。少し待ってから再度お試しください。');
    return;
  }
  try {
    ss.toast('GitHub からリポジトリ一覧を取得しています…', 'GitHub', -1);
    const repos = listRepos_();
    writeRepos_(ss, repos);
    ss.toast(repos.length + ' 件のリポジトリを取得しました。', 'GitHub', 5);
  } catch (e) {
    console.error(e);
    ss.toast('', 'GitHub', 1);
    ui.alert('取得に失敗しました。\n' + e.message);
  } finally {
    lock.releaseLock();
  }
}

/** メニュー：説明を変更した行だけ GitHub に反映する */
function menuApplyDescriptions() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.sheetName);
  if (!sheet) {
    ui.alert('先に「リポジトリ一覧を取得」を実行してください。');
    return;
  }

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    ui.alert('他の処理が実行中です。少し待ってから再度お試しください。');
    return;
  }
  try {
    const rows = readRows_(sheet);
    const changed = rows.filter(isChanged_);
    if (changed.length === 0) {
      ui.alert('変更された説明はありません。\n「説明（編集可）」列を書き換えてから実行してください。');
      return;
    }

    const preview = changed.slice(0, 10).map(r => '・' + r.fullName + '\n    → ' + (normalizeDescription_(r.description) || '（空にする）')).join('\n');
    const res = ui.alert(
      '説明を ' + changed.length + ' 件更新します',
      preview + (changed.length > 10 ? '\n…ほか ' + (changed.length - 10) + ' 件' : '') + '\n\nGitHub に反映しますか？',
      ui.ButtonSet.YES_NO
    );
    if (res !== ui.Button.YES) return;

    ss.toast('GitHub に反映しています…', 'GitHub', -1);
    const summary = applyDescriptions_(changed);
    writeBack_(sheet, rows);
    ss.toast('', 'GitHub', 1);
    ui.alert(
      '反映が完了しました',
      '成功：' + summary.ok + ' 件\n失敗・スキップ：' + summary.ng + ' 件' +
        (summary.ng > 0 ? '\n\n失敗した行は「反映結果」列に理由を記載しています。' : ''),
      ui.ButtonSet.OK
    );
  } catch (e) {
    console.error(e);
    ss.toast('', 'GitHub', 1);
    ui.alert('反映中にエラーが発生しました。\n' + e.message);
  } finally {
    lock.releaseLock();
  }
}
