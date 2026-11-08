/**
 * シートの読み書き（一括処理のみ）
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

/** 「=」で始まる文字列が数式として解釈されないようにする */
function toCellText_(s) {
  s = String(s == null ? '' : s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/** toCellText_ で付けた先頭のアポストロフィが残っていた場合に取り除く */
function fromCellText_(v) {
  const s = String(v == null ? '' : v);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

/** リポジトリ一覧をシートに書き込む（シートは作り直す） */
function writeRepos_(ss, repos) {
  let sheet = ss.getSheetByName(CONFIG.sheetName);
  if (!sheet) sheet = ss.insertSheet(CONFIG.sheetName);

  sheet.clear();
  sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());
  sheet.clearConditionalFormatRules();

  const cols = CONFIG.columns;
  const header = cols.map(c => c.label);
  const values = repos.map(r =>
    cols.map(c => {
      if (c.key === 'original') return toCellText_(r.description);
      if (c.key === 'description') return toCellText_(r.description);
      if (c.key === 'archived' || c.key === 'admin') return r[c.key] ? '○' : '';
      if (c.key === 'result') return '';
      return r[c.key];
    })
  );

  sheet.getRange(1, 1, 1, cols.length).setValues([header])
    .setFontWeight('bold').setBackground('#f1f3f4');
  if (values.length > 0) {
    const descCols = [columnIndex_('description'), columnIndex_('original'), columnIndex_('fullName')];
    descCols.forEach(i => sheet.getRange(2, i + 1, values.length, 1).setNumberFormat('@'));
    sheet.getRange(2, 1, values.length, cols.length).setValues(values);
    sheet.getRange(2, columnIndex_('pushedAt') + 1, values.length, 1).setNumberFormat('yyyy/MM/dd HH:mm');
  }

  formatSheet_(sheet, Math.max(values.length, 1));
}

/** 見た目とガード（編集可能列の色分け・変更行のハイライト・他列の保護） */
function formatSheet_(sheet, rowCount) {
  const cols = CONFIG.columns;
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(columnIndex_('fullName') + 1);
  cols.forEach((c, i) => {
    sheet.setColumnWidth(i + 1, c.width);
    if (c.hidden) sheet.hideColumns(i + 1);
  });

  const descCol = columnIndex_('description') + 1;
  const origCol = columnIndex_('original') + 1;
  const descRange = sheet.getRange(2, descCol, rowCount, 1);
  descRange.setWrap(true);
  sheet.getRange(1, descCol).setBackground('#e8f0fe');

  // 取得時から変更された説明セルを黄色にする
  const descA1 = sheet.getRange(2, descCol).getA1Notation().replace(/\d+$/, '');
  const origA1 = sheet.getRange(2, origCol).getA1Notation().replace(/\d+$/, '');
  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=TRIM($' + descA1 + '2)<>TRIM($' + origA1 + '2)')
    .setBackground('#fff4c2')
    .setRanges([descRange])
    .build();
  sheet.setConditionalFormatRules([rule]);

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
      row.description = fromCellText_(row.description);
      row.original = fromCellText_(row.original);
      row.fullName = String(row.fullName);
      row.archived = row.archived === '○';
      row.admin = row.admin === '○';
      return row;
    })
    .filter(r => r.fullName);
}

/** 説明・取得時の説明・反映結果の3列を一括で書き戻す */
function writeBack_(sheet, rows) {
  const keys = ['description', 'original', 'result'];
  keys.forEach(key => {
    const col = columnIndex_(key) + 1;
    const vals = rows.map(r => [key === 'result' ? r.result || '' : toCellText_(r[key])]);
    sheet.getRange(2, col, vals.length, 1).setValues(vals);
  });
}
