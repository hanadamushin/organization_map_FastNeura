# FastNeura Organization Map

役職・名前・所属先から作る、ログイン制の共有組織図です。

- **画面**: GitHub Pages（HTML / CSS / JavaScript、ビルド不要）
- **認証**: Supabase Auth（メールアドレス＋パスワード、管理者がアカウントを作成）
- **共有データ**: Supabase PostgreSQLの `jsonb` に組織図全体をJSONとして保存
- **アクセス制御**: 許可リスト＋Row Level Security。未ログイン・未許可ユーザーはデータを取得できません。

**初回のSupabase設定が終わるまではログインできません。** 設定未完了時には組織図を表示しません。公開GitHubリポジトリに実際の組織図JSON、パスワード、秘密キーを置かないでください。

## 初回設定（管理者）

### 1. Supabaseプロジェクトを作る

[Supabase](https://supabase.com/dashboard)でプロジェクトを作成します。

SQL Editorに [`supabase/schema.sql`](supabase/schema.sql) の内容を貼り付けて実行してください。空の `fastneura` 組織図、許可リスト、アクセス制御、更新処理を作ります。このSQLは再実行しても既存の組織図を初期化しません。

### 2. ログインアカウントと権限を登録する

Authentication → Users → Add user → Create new user から、自分と利用メンバーのメールアドレス・パスワードを登録します。必要に応じて管理者側でメール確認済みにしてください。パスワードはアプリやGitに書かず、本人に安全な方法で渡してください。

次に、Usersに表示される各ユーザーの **User UID** を使い、SQL Editorで次のSQLを実行します。`ユーザーUUIDをここに貼る`を実際のUIDに置き換えます。

```sql
insert into public.organization_access (organization_id, user_id)
values ('fastneura', 'ユーザーUUIDをここに貼る'::uuid)
on conflict do nothing;
```

登録した全員が同じ組織図を閲覧・編集できます。アプリ内の自由な新規登録機能はありません。SupabaseのAuthentication設定でも **Allow new users to sign up をオフ**にしてください。ログインアカウントだけが存在していても、許可リストにいない人は組織図を閲覧できません。

権限を取り消す場合:

```sql
delete from public.organization_access
where organization_id = 'fastneura' and user_id = '対象ユーザーUUID'::uuid;
```

権限取消後、新たな読み込み・保存はサーバーで拒否されます。表示中の画面も次の同期で閉じます。すでにダウンロード・コピーされたデータは回収できません。

### 3. 公開設定値を入れる

Supabaseのプロジェクト設定 / Connectから **Project URL** と **Publishable key** を取得し、[`config.js`](config.js) に記入します。

```js
window.ORG_CONFIG = Object.freeze({
  supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
  supabasePublishableKey: 'sb_publishable_...',
  organizationId: 'fastneura'
});
```

この2つはブラウザに公開される値です。`sb_secret_...` や `service_role` キーは絶対に使わないでください。公開キーだけでは組織図は読めず、ログインとDB側の許可が必要です。

### 4. GitHub Pagesを有効にする

リポジトリをPublicにしたうえで、Settings → Pagesを開きます。

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/(root)**

保存後、GitHub Pagesのデプロイ完了を待ちます。公開先は通常次のURLです:

`https://hanadamushin.github.io/organization_map_FastNeura/`

SupabaseのAuthentication → URL ConfigurationのSite URLにも同じURLを設定しておくと、今後メール認証やパスワードリセットを拡張する際に利用できます。現在のログインはメール・パスワード方式で、リダイレクトを使いません。パスワード再設定は管理者がSupabase側で対応してください。

## 使い方

1. 登録されたアカウントでログインします。
2. 役職・名前を入力し、直属の上司・責任者を所属先として選びます。
3. 所属先を選ばないメンバーは最上位に表示されます。最上位は複数登録できます。
4. カードをクリックすると編集できます。
5. 追加・変更・削除は共有データに保存され、別ユーザー・別ブラウザにも反映されます。

### 同期と競合

ログイン時・「最新を取得」・画面復帰時・表示中15秒ごとに最新JSONを取得します。編集中に他の人が更新した場合は通知を出し、入力を勝手に置き換えません。「最新を取得」で未保存の入力を破棄し、最新内容を読み込めます。

保存時はサーバーで更新番号を照合し、古い状態からの上書きを拒否します。自動マージ・リアルタイム共同編集ではありません。通信失敗時には保存結果が不確定な可能性があるため、最新データを取得して確認してください。オフラインでの編集保存には対応しません。

### JSONバックアップ・旧版からの移行

- **JSONで保存**: 共有されている組織図をJSONファイルとしてダウンロードします。
- **読み込む**: JSONの妥当性を確認し、確認後に共有の組織図全体を置き換えます。全員に反映されます。
- **旧データを移行**: 同じブラウザ・同じURLに旧版のlocalStorageデータが残っている場合に表示されます。確認後に共有データへコピーします。元のローカルデータは削除しません。
- 旧版を `file://` や別URLで使っていた場合は、旧版でJSONを保存し、新版で読み込んでください。

実データは公開GitHubリポジトリへコミットしないでください。ダウンロードしたJSONにも実名・役職が含まれます。

## 実装と検証

ブラウザには固定バージョンのSupabase SDKを同梱し、実行時のCDN依存をなくしています。ライセンスは `vendor/SUPABASE-LICENSE` を参照してください。利用者はnpmインストール不要です。

開発時:

```sh
npm ci
npm test
npm run check
python3 -m http.server 8000
```

`http://localhost:8000` を開きます。認証版はHTTP/HTTPSで配信してください。

- `model.test.js`: ツリー操作・循環防止・不正データ
- `cloud.test.js`: 接続設定・認証呼び出し・競合エラー
- `supabase/schema.test.js`: PGlite（PostgreSQL）でSQLを実行し、未認証・未許可のアクセス拒否、自己権限追加の拒否、別ユーザー間の共有、古い更新番号の拒否、DB側データ検証、権限取消を検証

PGliteテストは認証ユーザーIDを模擬しています。本番のSupabase Auth、実プロジェクト接続、GitHub Pagesからのログインは設定後に別途確認してください。

## 参考

- [SupabaseのRow Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabaseのパスワードログイン](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)

## 現在の範囲

単一の共有組織図（500名まで）、全許可メンバーに編集権限、JSONの手動バックアップ。閲覧専用ロール、管理者用メンバー招待画面、版履歴、自動マージは未実装です。
