'use strict';
const $ = id => document.getElementById(id);
const STORAGE_KEY = 'fastneura.organization-map.v1';
let members = [], editingId = null, zoom = 1, toastTimer, storageBlocked = false;
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
function persist(next) {
  const checked = OrgModel.validate(next);
  if (storageBlocked) throw new Error('保存済みデータを読み込めないため、自動保存を停止しています。JSONを読み込んで復元してください。');
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({version:1, members:checked})); }
  catch { $('save-state').textContent = '保存できませんでした'; throw new Error('ブラウザへの保存に失敗しました。ストレージ設定や空き容量を確認してください。変更は適用していません。'); }
  members = checked; $('save-state').textContent = 'このブラウザに自動保存'; render();
}
function options(selected = '') {
  const blocked = editingId ? OrgModel.descendants(members, editingId) : new Set();
  $('parent').replaceChildren(new Option('所属先なし（最上位）', ''));
  for (const m of members) if (!blocked.has(m.id)) $('parent').add(new Option(`${m.role} · ${m.name}`, m.id));
  $('parent').value = selected;
}
function resetEditor(focus = false) {
  editingId = null; $('member-form').reset(); options(); $('form-heading').textContent = 'メンバーを追加';
  $('form-caption').textContent = 'チームをつなぐ、最初の一歩。'; $('submit-btn').textContent = '＋ メンバーを追加';
  $('cancel-btn').hidden = true; $('delete-btn').hidden = true; $('form-error').textContent = ''; render();
  if (focus) { $('role').focus(); $('member-form').scrollIntoView({behavior:'smooth', block:'center'}); }
}
function edit(id) {
  const m = members.find(m => m.id === id); if (!m) return;
  editingId = id; $('role').value = m.role; $('name').value = m.name; options(m.parentId || '');
  $('form-heading').textContent = 'メンバーを編集'; $('form-caption').textContent = '役割や所属先を更新できます。';
  $('submit-btn').textContent = '変更を保存'; $('cancel-btn').hidden = false; $('delete-btn').hidden = false; $('form-error').textContent = ''; render();
  $('role').focus({preventScroll:true});
  if (window.innerWidth <= 680) $('member-form').scrollIntoView({behavior:'smooth', block:'center'});
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
      for (const [cls, text] of [['role',m.role],['name',m.name],['avatar',Array.from(m.name)[0]],['reports',`${(children.get(m.id)||[]).length}名が直属`]]) {
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
$('member-form').onsubmit = event => {
  event.preventDefault();
  const id = editingId || (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `member-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const m = {id, role:$('role').value.trim(), name:$('name').value.trim(), parentId:$('parent').value || null};
  const wasEditing = Boolean(editingId);
  const next = wasEditing ? members.map(item => item.id === id ? m : item) : [...members, m];
  try { persist(next); resetEditor(); toast(wasEditing ? 'メンバー情報を更新しました' : 'メンバーを追加しました'); }
  catch (error) { $('form-error').textContent = error.message; }
};
$('cancel-btn').onclick = () => resetEditor(); $('new-btn').onclick = $('empty-add').onclick = () => resetEditor(true);
$('delete-btn').onclick = async () => {
  const m = members.find(m => m.id === editingId); if (!m) return;
  const count = members.filter(x => x.parentId === m.id).length;
  const parent = members.find(x => x.id === m.parentId);
  const detail = count ? `直属の${count}名は${parent ? `${parent.name}の配下` : '最上位'}へ移動します。` : 'この操作は取り消せません。';
  if (await confirmAction('メンバーを削除', `${m.name}（${m.role}）を削除しますか？\n${detail}`, '削除する')) {
    try { persist(OrgModel.remove(members, m.id)); resetEditor(); toast('メンバーを削除しました'); }
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
      const previousBlocked = storageBlocked; storageBlocked = false;
      try { persist(next); } catch (error) { storageBlocked = previousBlocked; throw error; }
      resetEditor(); toast('組織図を読み込みました');
    }
  } catch (error) { toast(error instanceof SyntaxError ? 'JSONファイルを読み取れませんでした。ファイル形式を確認してください。' : error.message); }
};
$('zoom-out').onclick = () => setZoom(zoom - .1); $('zoom-in').onclick = () => setZoom(zoom + .1);
$('fit-btn').onclick = () => { if (!members.length) return; setZoom(Math.min(1, ($('viewport').clientWidth-20)/$('chart').offsetWidth, ($('viewport').clientHeight-20)/$('chart').offsetHeight)); $('viewport').scrollTo({top:0,left:0}); };
window.addEventListener('resize', applyZoom);
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY || event.key === null) {
    storageBlocked = true; $('save-state').textContent = '別タブで変更されました';
    toast('別のタブで保存データが変わりました。再読み込みして最新の組織図を表示してください。');
  }
});
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) { const data = JSON.parse(raw); if (data.version !== 1) throw new Error(); members = OrgModel.validate(data.members); }
} catch { storageBlocked = true; $('save-state').textContent = '保存データを読み込めません'; toast('保存データを読み込めません。元データの上書きを停止しました。JSONから復元できます。'); }
options(); render();
