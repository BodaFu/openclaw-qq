export function renderAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QQ 管理</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f0f0f;
    color: #e0e0e0;
    min-height: 100vh;
  }
  .container { max-width: 720px; margin: 0 auto; padding: 32px 20px; }
  header {
    display: flex; align-items: center; gap: 16px;
    margin-bottom: 32px; padding-bottom: 20px;
    border-bottom: 1px solid #2a2a2a;
  }
  .bot-avatar {
    width: 48px; height: 48px; border-radius: 12px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 700; color: #fff;
  }
  .bot-info h1 { font-size: 20px; font-weight: 600; color: #f0f0f0; }
  .bot-info p { font-size: 13px; color: #888; margin-top: 2px; }
  .status-dot {
    display: inline-block; width: 8px; height: 8px;
    border-radius: 50%; margin-right: 6px; vertical-align: middle;
  }
  .status-dot.online { background: #22c55e; }
  .status-dot.offline { background: #ef4444; }

  .section-title {
    font-size: 13px; font-weight: 600; color: #888;
    text-transform: uppercase; letter-spacing: 0.5px;
    margin-bottom: 12px; margin-top: 28px;
  }
  .section-title:first-of-type { margin-top: 0; }

  /* Settings cards */
  .settings-card {
    background: #1a1a1a; border-radius: 12px;
    border: 1px solid #2a2a2a; margin-bottom: 12px;
    overflow: hidden;
  }
  .setting-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid #222;
  }
  .setting-row:last-child { border-bottom: none; }
  .setting-label { font-size: 14px; color: #ccc; }
  .setting-hint { font-size: 12px; color: #666; margin-top: 3px; }

  /* Select */
  .setting-select {
    background: #2a2a2a; color: #e0e0e0; border: 1px solid #3a3a3a;
    border-radius: 8px; padding: 6px 12px; font-size: 13px;
    cursor: pointer; outline: none;
  }
  .setting-select:focus { border-color: #6366f1; }

  /* Toggle switch */
  .toggle { position: relative; width: 44px; height: 24px; flex-shrink: 0; margin-left: 16px; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle .slider {
    position: absolute; inset: 0; cursor: pointer;
    background: #333; border-radius: 24px; transition: background 0.2s;
  }
  .toggle .slider::before {
    content: ""; position: absolute; width: 18px; height: 18px;
    left: 3px; bottom: 3px; background: #fff; border-radius: 50%;
    transition: transform 0.2s;
  }
  .toggle input:checked + .slider { background: #6366f1; }
  .toggle input:checked + .slider::before { transform: translateX(20px); }
  .toggle input:disabled + .slider { cursor: not-allowed; opacity: 0.5; }

  /* Number input */
  .setting-number {
    background: #2a2a2a; color: #e0e0e0; border: 1px solid #3a3a3a;
    border-radius: 8px; padding: 6px 12px; font-size: 13px;
    width: 80px; text-align: center; outline: none;
  }
  .setting-number:focus { border-color: #6366f1; }

  /* Group list */
  .group-list { display: flex; flex-direction: column; gap: 8px; }
  .group-card {
    background: #1a1a1a; border-radius: 12px;
    border: 1px solid #2a2a2a; transition: border-color 0.15s;
    overflow: hidden;
  }
  .group-card:hover { border-color: #3a3a3a; }
  .group-card.disabled { opacity: 0.5; }
  .group-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; cursor: pointer; user-select: none;
  }
  .group-meta { flex: 1; min-width: 0; }
  .group-name {
    font-size: 15px; font-weight: 500; color: #f0f0f0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .group-detail { font-size: 12px; color: #666; margin-top: 3px; }
  .group-badges { display: flex; gap: 6px; margin-left: 12px; flex-shrink: 0; }
  .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 10px;
    background: #2a2a2a; color: #888;
  }
  .badge.active { background: #1e293b; color: #60a5fa; }
  .group-expand {
    display: none; padding: 0 20px 14px;
    border-top: 1px solid #222;
  }
  .group-expand.open { display: block; padding-top: 12px; }
  .group-expand .setting-row { padding: 10px 0; border-bottom: 1px solid #1f1f1f; }
  .group-expand .setting-row:last-child { border-bottom: none; }

  .loading { text-align: center; padding: 60px 0; color: #666; font-size: 14px; }
  .error { text-align: center; padding: 40px 0; color: #ef4444; font-size: 14px; }
  .toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #22c55e; color: #fff; padding: 8px 20px; border-radius: 8px;
    font-size: 13px; opacity: 0; transition: opacity 0.3s; pointer-events: none;
    z-index: 100;
  }
  .toast.show { opacity: 1; }
  .toast.error { background: #ef4444; }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="bot-avatar">L</div>
    <div class="bot-info">
      <h1>QQ 管理</h1>
      <p id="bot-status"><span class="status-dot offline"></span>加载中...</p>
    </div>
  </header>

  <div class="section-title">全局设置</div>
  <div class="settings-card" id="global-settings">
    <div class="loading">加载中...</div>
  </div>

  <div class="section-title">群列表</div>
  <div id="group-list" class="group-list">
    <div class="loading">正在加载群列表...</div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
  const API = '/qq/admin/api';
  let _data = null;

  function showToast(msg, isError) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(function() { el.className = 'toast'; }, 2000);
  }

  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function toggleHtml(id, checked, onchange, label) {
    return '<label class="toggle">' +
      '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') +
      ' onchange="' + onchange + '">' +
      '<span class="slider"></span></label>';
  }

  function selectHtml(id, value, options, onchange) {
    var html = '<select class="setting-select" id="' + id + '" onchange="' + onchange + '">';
    for (var i = 0; i < options.length; i++) {
      var o = options[i];
      html += '<option value="' + o.value + '"' + (o.value === value ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }
    html += '</select>';
    return html;
  }

  function renderGlobal(g) {
    var dmOptions = [
      {value:'open', label:'开放'},
      {value:'pairing', label:'配对'},
      {value:'disabled', label:'关闭'}
    ];
    var gpOptions = [
      {value:'open', label:'开放'},
      {value:'allowlist', label:'白名单'},
      {value:'disabled', label:'关闭'}
    ];
    var html = '';
    html += '<div class="setting-row"><div><div class="setting-label">私聊策略</div>' +
      '<div class="setting-hint">控制 Bot 是否响应 QQ 私聊消息</div></div>' +
      selectHtml('g-dm', g.dmPolicy, dmOptions, "saveGlobal('dmPolicy',this.value)") + '</div>';
    html += '<div class="setting-row"><div><div class="setting-label">群聊策略</div>' +
      '<div class="setting-hint">控制 Bot 是否响应群聊消息</div></div>' +
      selectHtml('g-gp', g.groupPolicy, gpOptions, "saveGlobal('groupPolicy',this.value)") + '</div>';
    html += '<div class="setting-row"><div><div class="setting-label">默认需要 @</div>' +
      '<div class="setting-hint">群里是否必须 @Bot 才回复（各群可单独覆盖）</div></div>' +
      toggleHtml('g-rm', g.requireMention, "saveGlobal('requireMention',this.checked)") + '</div>';
    html += '<div class="setting-row"><div><div class="setting-label">旁听门控</div>' +
      '<div class="setting-hint">未被 @ 时，用 LLM 判断是否需要回复（各群可单独覆盖）</div></div>' +
      toggleHtml('g-pg', g.passiveGateEnabled, "saveGlobal('passiveGateEnabled',this.checked)") + '</div>';
    html += '<div class="setting-row"><div><div class="setting-label">消息聚合等待</div>' +
      '<div class="setting-hint">旁听模式下等待消息聚合的毫秒数</div></div>' +
      '<input type="number" class="setting-number" id="g-db" value="' + g.debounceMs +
      '" min="500" max="30000" step="500" onchange="saveGlobal(\\'debounceMs\\',Number(this.value))">' + '</div>';
    html += '<div class="setting-row"><div><div class="setting-label">上下文消息数</div>' +
      '<div class="setting-hint">发送给 Agent 的最近消息条数</div></div>' +
      '<input type="number" class="setting-number" id="g-hl" value="' + g.historyLimit +
      '" min="5" max="100" step="5" onchange="saveGlobal(\\'historyLimit\\',Number(this.value))">' + '</div>';
    document.getElementById('global-settings').innerHTML = html;
  }

  function renderGroups(groups) {
    if (!groups.length) {
      document.getElementById('group-list').innerHTML = '<div class="loading">暂无群聊</div>';
      return;
    }
    var html = groups.map(function(g) {
      var cls = g.enabled ? 'group-card' : 'group-card disabled';
      var badges = '';
      if (g.requireMention) badges += '<span class="badge active">需要@</span>';
      if (!g.passiveGateEnabled) badges += '<span class="badge">旁听关</span>';

      var expand = '';
      expand += '<div class="setting-row"><div><div class="setting-label">启用</div></div>' +
        toggleHtml('grp-en-' + g.groupId, g.enabled, "saveGroup('" + g.groupId + "','enabled',this.checked)") + '</div>';
      expand += '<div class="setting-row"><div><div class="setting-label">需要 @</div>' +
        '<div class="setting-hint">覆盖全局设置</div></div>' +
        toggleHtml('grp-rm-' + g.groupId, g.requireMention, "saveGroup('" + g.groupId + "','requireMention',this.checked)") + '</div>';
      expand += '<div class="setting-row"><div><div class="setting-label">旁听门控</div>' +
        '<div class="setting-hint">覆盖全局设置</div></div>' +
        toggleHtml('grp-pg-' + g.groupId, g.passiveGateEnabled, "saveGroup('" + g.groupId + "','passiveGateEnabled',this.checked)") + '</div>';

      return '<div class="' + cls + '" id="card-' + g.groupId + '">' +
        '<div class="group-header" onclick="toggleExpand(\\'' + g.groupId + '\\')">' +
          '<div class="group-meta">' +
            '<div class="group-name">' + esc(g.groupName) + '</div>' +
            '<div class="group-detail">' + g.groupId + ' · ' + g.memberCount + ' 人</div>' +
          '</div>' +
          '<div class="group-badges">' + badges + '</div>' +
        '</div>' +
        '<div class="group-expand" id="expand-' + g.groupId + '">' + expand + '</div>' +
      '</div>';
    }).join('');
    document.getElementById('group-list').innerHTML = html;
  }

  function toggleExpand(groupId) {
    var el = document.getElementById('expand-' + groupId);
    if (el) el.classList.toggle('open');
  }

  async function loadAll() {
    try {
      var res = await fetch(API + '/config');
      if (!res.ok) throw new Error(res.statusText);
      _data = await res.json();

      var statusEl = document.getElementById('bot-status');
      statusEl.innerHTML = '<span class="status-dot online"></span>' +
        esc(_data.botName) + ' (' + _data.botQQ + ')';

      renderGlobal(_data.global);
      renderGroups(_data.groups);
    } catch (err) {
      document.getElementById('global-settings').innerHTML =
        '<div class="error">加载失败: ' + esc(err.message) + '</div>';
      document.getElementById('group-list').innerHTML = '';
    }
  }

  async function saveGlobal(key, value) {
    var body = {};
    body[key] = value;
    try {
      var res = await fetch(API + '/global', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast('已保存');
      if (_data) _data.global[key] = value;
    } catch (err) {
      showToast('保存失败: ' + err.message, true);
      loadAll();
    }
  }

  async function saveGroup(groupId, key, value) {
    var body = {groupId: groupId};
    body[key] = value;
    try {
      var res = await fetch(API + '/group', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast('已保存');

      if (key === 'enabled') {
        var card = document.getElementById('card-' + groupId);
        if (card) card.className = value ? 'group-card' : 'group-card disabled';
      }
      if (_data) {
        var g = _data.groups.find(function(x) { return x.groupId === groupId; });
        if (g) g[key] = value;
      }
    } catch (err) {
      showToast('保存失败: ' + err.message, true);
      loadAll();
    }
  }

  loadAll();
</script>
</body>
</html>`;
}
