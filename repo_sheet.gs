/**
 * シートの読み書き（一括処理のみ）
 *
 * シートの1行 = 行オブジェクト（キーは CONFIG.columns の key）。
 * 読み込みは readRows_、書き込みは writeRows_ でまとめて行う。
 */

function columnIndex_(key) {
  const i = CONFIG.columns.findIndex(c => c.key === key);
  if (i < 0) throw new Error('列定義がありません：' + key);
  return i;
}

/** 説明文の正規化：改行をスペースに、前後の空白を除去 */
function normalizeDescription_(s) {
  return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
}

/** 説明が取得時から変わっているか */
function isChanged_(row) {
  return normalizeDescription_(row.description) !== normalizeDescription_(row.original);
}

/** 「=」などで始まる文字列が数式として解釈されないようにする */
function toCellText_(s) {
  s = String(s == null ? '' : s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** toCellText_ で付けた先頭のアポストロフィが残っていた場合に取り除く */
function fromCellText_(v) {
  const s = String(v == null ? '' : v);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

/** 行オブジェクト → シートの1行分の値 */
function rowToValues_(row) {
  return CONFIG.columns.map(c => {
    switch (c.key) {
      case 'selected':    return row.selected === true;
      case 'description':
      case 'original':    return toCellText_(row[c.key]);
      case 'archived':
      case 'admin':       return row[c.key] ? '○' : '';
      default:            return row[c.key] == null ? '' : row[c.key];
    }
  });
}

/** リポジトリ一覧でシートを作り直す */
function writeRepos_(ss, repos) {
  let sheet = ss.getSheetByName(CONFIG.sheetName);
  if (!sheet) sheet = ss.insertSheet(CONFIG.sheetName);

  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());
  sheet.clearConditionalFormatRules();

  const cols = CONFIG.columns;
  sheet.getRange(1, 1, 1, cols.length).setValues([cols.map(c => c.label)])
    .setFontWeight('bold').setBackground('#f1f3f4');

  const rows = repos.map(r => Object.assign({}, r, { selected: false, original: r.description, result: '' }));
  writeRows_(sheet, rows);
  formatSheet_(sheet, Math.max(rows.length, 1));
}

/**
 * 行オブジェクトの配列でデータ部分を丸ごと書き直す。
 * 行が減った場合（削除後）は余った行を空にする。
 */
function writeRows_(sheet, rows) {
  const cols = CONFIG.columns;
  const oldCount = Math.max(sheet.getLastRow() - 1, 0);

  if (rows.length > 0) {
    ['description', 'original', 'fullName'].forEach(key =>
      sheet.getRange(2, columnIndex_(key) + 1, rows.length, 1).setNumberFormat('@')
    );
    sheet.getRange(2, columnIndex_('selected') + 1, rows.length, 1).insertCheckboxes();
    sheet.getRange(2, 1, rows.length, cols.length).setValues(rows.map(rowToValues_));
    sheet.getRange(2, columnIndex_('pushedAt') + 1, rows.length, 1).setNumberFormat('yyyy/MM/dd HH:mm');
  }

  if (oldCount > rows.length) {
    const rest = sheet.getRange(rows.length + 2, 1, oldCount - rows.length, cols.length);
    rest.clearContent();
    rest.clearDataValidations();
  }
}

/** 見た目とガード（編集可能列の色分け・変更行のハイライト・他列の保護） */
function formatSheet_(sheet, rowCount) {
  const cols = CONFIG.columns;
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(columnIndex_('fullName') + 1);
  cols.forEach((c, i) => {
    sheet.setColumnWidth(i + 1, c.width);
    if (c.hidden) sheet.hideColumns(i + 1);
    if (c.editable) sheet.getRange(1, i + 1).setBackground('#e8f0fe');
  });
  sheet.getRange(1, columnIndex_('selected') + 1, rowCount + 1, 1).setHorizontalAlignment('center');

  const descCol = columnIndex_('description') + 1;
  const origCol = columnIndex_('original') + 1;
  const selCol = columnIndex_('selected') + 1;
  const descRange = sheet.getRange(2, descCol, rowCount, 1);
  descRange.setWrap(true);

  const letter = col => sheet.getRange(1, col).getA1Notation().replace(/\d+$/, '');
  const descA1 = letter(descCol);
  const origA1 = letter(origCol);
  const selA1 = letter(selCol);

  const rules = [
    // チェックした行は全体を薄い赤にする
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + selA1 + '2=TRUE')
      .setBackground('#fde7e9')
      .setRanges([sheet.getRange(2, 1, rowCount, cols.length)])
      .build(),
    // 取得時から変更された説明セルを黄色にする
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=TRIM($' + descA1 + '2)<>TRIM($' + origA1 + '2)')
      .setBackground('#fff4c2')
      .setRanges([descRange])
      .build(),
  ];
  sheet.setConditionalFormatRules(rules);

  // 長さの入力規則（超えたら警告表示）
  const validation = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=LEN(' + descA1 + '2)<=' + CONFIG.github.maxDescriptionLength)
    .setAllowInvalid(true)
    .setHelpText(CONFIG.github.maxDescriptionLength + ' 文字以内で入力してください')
    .build();
  descRange.setDataValidation(validation);

  // 編集不可の列は「警告のみ」の保護をかける（誤編集の防止）
  cols.forEach((c, i) => {
    if (c.editable) return;
    sheet.getRange(1, i + 1, rowCount + 1, 1).protect()
      .setDescription('GitHub から取得した値です（編集しても反映されません）')
      .setWarningOnly(true);
  });
}

/** シート全体を行オブジェクトとして読む */
function readRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, CONFIG.columns.length).getValues();
  return values
    .map(v => {
      const row = {};
      CONFIG.columns.forEach((c, i) => { row[c.key] = v[i]; });
      row.selected = row.selected === true;
      row.description = fromCellText_(row.description);
      row.original = fromCellText_(row.original);
      row.fullName = String(row.fullName);
      row.archived = row.archived === '○';
      row.admin = row.admin === '○';
      return row;
    })
    .filter(r => r.fullName);
}
