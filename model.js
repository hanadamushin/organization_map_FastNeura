(function (root) {
  'use strict';
  function validate(value) {
    if (!Array.isArray(value) || value.length > 500) throw new Error('メンバーは500人以内の配列で指定してください。');
    const ids = new Set();
    const members = value.map(m => {
      if (!m || typeof m.id !== 'string' || !m.id || ids.has(m.id)) throw new Error('メンバーIDが不正、または重複しています。');
      ids.add(m.id);
      if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80) throw new Error('名前は1〜80文字で入力してください。');
      if (typeof m.role !== 'string' || !m.role.trim() || m.role.length > 80) throw new Error('役職は1〜80文字で入力してください。');
      if (m.parentId !== null && typeof m.parentId !== 'string') throw new Error('所属先が不正です。');
      return {id:m.id, name:m.name.trim(), role:m.role.trim(), parentId:m.parentId};
    });
    const map = new Map(members.map(m => [m.id, m]));
    for (const m of members) {
      const seen = new Set([m.id]);
      let parent = m.parentId;
      while (parent !== null) {
        if (!map.has(parent)) throw new Error('存在しない所属先が指定されています。');
        if (seen.has(parent)) throw new Error('自分自身や配下のメンバーを所属先にはできません。');
        seen.add(parent); parent = map.get(parent).parentId;
      }
    }
    return members;
  }
  function descendants(members, id) {
    const result = new Set([id]);
    let changed = true;
    while (changed) { changed = false; for (const m of members) if (result.has(m.parentId) && !result.has(m.id)) { result.add(m.id); changed = true; } }
    return result;
  }
  function remove(members, id) {
    const target = members.find(m => m.id === id);
    if (!target) return members;
    return validate(members.filter(m => m.id !== id).map(m => m.parentId === id ? {...m, parentId:target.parentId} : m));
  }
  const api = {validate, descendants, remove};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OrgModel = api;
})(globalThis);
