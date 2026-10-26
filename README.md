<p align="center">
  <img src="assets/logo.png" width="96" alt="zen-proxy" />
</p>

<p align="center"><b>zen-proxy</b></p>
<p align="center">OpenCode Zen の無料モデルを、どの AI コーディングエージェントからでも。</p>
<p align="center"><sub>アカウント不要・API キー不要。OpenAI と Anthropic に互換。手元で動きます。</sub></p>

<p align="center">
  <a href="https://discord.gg/Dw5Ctrtuw">
    <img src="https://img.shields.io/badge/Discord-Join%20the%20server-5865F2?style=flat-square&labelColor=1a1612&logo=discord&logoColor=white" alt="Join the Discord server">
  </a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-ccf73a?style=flat-square&labelColor=1a1612" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/bun-1.2%2B%20(or%20node%2018%2B%20BYOK)-8b8b8b?style=flat-square&labelColor=1a1612" alt="Bun 1.2+">
  <img src="https://img.shields.io/badge/dependencies-0-8b8b8b?style=flat-square&labelColor=1a1612" alt="Zero dependencies">
  <a href="#任意の-openai-互換エージェント">
    <img src="https://img.shields.io/badge/OpenAI_compatible-8b8b8b?style=flat-square&labelColor=1a1612&logo=openai" alt="OpenAI compatible">
  </a>
  <a href="#claude-code">
    <img src="https://img.shields.io/badge/Claude_Code-compatible-8b8b8b?style=flat-square&labelColor=1a1612&logo=anthropic" alt="Claude Code compatible">
  </a>
</p>

<p align="center">
  <img src="assets/brag-demo.gif" alt="zen-proxy を25秒で: インストール → 起動 → zen-claude → 任意の OpenAI 互換エージェントを接続" width="860" />
  <br />
  <sub>
    <a href="assets/brag-demo.mp4">▶ 音声つきの全編</a>
  </sub>
</p>

---

## このフォークについて

