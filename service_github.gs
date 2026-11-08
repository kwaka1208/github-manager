/**
 * GitHub API とのやり取り
 */

function getToken_() {
  const token = PropertiesService.getScriptProperties().getProperty(CONFIG.props.token);
  if (!token) throw new Error('GitHub トークンが未設定です。メニュー「GitHub > 初期設定」から設定してください。');
  return token;
}

function buildRequest_(method, url, payload) {
  const req = {
    url: url,
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + getToken_(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': CONFIG.github.apiVersion,
    },
  };
  if (payload !== undefined) {
    req.contentType = 'application/json';
    req.payload = JSON.stringify(payload);
  }
  return req;
}

function errorMessage_(res) {
  const code = res.getResponseCode();
  let detail = '';
  try {
    detail = JSON.parse(res.getContentText()).message || '';
  } catch (e) {
    detail = res.getContentText().slice(0, 200);
  }
  const hints = {
    401: 'トークンが無効か期限切れです',
    403: '権限不足、またはAPIの利用上限に達しています',
    404: 'リポジトリが見つからないか、トークンに権限がありません',
    422: '入力内容が GitHub に受け付けられませんでした',
  };
  return 'HTTP ' + code + (hints[code] ? '（' + hints[code] + '）' : '') + (detail ? '：' + detail : '');
}

/** 接続確認用：トークンの持ち主のログイン名を返す */
function getAuthenticatedLogin_() {
  const res = UrlFetchApp.fetch(CONFIG.github.apiBase + '/user', buildRequest_('get', CONFIG.github.apiBase + '/user'));
  if (res.getResponseCode() !== 200) throw new Error(errorMessage_(res));
  return JSON.parse(res.getContentText()).login;
}

/** 取得対象（自分 or Organization）のリポジトリを全件取得する */
function listRepos_() {
  const target = PropertiesService.getScriptProperties().getProperty(CONFIG.props.target) || '';
  const base = CONFIG.github.apiBase;
  let url = target
    ? base + '/orgs/' + encodeURIComponent(target) + '/repos?type=all&per_page=' + CONFIG.github.perPage
    : base + '/user/repos?affiliation=owner&per_page=' + CONFIG.github.perPage;

  const repos = [];
  while (url) {
    const res = UrlFetchApp.fetch(url, buildRequest_('get', url));
    if (res.getResponseCode() !== 200) throw new Error(errorMessage_(res));
    repos.push(...JSON.parse(res.getContentText()));
    url = nextPageUrl_(res.getHeaders());
  }

  return repos
    .map(r => ({
      id: r.id,
      fullName: r.full_name,
      description: r.description || '',
      visibility: r.visibility || (r.private ? 'private' : 'public'),
      archived: !!r.archived,
      admin: !!(r.permissions && r.permissions.admin),
      url: r.html_url,
      pushedAt: r.pushed_at ? new Date(r.pushed_at) : '',
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Link ヘッダーから次ページの URL を取り出す */
function nextPageUrl_(headers) {
  const link = headers.Link || headers.link || '';
  const m = link.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

/**
 * 変更行の説明を GitHub に反映する。
 * rows の各要素の original / result を書き換える（呼び出し側でシートに書き戻す）。
 */
function applyDescriptions_(rows) {
  const summary = { ok: 0, ng: 0 };
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');

  // 送信前の検証。送れない行はここで結果を確定させる
  const targets = [];
  rows.forEach(r => {
    const desc = normalizeDescription_(r.description);
    if (r.archived) {
      r.result = 'スキップ：アーカイブ済みのため変更できません';
    } else if (!r.admin) {
      r.result = 'スキップ：このリポジトリの編集権限がありません';
    } else if (desc.length > CONFIG.github.maxDescriptionLength) {
      r.result = 'スキップ：' + CONFIG.github.maxDescriptionLength + ' 文字以内にしてください（現在 ' + desc.length + ' 文字）';
    } else {
      targets.push({ row: r, desc: desc });
      return;
    }
    summary.ng++;
  });

  // まとめて並列送信（fetchAll）
  for (let i = 0; i < targets.length; i += CONFIG.github.batchSize) {
    const chunk = targets.slice(i, i + CONFIG.github.batchSize);
    const requests = chunk.map(t =>
      buildRequest_('patch', CONFIG.github.apiBase + '/repos/' + t.row.fullName, { description: t.desc })
    );
    const responses = UrlFetchApp.fetchAll(requests);
    responses.forEach((res, j) => {
      const r = chunk[j].row;
      if (res.getResponseCode() === 200) {
        const saved = JSON.parse(res.getContentText()).description || '';
        r.description = saved;
        r.original = saved;
        r.result = '反映済み（' + stamp + '）';
        summary.ok++;
      } else {
        r.result = '失敗：' + errorMessage_(res);
        summary.ng++;
      }
    });
  }
  return summary;
}
