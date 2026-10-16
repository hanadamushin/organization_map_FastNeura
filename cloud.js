(function (root) {
  'use strict';
  function create(config, sdk) {
    if (!config?.supabaseUrl || !config?.supabasePublishableKey) throw new Error('管理者による初期設定が必要です。config.js にSupabaseの接続先と公開キーを設定してください。');
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(config.supabaseUrl)) throw new Error('Supabase URLを確認してください。');
    const key = config.supabasePublishableKey;
    if (key.startsWith('sb_secret_')) throw new Error('秘密キーは使用できません。Publishable keyを指定してください。');
    if (key.startsWith('eyJ')) {
      try { if (JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role !== 'anon') throw new Error(); }
      catch { throw new Error('ブラウザではPublishable keyまたはanon keyのみ使用できます。'); }
    } else if (!key.startsWith('sb_publishable_')) throw new Error('Publishable keyを確認してください。');
    if (!sdk) throw new Error('認証ライブラリを読み込めません。ページを再読み込みしてください。');
    const client = sdk.createClient(config.supabaseUrl, key, {auth:{storageKey:'fastneura-org-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
    return {
      onAuth(callback) { return client.auth.onAuthStateChange((event, session) => { setTimeout(() => callback(session, event), 0); }); },
      async login(email, password) { const {error} = await client.auth.signInWithPassword({email,password}); if (error) throw new Error('ログインできませんでした。メールアドレス・パスワード、または接続状況を確認してください。'); },
      async logout() { const {error} = await client.auth.signOut({scope:'local'}); if (error) throw new Error('ログアウトに失敗しました。接続を確認して再試行してください。'); },
      async read() {
        const {data, error} = await client.from('organization_documents').select('document,revision,updated_at').eq('id',config.organizationId).maybeSingle();
        if (error) throw new Error('共有データを取得できません。ネットワーク接続・Supabaseの設定を確認してください。');
        if (!data) { const err = new Error('この組織図の利用権限がありません。管理者にアカウントの登録を依頼してください。'); err.code = 'FORBIDDEN'; throw err; }
        return data;
      },
      async save(document, revision) {
        const {data,error} = await client.rpc('save_organization_document', {p_id:config.organizationId,p_document:document,p_expected_revision:revision});
        if (error) {
          const err = new Error(error.message === 'VERSION_CONFLICT' ? '他のメンバーが更新しました。最新の組織図を読み込んでから、もう一度変更してください。' : error.message === 'ACCESS_DENIED' ? '編集権限がありません。管理者に確認してください。' : '保存を確認できませんでした。接続を確認し、最新データを読み込んで保存結果を確認してください。');
          err.code = error.message; throw err;
        }
        return data;
      }
    };
  }
  root.OrgCloud = {create};
})(globalThis);
