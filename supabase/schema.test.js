const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {PGlite} = require('@electric-sql/pglite');
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002', C = '00000000-0000-4000-8000-000000000003';
const doc = {version:1,members:[{id:'ceo',name:'代表',role:'CEO',parentId:null}]};
test('PostgreSQL authorization, JSON validation and optimistic concurrency', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; insert into auth.users values ('${A}'),('${B}'),('${C}');`);
    await db.exec(fs.readFileSync(__dirname+'/schema.sql','utf8'));
    // A second run must preserve the existing document and remain usable.
    await db.exec(fs.readFileSync(__dirname+'/schema.sql','utf8'));
    await db.query('insert into public.organization_access values ($1,$2),($1,$3)', ['fastneura',A,B]);
    async function asUser(id, fn, role = 'authenticated') {
      await db.exec(`set role ${role}`);
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || '']);
      try { return await fn(); } finally { await db.exec('reset role'); }
    }
    const save = (document, rev, id = 'fastneura') => db.query('select public.save_organization_document($1,$2::jsonb,$3) as saved',[id,JSON.stringify(document),rev]);
    await t.test('anonymous cannot read documents or execute writes', async () => asUser(null,async () => {
      await assert.rejects(db.query('select * from public.organization_documents'), /permission denied/);
      await assert.rejects(save(doc,0), /permission denied/);
    },'anon'));
    await t.test('authenticated outsider sees no data and cannot self-enroll',async () => asUser(C,async () => {
      assert.equal((await db.query('select * from public.organization_documents')).rows.length,0);
      assert.equal((await db.query('select * from public.organization_access')).rows.length,0);
      await assert.rejects(save(doc,0), /ACCESS_DENIED/);
      await assert.rejects(db.query('insert into public.organization_access values ($1,$2)',['fastneura',C]), /permission denied/);
    }));
    await t.test('member A writes and member B reads identical JSON',async () => {
      await asUser(A,async () => { const result = await save(doc,0); assert.equal(result.rows[0].saved.revision,1); });
      await asUser(B,async () => { const {rows} = await db.query('select document,revision from public.organization_documents'); assert.deepEqual(rows[0].document,doc); assert.equal(rows[0].revision,1); });
    });
    await t.test('stale browser cannot overwrite latest data',async () => asUser(B,async () => {
      await assert.rejects(save({version:1,members:[]},0), /VERSION_CONFLICT/);
      assert.deepEqual((await db.query('select document from public.organization_documents')).rows[0].document,doc);
    }));
    await t.test('members cannot bypass revision check or alter ACL',async () => asUser(A,async () => {
      await assert.rejects(db.query("update public.organization_documents set revision=999"), /permission denied/);
      await assert.rejects(db.query('delete from public.organization_access'), /permission denied/);
      await assert.rejects(db.query('delete from public.organization_documents'), /permission denied/);
      await assert.rejects(db.query("insert into public.organization_documents(id) values ('evil')"), /permission denied/);
      await assert.rejects(save(doc,0,'other'), /ACCESS_DENIED/);
    }));
    await t.test('server rejects invalid JSON, cycles, duplicate IDs, dangling references', async () => asUser(A,async () => {
      const base=doc.members[0];
      for (const bad of [null,{}, {version:1,members:{}}, {version:1,members:[{...base,parentId:'ceo'}]}, {version:1,members:[base,base]}, {version:1,members:[{...base,parentId:'missing'}]}, {version:1,members:[{...base,name:''}]}, {version:1,members:[{...base,parentId:2}]}, {version:1,members:[{...base,parentId:'b'},{...base,id:'b',parentId:'ceo'}]}]) await assert.rejects(save(bad,1), /INVALID_DOCUMENT/);
    }));
    await t.test('revoked member loses read and write access',async () => {
      await db.query('delete from public.organization_access where user_id=$1',[B]);
      await asUser(B,async () => { assert.equal((await db.query('select * from public.organization_documents')).rows.length,0); await assert.rejects(save(doc,1),/ACCESS_DENIED/); });
    });
  } finally { await db.close(); }
});
