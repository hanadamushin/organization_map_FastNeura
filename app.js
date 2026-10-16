'use strict';
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'fastneura.organization-map.v1';
let members = [], editingId = null, zoom = 1, toastTimer;
let cloud, userId = null, revision = null, busy = false, dirty = false, stale = false, generation = 0, polling = false;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4500); }
function confirmAction(title, message, label) {
  return new Promise(resolve => {
    const dialog = $('confirm-dialog');
    $('confirm-title').textContent = title; $('confirm-text').textContent = message; $('confirm-ok').textContent = label;
    dialog.returnValue = 'cancel';
    $('confirm-cancel').onclick = () => dialog.close('cancel');
    $('confirm-ok').onclick = () => dialog.close('ok');
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), {once:true});
    dialog.showModal();
    $('confirm-cancel').focus();
  });
}
function setBusy(value) {
  busy = value;
  document.querySelector('.workspace').inert = value;
  document.querySelector('.workspace').setAttribute('aria-busy', String(value));
  for (const id of ['import-btn','legacy-btn','refresh-btn']) $(id).disabled = value;
}
async function persist(next) {
  if (!userId || revision === null) throw new Error('ログインして共有データを取得してください。');
  if (busy) throw new Error('保存処理が完了するまでお待ちください。');
  if (stale) throw new Error('「最新を取得」で共有データを読み込んでから、もう一度変更してください。');
  const checked = OrgModel.validate(next), requestGeneration = generation;
  setBusy(true); $('save-state').textContent = '共有データを保存中…';
  try {
    const row = await cloud.save({version:1, members:checked}, revision);
    if (generation !== requestGeneration || !userId) throw new Error('ログイン状態が変わりました。再度ログインしてください。');
    members = OrgModel.validate(row.document.members); revision = row.revision;
    dirty = false; stale = false; $('sync-notice').hidden = true;
    $('save-state').textContent = `クラウドに保存済み · v${revision}`; render();
  } catch (error) {
    if (generation === requestGeneration) {
      stale = true; notice(error.message + ' 入力中の内容はそのまま残しています。');
      $('save-state').textContent = '保存結果の確認が必要です';
    }
    throw error;
  } finally { if (generation === requestGeneration) setBusy(false); }
}
function options(selected = '') {
  const blocked = editingId ? OrgModel.descendants(members, editingId) : new Set();
  $('parent').replaceChildren(new Option('所属先なし（最上位）', ''));
  for (const m of members) if (!blocked.has(m.id)) $('parent').add(new Option(`${m.role} · ${m.name}`, m.id));
  $('parent').value = selected;
}
function resetEditor(focus = false) {
  editingId = null; dirty = false; $('member-form').reset(); options(); $('form-heading').textContent = 'メンバーを追加';
  $('submit-btn').textContent = '＋ メンバーを追加';
  $('cancel-btn').hidden = true; $('delete-btn').hidden = true; $('form-error').textContent = ''; render();
  if (focus) { $('role').focus(); $('member-form').scrollIntoView({behavior:'smooth', block:'center'}); }
}
function edit(id) {
  const m = members.find(m => m.id === id); if (!m) return;
  editingId = id; dirty = true; $('role').value = m.role; $('name').value = m.name; options(m.parentId || '');
  $('form-heading').textContent = 'メンバーを編集';
  $('submit-btn').textContent = '変更を保存'; $('cancel-btn').hidden = false; $('delete-btn').hidden = false; $('form-error').textContent = ''; render();
  $('role').focus({preventScroll:true});
  $('member-form').scrollIntoView({behavior:'smooth', block:'center'});
}
function render() {
  $('member-count').textContent = `${members.length} members`;
  $('empty').hidden = members.length > 0; $('chart-space').hidden = members.length === 0;
  $('export-btn').disabled = members.length === 0;
  const roots = members.filter(m => m.parentId === null);
  $('root-summary').textContent = members.length ? `${members.length}名のメンバー · 最上位 ${roots.length}名` : '所属先なしのメンバーが最上位になります';
  const children = new Map();
  for (const m of members) { if (!children.has(m.parentId)) children.set(m.parentId, []); children.get(m.parentId).push(m); }
  function branch(parent) {
    const ul = document.createElement('ul');
    for (const m of children.get(parent) || []) {
      const li = document.createElement('li'), card = document.createElement('button');
      card.className = 'person' + (m.parentId === null ? ' root' : '') + (m.id === editingId ? ' selected' : '');
      card.type = 'button'; card.setAttribute('aria-label', `${m.role} ${m.name} を編集`); card.setAttribute('aria-pressed', String(m.id === editingId));
      for (const [cls, text] of [['role',m.role],['name',m.name]]) {
        const el = document.createElement('div'); el.className = cls; el.textContent = text; if (cls === 'avatar') el.setAttribute('aria-hidden','true'); card.append(el);
      }
      card.onclick = () => edit(m.id); li.append(card);
      if (children.has(m.id)) li.append(branch(m.id)); ul.append(li);
    }
    return ul;
  }
  $('chart').replaceChildren(branch(null));
  requestAnimationFrame(applyZoom);
}
function applyZoom() {
  const chart = $('chart'), space = $('chart-space');
  chart.style.transform = `scale(${zoom})`;
  space.style.width = `${Math.max($('viewport').clientWidth, chart.offsetWidth * zoom)}px`;
  space.style.height = `${chart.offsetHeight * zoom}px`;
  chart.style.marginLeft = `${Math.max(0, ($('viewport').clientWidth - chart.offsetWidth * zoom) / 2)}px`;
  $('zoom-label').textContent = `${Math.round(zoom*100)}%`;
  $('zoom-out').disabled = zoom <= .1; $('zoom-in').disabled = zoom >= 1.6;
}
function setZoom(value) { zoom = Math.max(.1, Math.min(1.6, Math.round(value * 100) / 100)); applyZoom(); }
$('member-form').onsubmit = async event => {
  event.preventDefault();
  const id = editingId || (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `member-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const m = {id, role:$('role').value.trim(), name:$('name').value.trim(), parentId:$('parent').value || null};
  const wasEditing = Boolean(editingId);
  const next = wasEditing ? members.map(item => item.id === id ? m : item) : [...members, m];
  try { await persist(next); resetEditor(); toast(wasEditing ? 'メンバー情報を更新しました' : 'メンバーを追加しました'); }
  catch (error) { $('form-error').textContent = error.message; }
};
$('cancel-btn').onclick = () => resetEditor(); $('new-btn').onclick = () => resetEditor(true);
$('delete-btn').onclick = async () => {
  const m = members.find(m => m.id === editingId); if (!m) return;
  const count = members.filter(x => x.parentId === m.id).length;
  const parent = members.find(x => x.id === m.parentId);
  const detail = count ? `直属の${count}名は${parent ? `${parent.name}の配下` : '最上位'}へ移動します。` : 'この操作は取り消せません。';
  if (await confirmAction('メンバーを削除', `${m.name}（${m.role}）を削除しますか？\n${detail}`, '削除する')) {
    try { await persist(OrgModel.remove(members, m.id)); resetEditor(); toast('メンバーを削除しました'); }
    catch (error) { $('form-error').textContent = error.message; }
  }
};
$('export-btn').onclick = () => {
  const blob = new Blob([JSON.stringify({version:1, exportedAt:new Date().toISOString(), members}, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = `FastNeura-organization-${new Date().toISOString().slice(0,10)}.json`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('組織図データをダウンロードしました');
};
$('import-btn').onclick = () => $('import-file').click();
$('import-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('2MB以下のJSONファイルを選んでください。');
    const data = JSON.parse(await file.text());
    if (!data || data.version !== 1) throw new Error('対応していないデータ形式です。このアプリから保存したJSONを選んでください。');
    const next = OrgModel.validate(data.members);
    if (await confirmAction('組織図を読み込む', `${next.length}名の組織図を読み込みます。現在のデータは置き換えられます。必要に応じて先にJSONで保存してください。`, '読み込む')) {
      await persist(next);
      resetEditor(); toast('組織図を読み込みました');
    }
  } catch (error) { toast(error instanceof SyntaxError ? 'JSONファイルを読み取れませんでした。ファイル形式を確認してください。' : error.message); }
};
$('zoom-out').onclick = () => setZoom(zoom - .1); $('zoom-in').onclick = () => setZoom(zoom + .1);
$('fit-btn').onclick = () => { if (!members.length) return; setZoom(Math.min(1, ($('viewport').clientWidth-20)/$('chart').offsetWidth, ($('viewport').clientHeight-20)/$('chart').offsetHeight)); $('viewport').scrollTo({top:0,left:0}); };
$('view-map-btn').onclick = () => $('viewport').scrollIntoView({behavior:'smooth',block:'start'});
window.addEventListener('resize', applyZoom);
function notice(message) { $('sync-notice').textContent = message; $('sync-notice').hidden = false; }
function authMessage(message, isError = false) { $('auth-message').textContent = message; $('auth-message').classList.toggle('error', isError); }
function clearWorkspace() {
  generation++; members = []; revision = null; stale = false; dirty = false; polling = false;
  setBusy(false); resetEditor(); $('sync-notice').hidden = true;
  $('app-main').hidden = true; $('auth-screen').hidden = false;
  if ($('confirm-dialog').open) $('confirm-dialog').close('cancel');
  $('toast').hidden = true; clearTimeout(toastTimer);
}
function acceptRow(row) {
  if (row.document?.version !== 1 || !Number.isInteger(row.revision)) throw new Error('共有データの形式を確認してください。');
  members = OrgModel.validate(row.document.members); revision = row.revision; stale = false;
  resetEditor(); $('sync-notice').hidden = true;
  $('save-state').textContent = `クラウドに保存済み · v${revision}`;
}
async function refresh(manual = false) {
  if (!userId || busy || polling) return;
  if (manual && dirty && !await confirmAction('最新データを取得', '入力中の変更は破棄されます。共有されている最新の組織図を読み込みますか？', '最新を取得')) return;
  if (!userId || busy || polling) return;
  const requestGeneration = generation, startRevision = revision;
  polling = true;
  if (manual) setBusy(true);
  try {
    const row = await cloud.read();
    if (requestGeneration !== generation || (!manual && busy) || startRevision !== revision) return;
    if (manual || revision === null || (!dirty && !stale)) {
      if (manual || row.revision !== revision) acceptRow(row);
    } else if (row.revision !== revision) {
      stale = true; notice('他のメンバーが組織図を更新しました。入力内容を控えたうえで「最新を取得」を押してください。');
    }
    if (manual) toast('最新の共有データを取得しました');
  } catch (error) {
    if (requestGeneration !== generation) return;
    if (error.code === 'FORBIDDEN') { clearWorkspace(); $('retry-btn').hidden = false; authMessage(error.message, true); }
    else { notice(error.message); $('save-state').textContent = '同期を確認できません'; }
  } finally { if (requestGeneration === generation) { polling = false; if (manual) setBusy(false); } }
}
async function handleSession(session) {
  if (session?.user?.id && userId === session.user.id && !$('app-main').hidden) return;
  clearWorkspace();
  userId = session?.user?.id || null;
  $('account').hidden = !userId; $('account-email').textContent = session?.user?.email || '';
  $('login-form').hidden = Boolean(userId); $('retry-btn').hidden = true;
  if (!userId) { authMessage('管理者が登録したアカウントでログインしてください。'); return; }
  authMessage('共有の組織図を読み込んでいます…');
  const requestGeneration = generation;
  try {
    const row = await cloud.read();
    if (requestGeneration !== generation) return;
    acceptRow(row); $('auth-screen').hidden = true; $('app-main').hidden = false;
    window.scrollTo({top:0,left:0});
    try { $('legacy-btn').hidden = !localStorage.getItem(STORAGE_KEY); } catch { $('legacy-btn').hidden = true; }
    requestAnimationFrame(applyZoom);
  } catch (error) {
    if (requestGeneration !== generation) return;
    authMessage(error.message, true); $('retry-btn').hidden = false;
  }
}
$('login-form').onsubmit = async event => {
  event.preventDefault(); if (!cloud) return;
  $('login-btn').disabled = true; authMessage('ログインしています…');
  const password = $('login-password').value;
  try { await cloud.login($('login-email').value.trim(), password); $('login-password').value = ''; }
  catch (error) { authMessage(error.message, true); }
  finally { $('login-btn').disabled = false; }
};
$('logout-btn').onclick = async () => {
  if (busy) { toast('保存完了後にログアウトしてください。'); return; }
  if (dirty && !await confirmAction('ログアウト', '入力中の変更は破棄されます。ログアウトしますか？', 'ログアウト')) return;
  try { await cloud.logout(); userId = null; clearWorkspace(); $('account').hidden = true; $('login-form').hidden = false; authMessage('ログアウトしました。'); }
  catch (error) { toast(error.message); }
};
$('retry-btn').onclick = () => { const id = userId, email = $('account-email').textContent; userId = null; handleSession(id ? {user:{id,email}} : null); };
$('refresh-btn').onclick = () => refresh(true);
$('member-form').addEventListener('input', () => dirty = true);
$('member-form').addEventListener('change', () => dirty = true);
$('legacy-btn').onclick = async () => {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data?.version !== 1) throw new Error('旧データの形式を確認してください。');
    const next = OrgModel.validate(data.members);
    if (await confirmAction('旧データを共有する', `このブラウザの旧データ（${next.length}名）で、共有の組織図を置き換えます。全メンバーに反映されます。よろしいですか？`, '共有データに移行')) {
      await persist(next); resetEditor(); toast('旧データをクラウドに保存しました');
    }
  } catch (error) { toast(error.message); }
};
window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('app-main').hidden) refresh(); });
setInterval(() => { if (!document.hidden && !$('app-main').hidden) refresh(); }, 15000);
try {
  cloud = OrgCloud.create(window.ORG_CONFIG, window.supabase);
  cloud.onAuth(handleSession);
} catch (error) { $('login-form').hidden = true; authMessage(error.message, true); }
options(); render();
