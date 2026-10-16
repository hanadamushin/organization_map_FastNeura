const test = require('node:test');
const assert = require('node:assert/strict');
const {validate, descendants, remove} = require('./model.js');
const member = (id, parentId = null) => ({id,name:id,role:'役職',parentId});
test('multiple roots and nested reporting relationships', () => assert.equal(validate([member('a'),member('b','a'),member('c','b'),member('d')]).length,4));
test('rejects cycles, including moves under descendants', () => {
  assert.throws(() => validate([member('a','a')]));
  assert.throws(() => validate([member('a','c'),member('b','a'),member('c','b')]));
});
test('rejects malformed imports and dangling parents', () => {
  for (const data of [null,{},[member('a'),member('a')],[member('a','missing')],[{...member('a'),name:'  '}],[{...member('a'),role:12}],[{...member('a'),parentId:undefined}]]) assert.throws(() => validate(data));
});
test('editing excludes self and every descendant', () => assert.deepEqual([...descendants([member('a'),member('b','a'),member('c','b'),member('d')],'a')].sort(),['a','b','c']));
test('deleting middle manager reparents direct reports without losing deeper nodes', () => {
  const next = remove([member('a'),member('b','a'),member('c','b'),member('d','c')],'b');
  assert.equal(next.find(x => x.id === 'c').parentId,'a'); assert.equal(next.find(x => x.id === 'd').parentId,'c'); assert.equal(next.length,3);
});
test('deleting root promotes direct reports to root', () => assert.equal(remove([member('a'),member('b','a')],'a')[0].parentId,null));
test('round trip backup preserves Japanese and strips unknown fields', () => {
  const data = [{id:'a',name:'山田 太郎',role:'最高経営責任者',parentId:null}];
  assert.deepEqual(validate(JSON.parse(JSON.stringify(data))),data);
  assert.deepEqual(validate([{...data[0],extra:'ignored'}]),data);
});
