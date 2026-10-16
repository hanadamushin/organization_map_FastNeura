const {test} = require('node:test');
const assert = require('node:assert/strict');
require('./cloud.js');
const config = {supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'sb_publishable_test',organizationId:'fastneura'};
test('configuration fails closed without credentials or with a secret key', () => {
  assert.throws(() => OrgCloud.create({},{}));
  assert.throws(() => OrgCloud.create({...config,supabasePublishableKey:'sb_secret_test'},{}));
  assert.throws(() => OrgCloud.create({...config,supabaseUrl:'http://test.supabase.co'},{}));
});
test('login sends credentials to authentication provider and never to database',async () => {
  const cloud = OrgCloud.create(config,{createClient:() => ({auth:{signInWithPassword:async value => {assert.deepEqual(value,{email:'test@example.com',password:'example'});return {error:null};}}})});
  await cloud.login('test@example.com','example');
});
test('save passes expected revision and translates conflicts',async () => {
  const cloud = OrgCloud.create(config,{createClient:() => ({rpc:async (name,args) => {
    assert.equal(name,'save_organization_document');assert.equal(args.p_expected_revision,7);assert.equal(args.p_id,'fastneura');
    return {error:{message:'VERSION_CONFLICT'}};
  }})});
  await assert.rejects(cloud.save({version:1,members:[]},7),error => error.code === 'VERSION_CONFLICT');
});
test('missing organization access produces explicit denied state', async () => {
  const query = {select(){return this;},eq(){return this;},async maybeSingle(){return {data:null,error:null};}};
  const cloud=OrgCloud.create(config,{createClient:() => ({from:() => query})});
  await assert.rejects(cloud.read(),error => error.code === 'FORBIDDEN');
});
