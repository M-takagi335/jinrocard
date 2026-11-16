# オンライン対戦を有効にする

Supabaseはオンライン対戦専用です。設定前でもゲームをビルドでき、NPC戦とローカルのデッキ保存を使えます。

## 1. Supabaseプロジェクトを作成する

1. [Supabase Dashboard](https://supabase.com/dashboard) を開き、GitHubなどでログインします。
2. **New project** を選び、使用するOrganizationを選択します。未作成の場合はOrganizationを作ります。
3. プロジェクト名を入力します。例は `jinrocard-online` です。
4. **Database Password** は自動生成などで強いものを作り、パスワード管理アプリへ保存します。これはDB管理用の値です。GitHub、チャット、Vercelの公開変数には登録しません。
5. **Region** は主な対戦者に近いものを選びます。日本が中心なら東京など、一覧にある近いリージョンを選択します。**Create new project** を押し、準備完了を待ちます。
6. Dashboard上部の **Connect** から、Project URL（例 `https://xxxxx.supabase.co`）と `sb_publishable_` から始まる **Publishable key** を確認します。鍵の一覧は **Project Settings → API Keys** にあります。同じ画面の **Secret keys** では、`sb_secret_` から始まるサーバー専用鍵を確認・発行できます。通常はEdge Functionsに自動注入される既定鍵を利用できるため、手動コピーは不要です。[API keys](https://supabase.com/docs/guides/getting-started/api-keys)

## 2. Auth・SQL・Realtime・Edge Functionsを設定する

1. Dashboardの **Authentication → Sign In / Providers** にある **Anonymous Sign-Ins** を有効にします。初期構成では匿名登録のIP制限が1時間あたり30件です。**Authentication → Rate Limits** で設定を確認してください。アプリ側にもゲスト単位で作成・参加は毎分8回、ゲーム操作・取得は毎分100回の制限があります。CAPTCHAを有効にする場合は、先にクライアント側へトークン取得を組み込む必要があります。この版はCAPTCHA未連携です。[匿名認証](https://supabase.com/docs/guides/auth/auth-anonymous)・[Authの制限](https://supabase.com/docs/guides/auth/rate-limits)
2. Node.js 22以降を用意し、PowerShellなどでこのリポジトリのルートを開きます。Project RefはDashboardのプロジェクトURLの一部（`/project/xxxxx` の `xxxxx`）です。次を実行し、ブラウザでCLIへのログインを許可してから、対象プロジェクトへ接続します。求められた場合のみ、Database PasswordをCLIの入力欄へ入力します。 [CLIによるデプロイ](https://supabase.com/docs/guides/functions/deploy)

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   npx supabase functions deploy online-duel --use-api
   ```

3. `db push` が `supabase/migrations/202611170001_online_duel.sql` を適用します。手動で行う場合はDashboardの **SQL Editor → New query** にファイル全体を貼り付け、**Run** を押します。CLIと手動適用の両方を同じDBで行うと、同一テーブルやポリシーの作成が重複するため、どちらか一方を選びます。
4. RLSはマイグレーションで有効になり、`online_rooms` と `online_rate` はクライアントからの直接読み書きを拒否します。`realtime.messages` のポリシーは部屋の参加者にだけ通知受信を許可します。**Realtime → Settings** でRealtimeが稼働していることを確認してください。専用プロジェクトなら公開チャンネルを無効にできます。このゲームはprivate Broadcastを使用し、`online_rooms` をPostgres Changesのpublicationに追加しません。[Realtimeの設定](https://supabase.com/docs/guides/realtime/settings)・[Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
5. **Edge Functions** に `online-duel` が表示されることを確認します。サーバーは自動注入された `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEYS` と `SUPABASE_SECRET_KEYS` の `default` を優先します。専用鍵を使う場合だけ、**Edge Functions → Secrets** で変数名 `JINRO_SERVER_KEY` を追加してSecret keyを入力します。新方式の変数が提供されない環境ではプラットフォームの旧方式を内部フォールバックとして読みます。関数設定の `verify_jwt = false` はゲートウェイの旧方式のJWT検査を外すための設定です。各POSTは関数内で `auth.getUser` による匿名ゲストJWT検証を通ります。 [Edge Functionsの認証](https://supabase.com/docs/guides/functions/auth)・[秘密情報](https://supabase.com/docs/guides/functions/secrets)
6. マイグレーションが **Integrations → Cron** に `jinrocard-online-cleanup` を毎分実行のジョブとして登録します。ジョブの **History** で実行状況を確認します。必要であればSQL Editorでも確認できます。[Cronの確認方法](https://supabase.com/docs/guides/cron/quickstart)

   ```sql
   select status, start_time, end_time, return_message
   from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'jinrocard-online-cleanup')
   order by start_time desc limit 10;
   ```

## 3. ローカルとVercelで設定する

| 場所 | 変数 | 値 |
| --- | --- | --- |
| ローカル `.env.local`、Vercel | `VITE_SUPABASE_URL` | ConnectのProject URL |
| ローカル `.env.local`、Vercel | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_` で始まる鍵 |
| Supabase Edge FunctionsのSecretsのみ、任意 | `JINRO_SERVER_KEY` | 専用の `sb_secret_` 鍵 |

- ローカルでは `.env.example` を `.env.local` にコピーし、最初の2つを入力して、`npm ci` と `npm run dev` を実行します。編集後はViteを再起動します。
- Vercelでは対象プロジェクトの **Settings → Environment Variables** に最初の2つを追加し、**Production**（必要なら **Preview**）を選びます。**Deployments → Redeploy**、または既存GitHub連携で対象のコミットをデプロイします。Viteのビルドコマンドは `npm run build`、成果物は `dist` です。[Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- `VITE_` の値は公開JSに含まれます。`sb_secret_`、DBパスワード、CLIトークンは登録しません。`.env` と `.env.*` はGit除外済みです。`.env.example` には例だけを置きます。Previewで運用する場合は別Supabaseプロジェクトを使うと本番データと分離できます。

## 4. デプロイ後の確認

1. スマホAでVercelのHTTPSサイトを開き、**オンライン対戦 → ルームを作成**。URLをコピーします。
2. スマホBで招待URLを開き、コードを確認して **参加する** を押します。両方でデッキを登録し、準備完了を押します。3つ目のブラウザでは満員になることを確認します。同一ブラウザの重複タブは同じゲスト扱いです。
3. Aだけ確定し、Bに「相手は確定済み」だけが出ることを確認します。Bの確定後に両方のカードが出ます。占い師と預言者を使用した側だけに結果が出ます。効果で対象選択が出たら担当側が選び、夜の結果を見たら両側で次の夜へ進みます。
4. スマホBを一時的にオフラインにし、Aの切断表示、Bの復帰と同じ手札を確認します。ページを再読み込みし、同じゲストで復帰することも確認します。ブラウザデータを消した場合は元の席へ復帰できません。
5. SQL Editorで `supabase/tests/online_duel.sql` を実行すると、権限・排他・期限のチェックをテストデータだけで確認できます。データは最後にロールバックされます。
6. Supabase未設定のビルドまたは設定を壊したテスト用のPreviewで、オンラインだけ案内を出し、NPC対戦とローカルデッキ保存に進めることを確認します。本番プロジェクトを停止して試す必要はありません。

## 保存と期限

- 片方が切断しても操作は代行されません。サーバーが最後に確認した通信から45秒後に切断表示となり、その時点から30分間復帰できます。進行中のまま切断猶予または最終対戦操作から24時間を超えると、部屋は無効になり削除対象になります。
- 未開始は作成から30分、決着または対戦中の明示的退出は終了から30分、両席が明示的に退出した場合は最後の退出から5分で無効になります。削除ジョブは毎分です。状態、履歴、乱数、参加者は同一DB行にあり、ルームと一緒に消えます。Realtime側にはリビジョンだけの通知がプラットフォームの保持期間に従って残る場合があります。
- 匿名Authユーザーはルームと別に保管します。自動削除は設定していません。清掃する場合は、古い匿名アカウントだけを候補にし、`online_rooms` のどの部屋にも所属していないことと、直近の利用状況を確認してから、テスト環境で手順を検証してください。作成日時だけで一括削除すると、利用中のゲストが復帰できなくなります。
- 再接続は定期取得・通知・画面復帰イベントで試みます。一時障害が続いたら「再試行」を押します。確定などの再試行は同じリクエストIDを使います。失効した場合は部屋を新規作成します。NPC戦はブラウザ内で動作し、Supabaseの接続やAuthを必要としません。
- 使用量はDashboardのOrganization **Usage** と **Billing**、Realtime・Edge Functionsの各画面で確認します。停止や無料枠に達した際はオンラインだけが利用不可になります。枠や料金の最新情報は [Supabase料金ページ](https://supabase.com/pricing) を確認してください。
- オンライン対戦の保存形式はVersion 1です。進行中の部屋はサーバーが確定コマンドと保存乱数を再生して復元します。将来、対戦エンジンの解決規則を変えるデプロイでは、旧ルールでの再生を維持するか既存の部屋を終了させてから更新してください。
