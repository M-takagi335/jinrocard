# 「みんなの戦績」適用・復旧手順

## リリース対象と動作

- 既存のホームの歯車から「みんなの戦績」を開く。画面表示時だけ集計を取得し、更新ボタンと「設定に戻る」を用意する。通常の音量設定と同じダイアログを切り替える。
- 集計は非公開の `match_stats` スキーマに5分類。公開RPCは開始日時と集計列だけを返す。ブラウザの `anon`／`authenticated` は集計更新、受領記録・制限表の閲覧、Cron実行ができない。集計GETは公開キーだけでアクセスする。
- NPC戦の正式終了時にブラウザでUUIDv7を一度発行し、難易度とプレイヤーの勝敗だけを送る。途中退出とチュートリアルは経路外。ローカルキューは32件、期限72時間、1回＋一時エラー時の再試行2回（30秒、5分）。ブラウザオフライン中は再送を待つ。既存の匿名セッションを優先し、新規は終了後だけ。匿名登録・送信に失敗してもゲーム画面は表示する。
- 受領UUIDの主キーと入力指紋で重複・異なる内容の衝突を判別。受領INSERTとカウンターUPDATEを同じトランザクションで行う。UUIDに含まれる時刻で72時間より古い再送を拒否し、受領データは猶予を加えて毎時掃除。指紋は検証済みUIDと分類・結果のSHA-256。受領表にUID・生データを保存しない。バケット表のUIDは2日以上経過したものを毎時削除する。IP制限は信頼できる転送元の条件が確認できていないため導入していない。制限はゲスト単位で10分6件・UTC日30件、全NPCでUTC日10,000件。クライアント生成のUUIDは対戦の真偽を証明しない。NPC戦績は参考値であり、複数匿名セッションでの水増しは可能。
- オンラインはEdgeで正式な決着を導出し、既存のrevision付きUPDATEに内部マーカーを添える。トリガーがマーカーをルーム内部列に移してイベントJSONから取り除く。状態・受領ID・マーカーは同じUPDATEで確定する。明示退出・切断・期限切れにはマーカーを付けない。集計表の更新は別のCronで5分ごと、最大200ルーム。集計と済み印は同一トランザクション。再集計・同時実行・失敗に備えた行ロックとロック待ち時間の上限があり、既存のルーム削除は未集計の物理削除のみ保留する。期限切れのAPI応答とリビジョン通知は既存のまま。
- GETは `/api/match-statistics` 固定、Vercel CDNで成功応答を60秒キャッシュし、ブラウザでは5分間再利用。エラーはキャッシュせず、前回値があれば取得失敗と合わせて表示。ブラウザからのRealtime購読は増えない。

## 本番適用（ユーザー承認を得た後）

現時点では本番に未適用。下記は承認後に実行する。Previewsに本番統計用のフラグを設定しない。リンク先がWeb版のSupabaseであることと、DB容量・Edge使用量・Auth MAUの基準値を確認する。

1. 専用ブランチで `npm test` と `npm run build` を実行する。隔離したSupabaseで `supabase/tests/online_duel.sql` と `supabase/tests/match_statistics.sql` を実行する。両SQLテストはトランザクションをロールバックする。ローカルSupabaseを使う場合は別データのない環境で `npx supabase start` と `npx supabase db push --local` を使える。
2. 本番への変更予定を確認。既存マイグレーションを再適用せず、計画に `202611180001_match_statistics.sql` だけが含まれる状態で適用する。DBが自動で初期化される操作は行わない。

   ```powershell
   npx supabase migration list
   npx supabase db push --dry-run
   npx supabase db push
   npx supabase secrets set JINRO_ONLINE_STATS_ENABLED=false
   npx supabase functions deploy match-statistics --use-api
   npx supabase functions deploy online-duel --use-api
   ```

   `online-duel` は結果マーカーを付けるために再デプロイする。既存の認証設定は変更不要。新規 `match-statistics` は設定ファイルに記したとおり関数内で匿名JWTを検証する。サービスキーはSupabaseのサーバー環境だけに置く。

3. Cron一覧に `jinrocard-match-stats-collect`（5分）と `jinrocard-match-stats-cleanup`（毎時）が有効で、既存のオンライン削除Cronも有効なことを確認。承認済みの本番で、Edgeのマーカーフラグを有効にしてから、SQL Editorで開始時刻とNPC受付を1回だけ有効にする。時刻はDBのUTC、画面は日本時間。開始時刻より前のマーカーは済み印だけ付けて集計外にする。

   ```powershell
   npx supabase secrets set JINRO_ONLINE_STATS_ENABLED=true
   ```

   ```sql
   update match_stats.config
   set started_at = coalesce(started_at, date_trunc('milliseconds', clock_timestamp())), npc_enabled = true
   where singleton;
   ```

4. Supabase側の正常性を確認してから、Vercelの **Production** に `VITE_MATCH_STATS_ENABLED=true` を設定し、専用ブランチの変更を `main` に反映。既存の `VITE_SUPABASE_URL` と `VITE_SUPABASE_PUBLISHABLE_KEY` を読取GETでも使用する。公式・予備ドメインで設定から閲覧し、少数の同意済みテスト試合でNPC終了報告・オンライン確定から5分程度後の加算・再読み込み後の不変性を確認。集計開始後の正式終了は公開集計に入るため、試算用の大量試合は隔離DBで行う。

## ロールバック

1. 公開をすぐ抑制する場合、Vercel Productionで `VITE_MATCH_STATS_ENABLED=false` にして現行コードを再デプロイするか、既知の直前のVercelデプロイに戻す。CDN・旧タブも考慮し、必要なら下記の受付停止を併用する。
2. 統計専用NPC受付のみ停止するにはSQL Editorで `update match_stats.config set npc_enabled = false where singleton;`。オンラインの新規マーカーは `npx supabase secrets set JINRO_ONLINE_STATS_ENABLED=false` で停止。既存のオンライン決着処理とNPC戦は継続する。停止中に正式終了したオンライン戦は新規マーカーがないため後から補えない。NPCは保留期限内の復旧が必要。
3. 既存マーカーはCronで集計可能なまま保持。旧Edgeに戻す必要がある場合、対象コミットの既存 `online-duel` をデプロイする。追加列とトリガーはマーカーなしの旧Edgeと互換。マイグレーションを逆向きに適用したり、本番ルーム、統計累計、Authユーザーを消したりする必要はない。
4. 監視項目は受理・重複・制限・失敗、匿名MAU、未集計の件数と最古時刻、Cron失敗、総DBサイズ。Cron障害時に未集計のルームが残るため、長期滞留を放置しない。共用DBそのものの障害は既存オンラインにも影響する。統計停止はオフラインのNPC対戦に影響しない。

## 無料枠の見積もり

事前調査の試算では、1日1,000試合の80%がNPC・再送10%なら、統計Edgeが月約26,400呼出、レスポンス由来の追加エグレスが月約27.53 MB。オンライン統計は新規Edge呼出ゼロ。実装ではIPバケットの代わりにゲスト短期・日次・全体の最大3行のレートUPSERTを一意報告ごとに行う。確認済み重複は先に戻す。累計は5行、NPCの受領表は期限付き。匿名Authと既存オンラインの消費は別に足す必要があり、この例では既存オンライン月約48万回を仮定すると合計約50.64万回。FreeのEdge枠50万回を超えうるため、割合・再試行・Usageは導入前後に実測する。制限に達したリクエストもEdge呼出を消費するので、DBの全体日次制限はプラットフォーム利用料の上限ではない。