[12errh/zen-proxy](https://github.com/12errh/zen-proxy) のフォークです。`upstream/main` を追従しているので、上流の更新は `git pull` だけで取り込めます。上流の挙動はそのままに、次の5つを足しています。

| 独自要素 | 何をするか |
|---|---|
| **複数アカウントのプール** | `zenKeys`、または `zenKeysFile` の `zenKeysRefs` に並べた `refs:` 名（例: `~/.dsh/.credentials.yaml`）を1つのプールとして使います。リクエストは次のアカウントから順に始まり、`401`/`429` が返ると次のアカウントへ渡し、最後の受け皿は匿名枠です。`/api/status` にプールと各アカウントの利用数（マスク済み）が出ます。 |
| **System One 分類器** | `POST /v1/systemone` が `jev-*` のリクエストをそのまま中継します。`jev-*` は `/v1/models` にも並び、チャット系のルートへ投げると `/v1/systemone` を案内する `400` を返します。上流 URL は共有の `/inference` ルートから組み立てるので、v2 のベースでも旧 `/inference/v1`・`/zen/v1` でも動きます。 |
| **Cloudflare WARP 経由** | `deploy/install-warp.sh` で上流への通信を WARP の先へ出します。中継は `scripts/warp-relay.mjs` で、WARP が落ちているときは直接接続へ切り替わります（[WARP](#warp)）。 |
| **実行環境と v2 wire の可視化** | `/api/status` が `runtime`（`bun 1.4.4` / `node …`）を返し、設定タブがホップ情報と並べて表示します。ゲートが実際に見る値——preamble モード（`auto` / `off` / 任意テキスト）、`x-opencode-client`、project hash、`b3`/`traceparent`——も同じ画面で変えられます。`node` で動いているときは「free tier needs bun」と出るので、劣化した状態が枠切れに見えません。 |
| **429 で止まらない** | 枠切れとゲートの拒否は同じ `429 FreeUsageLimitError` を返すため、区別できません。そこで止めず、次のアカウント → 次のモデルと進み、それでも駄目なときだけ上流のエラーを返します。プローブが踏んだ場合は `rate-limited` 扱いで `dead` にはしないので、混雑した時間帯にモデル一覧が空になりません。 |

それ以外は上流どおりです。`models.json`、インストーラ、model-sync ワークフローも含みます。

---

## はじめかた

### インストール

```bash
curl -fsSL https://raw.githubusercontent.com/12errh/zen-proxy/main/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/12errh/zen-proxy/main/install.ps1 | iex
```

<sub>インストールはこれだけです。アカウントも API キーも `npm install` も要りません。あとは下から使うエージェントを選んでください。</sub>

---

<a id="claude-code"></a>

### Claude Code

```bash
zen-claude
```

<sub>Linux・macOS・Windows で同じコマンドです。</sub>

プロキシが起動していなければ起動し、いま使える無料 Zen モデルを Claude Code の `/model` に並べ、Claude Code を起動します。終了するとプロキシも止めます。既存の Claude Code 設定には触れません。

---

<a id="任意の-openai-互換エージェント"></a>

### 任意の OpenAI 互換エージェント

<sub>Cline、Roo Code、Continue、Aider、mimo、opencode 系フォークなど、`baseURL` を設定できるものなら何でも。</sub>

| 設定 | 値 |
|---|---|
| Base URL | `http://127.0.0.1:8787/v1` |
| API キー | `public` |
| モデル | `GET /v1/models` に出ているもの |

プロキシが上がっているか確認する:

```bash
curl -s http://127.0.0.1:8787/health
# {"ok":true,"upstream":"https://opencode.ai/inference/openai/v1"}
```

<details>
<summary>プロキシを自分で起動する</summary>

```bash
zen-proxy     # http://127.0.0.1:8787 — ダッシュボードは /
```

止めるまで動き続けるので、エージェントの接続先は一度設定すればそのまま使い回せます。`zen-claude` はこれを自動でやって、終了時に片づけます。
</details>

---

## 使えるもの

| 機能 | 内容 |
|---|---|
| `POST /v1/chat/completions` | OpenAI Chat Completions（ストリーミング／非ストリーミング） |
| `POST /v1/responses` | OpenAI Responses API。両方向に変換します。Responses 形式で送れば Responses 形式で返り、chat 形式で送れば chat 形式の返りになります |
| `POST /v1/messages` | Anthropic Messages API。**Claude Code はこれを使います** |
| `POST /v1/messages/count_tokens` | Anthropic のトークン概算 |
| `POST /v1/systemone` | System One 分類器（`jev-1.13-free`）。リクエストも応答もそのまま中継します |
| `GET /v1/models` | いま動いているモデル一覧 |
| 自動フォールバック | `429` / `5xx` / モデル利用不可のとき、次の無料モデルを試します |
| モデルエイリアス | `gpt-4o` と呼べば、無料モデルが返ります |
| 認証 | 匿名の `Bearer public`、自分の Zen キー、複数アカウントのリクエスト毎ローテーション |
| ダッシュボード | `http://127.0.0.1:8787/` |

無料モデルのカタログ [`models.json`](models.json) は、GitHub Action が OpenCode の公開カタログから6時間ごとに更新します。

---

## なぜプロキシが必要か

OpenCode の無料モデルは、OpenCode CLI 本体からしか使えません。それ以外のクライアントには次のどちらかが返ります。

```
403 FreeTierError: OpenCode's free tier can only be used from within OpenCode
429 FreeUsageLimitError: Free usage limit reached …   ← いまはこちらが返る
```

OpenCode 2 以降、CLI 以外のクライアントが受け取るのは2つ目です。`retry-after` の窓が付き、自分の利用量は0のまま。これはあなたの枠ではなく、リクエストに対するゲートの判定です。

zen-proxy はそのゲートウェイの手前に立ち、エージェントの通信を CLI のものと見分けがつかない形にします。根拠はすべて、実際の OpenCode 2.1.4 のリクエストをバイト単位で採取した結果です。

<details>
<summary>実際に何を変えているか</summary>

| ゲートの要求 | zen-proxy の対応 |
|---|---|
| **Bun で動くこと。** ゲートは TLS/HTTP スタックの指紋を見ます。Bun の fetch なら `200` で流れるバイト列が、Node の fetch では同じ秒・同じセッションでも `429 FreeUsageLimitError` になります | `zen-proxy` / `zen-claude` は bun を優先します。node は BYOK キーなら動き、node 起動時は警告を出します |
| v2 エンドポイント `https://opencode.ai/inference/openai/v1` | これを使います。`/inference/v1` や `/zen/v1` を指した古い設定は自動で移行します |
| v2 の wire 同一性: `x-opencode-client`、`x-opencode-project`（インストール毎の sha1）、`b3`/`traceparent`、affinity ペア | CLI と同じ形式で全部送ります |
| **OpenCode のハーネス system テキスト**。CLI の preamble でない system プロンプトは、他がどれだけエージェントらしくても拒否されます（汎用プロンプト、冒頭1行だけ、約1.8KB で切ったもの、いずれも拒否） | 採取したハーネス preamble（`agent-preamble.txt`）を、エージェント自身の指示の前に、全ルートで、二重にならない形で前置します |
| OpenCode 自身のツール目録（`read` のスタブだけでは通りません） | 採取した v2 目録（`agent-tools.json`。名前が対応するのは read/edit/glob/grep/shell/write）を自分のツールの前に付け、対応する呼び出しはエージェント側の名前に戻し、残りは捨てます |
| `stream_options` と実際の `max_completion_tokens` を伴うストリーム | ヘルスプローブでは CLI の形を再現し、あなたのリクエストはそのまま転送します |

**bun で動かしてください**（`bun zen-proxy.mjs`、または bun があればそれを選ぶ `zen-proxy`/`zen-claude` 経由）。これだけは node で代用できません。ヘッダもセッションもボディもバイト単位で同じでも、ゲートは node のスタックを 429 にします。

応答についてはルールが1つだけあります。**返信は、エージェントが実際に実行できる呼び出しだけを持てる。** 自分のツールを持つターンは、その呼び出しを保持し（目録由来の呼び出しは名前を戻して返します）、それ以外——対応のない目録の名前や、プロバイダが勝手に作ったツール名——は落とします。`tool_choice` で1つに固定したターンは、その固定した呼び出しだけを残します。ツールを一切付けていない返信（タイトル生成や単純な ping）は、`tool_call` を全部落とします。ヘルスプローブも同じハーネス preamble + 目録 + 実際の問いを送ります（直列で、間隔を空けて。同一 identity からの連続モデルホップはまとめて 403 になるため）。だからダッシュボードの `ok` 行は「本当に応答が流れた」という意味になります。以前の `rate-limited` での待避はなくなりました（`FreeUsageLimitError` のバケットがモデルを削除したり dead 扱いしたりすることはありません）。
</details>

<details>
<summary>バグ報告の前に知っておきたいこと</summary>

- **匿名の無料枠に乗っています。** IP 単位の枠、共有プール、混雑する時間帯があります。安定させたいならキーを持ってきてください。
- **素の `curl` は 429/403 になります。** ゲートウェイは本物の*エージェント*の通信（ハーネス preamble、目録、それらしい wire）にしか応じません。上のエージェントはどれもこれを満たしますが、手作りのチャットクライアントは満たしません。
- **ヘルスプローブはエージェントの形をしています。** 同期は各モデルに、本物の v2 クライアントと同じもの——ハーネス preamble、OpenCode の目録、`stream_options`、実際のトークン予算——を、直列で間隔を空けて送ります（同一 identity からの連続アクセスはまとめて拒否されるため）。なので `ok` は「実際にストリームが返った」という意味です。`FreeUsageLimitError` のプローブがモデルを dead にしたり一覧から消したりすることはありません。
- **フォールバックは名乗ります。** `zen_served_by` と `x-zen-served-by` / `x-zen-fallback` ヘッダで分かります。
- **`agent-tools.json` と `agent-preamble.txt` は OpenCode v2.1.4 のリクエストの採取物です。** OpenCode がハーネス文言やツールスキーマを変えたら、本物のリクエストから両方を取り直してください（ゲートは preamble の指紋を見ます。先頭139文字では足りません）。preamble はプレーンテキスト、tools は素の配列でも `{"tools":[...]}` でも読めます。
</details>

---

## 設定

`zen-proxy.json` は初回起動時に作られ、ホットリロードされ、ダッシュボードから編集できます。環境変数は起動時に優先されます。

<details>
<summary>キー</summary>

| キー | 既定値 | 説明 |
|---|---|---|
| `host` / `port` | `127.0.0.1` / `8787` | バインド先（変更には再起動が必要） |
| `upstream` | `https://opencode.ai/inference/openai/v1` | Zen ゲートウェイのベース（v2。カタログ取得だけは `/inference/v1` のまま） |
| `ua` / `autoUA` | `opencode/latest/2.1.4/cli` / `true` | v2 CLI の UA 形式。自動追従は v2 形式の UA には触れません（npm にあるのは 1.x 系だけ） |
| `clientName` / `projectHash` / `tracing` | `cli` / 自動 / `true` | v2 の同一性ヘッダ: `x-opencode-client`、インストール毎の `x-opencode-project`（`directory:<cwd>` の sha1）、`b3`/`traceparent` |
| `injectSession` | `true` | セッションヘッダのペアと affinity ペアを生成して送る |
| `agentPreamble` | `""`（= auto） | `""`/`auto` → 同梱のハーネス preamble、`off`/`none` → 付けない、それ以外 → その文字列をそのまま使う |
| `agentTools` | `true` | OpenCode の v2 目録を全リクエストで自分のツールの前に付ける。応答はエージェントが実行できる呼び出しだけを残し、対応するものは名前を戻し、残りは捨てる |
| `defaultModel` | `""` | 空 = 動く無料モデルの先頭を自動で選ぶ |
| `fallbackModels` | *[`models.json`](models.json) から* | 失敗時に順番に試す。省略するとカタログに追従。一度保存すると自分の一覧に固定 |
| `modelAliases` | `{}` | 例: `{"gpt-4o": "deepseek-v4.1-flash-free"}` |
| `responsesModels` | `["gpt-5*","gpt-6*","grok-*","muse-spark-*"]` | `/v1/responses` で扱うモデル。パターンは `*` で終われます |
| `defaultZenKey` | `""` | 匿名の `public` の代わりに使う自分の Zen キー |
| `zenKeys` / `zenKeysFile` / `zenKeysRefs` | `[]` / `""` / `[]` | Zen の資格情報を追加します。キーの配列か、`~/.dsh/.credentials.yaml` のような資格情報ファイルから読む `refs:` 名。2つ以上あるとリクエスト毎にローテーションし、`401`/`429` を返したキーは次のキーへ渡し、匿名枠は最後の受け皿として残ります。 |
| `proxyKey` | `""` | クライアントにこれを要求します。ダッシュボードと `/api/*` もロックされます |
| `rateLimitMax` / `rateLimitWindowMs` | `0`（無効） / `60000` | クライアント単位のレート制限 |
| `timeoutMs` / `cacheMs` | `120000` / `30000` | 上流のタイムアウト、`/v1/models` のキャッシュ TTL |
| `autoSync` / `autoSyncIntervalMs` | `true` / `3600000` | 新しく出た無料モデルの実行時ディスカバリ |
| `trustForwarded` | `false` | リバースプロキシ配下で `x-forwarded-for` を信頼する |
| `warpProxy` | `{ "enabled": false, "port": 8890, "hop": "", "fallback": "direct" }` | 上流への通信を、HTTP CONNECT プロキシ経由でトンネルするローカル中継に通します（Cloudflare WARP のプロキシモード、または任意の CONNECT プロキシ）。中継はホップが落ちていれば直接ソケットに切り替わります。[WARP](#warp) を参照 |

`HOST` `PORT` `ZEN_URL` `ZEN_UA` `ZEN_CLIENT` `ZEN_PROJECT_HASH` `ZEN_TRACING=0` `INJECT_SESSION=0` `AUTO_UA=0` `UA_REFRESH_MS` `AGENT_TOOLS=0` `AGENT_PREAMBLE=off` `ZEN_PROXY_AGENT_TOOLS` `ZEN_PROXY_AGENT_PREAMBLE` `PROBE_AUTH` `DEFAULT_MODEL` `FALLBACK_MODELS` `MODEL_ALIASES` `RESPONSES_MODELS` `PROXY_KEY` `ZEN_KEY` `ZEN_KEYS` `ZEN_KEYS_FILE` `ZEN_KEYS_REFS` `TRUST_FORWARDED=1` `TIMEOUT_MS` `CACHE_MS` `RATE_LIMIT_MAX` `RATE_LIMIT_WINDOW_MS` `AUTO_SYNC=0` `AUTO_SYNC_MS` `WARP_PROXY_ENABLED=0` `WARP_PROXY_PORT` `WARP_PROXY_HOP` `WARP_PROXY_FALLBACK` `ZEN_PROXY_CONFIG`

匿名の `public` アクセスは IP 単位の枠を共有していて、混雑することがあります。安定させたいなら `defaultZenKey` を設定するか、リクエスト毎に `x-zen-key` を送ってください。複数アカウント（`zenKeys`、または `zenKeysFile` の refs）を設定すると順番に使われるので、1アカウントあたりの枠が上限ではなくなります。`/api/status` にプールと各アカウントの利用数（マスク済み）が出ます。
</details>

<details>
<summary>ダッシュボード</summary>

`http://127.0.0.1:8787/` — 上流の死活と稼働時間、リクエストのライブ表示、モデルのワンクリック試験、設定の即時編集、ログの末尾表示。

![zen-proxy dashboard](assets/dashboard.png)
</details>

<details>
<summary>HTTP API</summary>

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions |
| `POST` | `/v1/responses` | OpenAI Responses API |
| `POST` | `/v1/messages` | Anthropic Messages API |
| `POST` | `/v1/messages/count_tokens` | Anthropic のトークン概算 |
| `GET` | `/v1/models` | 利用できるモデル |
| `GET` | `/health` | ヘルスチェック（常に開いています） |
| `GET` | `/` | ダッシュボード |
| `GET`/`PUT` | `/api/config` | 設定の読み書き |
| `GET` | `/api/status` | 統計と上流の状態 |
| `POST` | `/api/test` | モデルを1つ試す — `{"model":"..."}` |
| `GET` | `/api/logs` | ログの末尾 |
| `POST` | `/api/sync` | モデルディスカバリをやり直す |
| `POST` | `/api/reset` | リクエスト統計をリセット |
</details>

<details>
<summary>サービスとして常駐させる（Linux）</summary>

`install.sh` が systemd ユニットのインストールを提案します（`PATH` に `bun` があれば bun を優先します）。手動なら:

```bash
sudo systemctl enable --now zen-proxy
```

Bun が `PATH` の外にある場合（例: `~/.bun/bin/bun`）は、ユニットから明示的に指してください。無料枠は Node のスタックには応じません:

```ini
ExecStart=/home/<user>/.bun/bin/bun /path/to/zen-proxy.mjs
```
</details>

<details>
<summary><code>zen-claude</code> を使わずに手で動かす</summary>

どちらのランチャーも、環境変数を export せず `--settings` を渡します。**Claude Code は `~/.claude/settings.json` の env を読み、それがシェルより優先される**ため、そのファイルがすでに `ANTHROPIC_BASE_URL` を設定していると `export` は黙って無視されます。既存の設定はそのまま残り、素の `claude` は今までどおりそれを使います。

```bash
claude --settings ./claude/zen-proxy.settings.json
```

ピッカーは `bin/make-settings.mjs` が生成します。プロキシから実際のモデル一覧を読み（取れなければ `models.json`）、各行に `behavesAs` を設定します。Claude Code は見慣れないモデル ID でも妥当な既定値で扱え、上流へはその ID がそのまま送られます。

`zen-claude` が `command not found` になる場合は、まず `ls -l ~/.local/bin/zen-claude` を見てください。シンボリックリンクが無ければインストーラを再実行します。リンクがあるのに見つからない場合だけ、`PATH` が古いのが原因です:

```bash
export PATH="$HOME/.local/bin:$PATH"                          # この端末だけ
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc      # 永続化
```
</details>

---

## WARP

上流への通信を [Cloudflare WARP](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/cloudflare-one-client/download/) の先へ出します。話に出る理由は2つ。無料枠が出口アドレスに紐づくこと、共有・ブロック済みの出口は問答無用で拒否されることです。後者のとき上流は `FreeTierError: free models aren't available from your current network because we've detected abusive traffic from this IP address` を返します。

ホップは HTTP CONNECT プロキシです。Cloudflare WARP のプロキシモードは `127.0.0.1:40000` で喋り、他の CONNECT プロキシも同じです。そこへは小さな中継 `scripts/warp-relay.mjs` を介します。Node の環境変数プロキシにはフェイルオーバーが無く、中継が無いと WARP が止まった瞬間に上流への通信が全滅するためです。中継はトンネルをホップ経由で開き、ホップに届かなければ直接ソケットに切り替えるので、どちらでもプロキシは使えます。

```bash
sudo bash deploy/install-warp.sh          # WARP + 中継ユニット + zen-proxy の drop-in
curl -s http://127.0.0.1:8890/__status    # トンネル数、ホップ経由か直接か
curl -s http://127.0.0.1:8787/api/status  # 同じ数字をダッシュボード側から
```

インストールされるもの:

| 部品 | 場所 | 役割 |
|---|---|---|
| `cloudflare-warp` | apt（公式リポジトリ） | ホップ本体。プロキシモードで動き、ホストのルーティングには触れません |
| `zen-proxy-warp-relay.service` | `/etc/systemd/system` | 中継を `127.0.0.1:8890` で動かす |
| `zen-proxy.service.d/warp-proxy.conf` | `/etc/systemd/system` | `NODE_USE_ENV_PROXY=1` と `HTTPS_PROXY=http://127.0.0.1:8890` |

どちらのランタイムもプロセス起動時にこの変数を読みます（Bun は `HTTPS_PROXY` を直接、Node は `NODE_USE_ENV_PROXY=1` も必要）。つまりホップを有効にできるのはこの drop-in だけで、シェルで設定しても効きません。中継のポートは `HTTPS_PROXY` と一致させてください。既定はどちらも `8890` です。

元に戻す:

```bash
sudo systemctl disable --now zen-proxy-warp-relay
sudo rm /etc/systemd/system/zen-proxy-warp-relay.service \
         /etc/systemd/system/zen-proxy.service.d/warp-proxy.conf
sudo systemctl daemon-reload && sudo systemctl restart zen-proxy
sudo warp-cli --accept-tos registration delete && sudo apt-get remove -y cloudflare-warp
```

有効にする前に知っておきたいことが2つあります。上流から見えるのは自分のアドレスではなく WARP の出口アドレスになること、WARP は接続ごとに別の出口を割り当てるため、1つのアドレスに紐づいた枠が付いてくる保証はないことです。

---

<p align="center">
  <sub>💬 <a href="https://discord.gg/Dw5Ctrtuw">Discord に参加</a> — インストールの相談、トラブルシュート、いま速い無料モデルの情報。</sub>
  <br />
  <sub>冒頭のデモ動画は brag スキルで作りました。</sub>
</p>

<p align="center">
  <sub>機械可読版: <a href="llms.txt">llms.txt</a> &nbsp;·&nbsp; <a href="llms-full.txt">llms-full.txt</a></sub>
</p>

<p align="center">
  <a href="https://github.com/12errh/zen-proxy/issues">
    <img src="https://img.shields.io/github/issues/12errh/zen-proxy?style=flat-square&labelColor=1a1612&color=8b8b8b" alt="Open issues">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-8b8b8b?style=flat-square&labelColor=1a1612" alt="MIT License">
  </a>
</p>
