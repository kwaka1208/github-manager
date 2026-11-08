/**
 * エントリポイント：スプレッドシートのメニュー
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('GitHub')
    .addItem('リポジトリ一覧を取得', 'menuFetchRepos')
    .addItem('説明の変更を GitHub に反映', 'menuApplyDescriptions')
    .addSeparator()
    .addItem('チェックしたリポジトリをアーカイブ', 'menuArchiveSelected')
    .addItem('チェックしたリポジトリを削除…', 'menuDeleteSelected')
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
      '・Classic: 「repo」スコープ（公開リポジトリだけなら「public_repo」）。削除も使う場合は「delete_repo」も',
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

/**
 * ロックを取ってから処理を実行する共通ラッパー。
 * 例外はダイアログで知らせ、ログに残す。
 */
function withLock_(label, fn) {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) {
    ui.alert('他の処理が実行中です。少し待ってから再度お試しください。');
    return;
  }
  try {
    fn(ui, ss);
  } catch (e) {
    console.error(e);
    ss.toast('', 'GitHub', 1);
    ui.alert(label + 'に失敗しました。\n' + e.message);
  } finally {
    lock.releaseLock();
  }
}

/** リポジトリ一覧シートを返す。未作成なら案内して null */
function getRepoSheet_(ui, ss) {
  const sheet = ss.getSheetByName(CONFIG.sheetName);
  if (!sheet) ui.alert('先に「リポジトリ一覧を取得」を実行してください。');
  return sheet;
}

/** 名前の一覧を、最大 limit 件まで箇条書きにする */
function listNames_(rows, limit) {
  return rows.slice(0, limit).map(r => '・' + r.fullName).join('\n') +
    (rows.length > limit ? '\n…ほか ' + (rows.length - limit) + ' 件' : '');
}

function showSummary_(ui, title, summary) {
  ui.alert(
    title,
    '成功：' + summary.ok + ' 件\n失敗・スキップ：' + summary.ng + ' 件' +
      (summary.ng > 0 ? '\n\n失敗・スキップした行は「反映結果」列に理由を記載しています。' : ''),
    ui.ButtonSet.OK
  );
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

  withLock_('取得', (ui, ss) => {
    ss.toast('GitHub からリポジトリ一覧を取得しています…', 'GitHub', -1);
    const repos = listRepos_();
    writeRepos_(ss, repos);
    ss.toast(repos.length + ' 件のリポジトリを取得しました。', 'GitHub', 5);
  });
}

/** メニュー：説明を変更した行だけ GitHub に反映する */
function menuApplyDescriptions() {
  withLock_('説明の反映', (ui, ss) => {
    const sheet = getRepoSheet_(ui, ss);
    if (!sheet) return;

    const rows = readRows_(sheet);
    const changed = rows.filter(isChanged_);
    if (changed.length === 0) {
      ui.alert('変更された説明はありません。\n「説明（編集可）」列を書き換えてから実行してください。');
      return;
    }

    const preview = changed.slice(0, 10)
      .map(r => '・' + r.fullName + '\n    → ' + (normalizeDescription_(r.description) || '（空にする）'))
      .join('\n');
    const res = ui.alert(
      '説明を ' + changed.length + ' 件更新します',
      preview + (changed.length > 10 ? '\n…ほか ' + (changed.length - 10) + ' 件' : '') + '\n\nGitHub に反映しますか？',
      ui.ButtonSet.YES_NO
    );
    if (res !== ui.Button.YES) return;

    ss.toast('GitHub に反映しています…', 'GitHub', -1);
    const summary = applyDescriptions_(changed);
    writeRows_(sheet, rows);
    ss.toast('', 'GitHub', 1);
    showSummary_(ui, '説明の反映が完了しました', summary);
  });
}

/** メニュー：チェックした行をアーカイブする */
function menuArchiveSelected() {
  withLock_('アーカイブ', (ui, ss) => {
    const sheet = getRepoSheet_(ui, ss);
    if (!sheet) return;

    const rows = readRows_(sheet);
    const selected = rows.filter(r => r.selected);
    if (selected.length === 0) {
      ui.alert('チェックされたリポジトリがありません。\n「選択」列にチェックを入れてから実行してください。');
      return;
    }

    const res = ui.alert(
      selected.length + ' 件のリポジトリをアーカイブします',
      listNames_(selected, 20) +
        '\n\nアーカイブすると読み取り専用になります（GitHub の Settings からいつでも解除できます）。続けますか？',
      ui.ButtonSet.YES_NO
    );
    if (res !== ui.Button.YES) return;

    ss.toast('アーカイブしています…', 'GitHub', -1);
    const summary = archiveRepos_(selected);
    selected.forEach(r => { r.selected = false; }); // 誤操作防止のため、結果に関わらずチェックを外す
    writeRows_(sheet, rows);
    ss.toast('', 'GitHub', 1);
    showSummary_(ui, 'アーカイブが完了しました', summary);
  });
}

/** メニュー：チェックした行のリポジトリを削除する（件数の入力で確認） */
function menuDeleteSelected() {
  withLock_('削除', (ui, ss) => {
    const sheet = getRepoSheet_(ui, ss);
    if (!sheet) return;

    const rows = readRows_(sheet);
    const selected = rows.filter(r => r.selected);
    if (selected.length === 0) {
      ui.alert('チェックされたリポジトリがありません。\n「選択」列にチェックを入れてから実行してください。');
      return;
    }

    const res = ui.prompt(
      '⚠ ' + selected.length + ' 件のリポジトリを完全に削除します',
      listNames_(selected, 20) +
        '\n\n削除したリポジトリは、コード・Issue・Pull Request・Wiki などを含めてすべて消え、元に戻せません。\n' +
        '本当に削除する場合は、削除する件数「' + selected.length + '」を半角数字で入力してください。',
      ui.ButtonSet.OK_CANCEL
    );
    if (res.getSelectedButton() !== ui.Button.OK) return;
    if (res.getResponseText().trim() !== String(selected.length)) {
      ui.alert('入力された件数が一致しないため、削除を中止しました。');
      return;
    }

    ss.toast('削除しています…', 'GitHub', -1);
    const summary = deleteRepos_(selected);
    selected.forEach(r => { r.selected = false; }); // 誤操作防止のため、結果に関わらずチェックを外す
    writeRows_(sheet, rows.filter(r => !r.deleted));
    ss.toast('', 'GitHub', 1);
    showSummary_(ui, '削除が完了しました', summary);
  });
}
