# つばめ卸販売管理

架空の卸売業務を題材にした、コードから仕様を読み解くための教育用アプリケーションです。
画面とバッチは同じ PostgreSQL データベースを使用します。登場する会社・商品・利用者はすべて架空です。

**サポート終了済みのフレームワークを含みます。本番業務に使用したり、インターネットへ公開したりしないでください。実データや本物の資格情報を投入しないでください。**

## 動作環境

| 項目 | バージョン |
|---|---|
| ビルド・実行 JDK | JDK 8（Temurin 8u504 で実行） |
| Java ソース・標準 API | Java 7 相当 |
| Maven | 3.9.9 |
| Web コンテナ | Tomcat 9.0.121 |
| データベース | PostgreSQL 16.10 |
| JDBC ドライバ | PostgreSQL JDBC 42.7.4 |
| Web フレームワーク | Struts 1.3.10、JSP、JSTL 1.2 |
| DI・トランザクション | Spring Framework 3.2.18.RELEASE |
| 永続化 | Hibernate 3.6.10.Final |

JDK 7 でフレームワークやサーバーを動かす構成ではありません。Maven は JDK 8 を要求します。
`verify` フェーズの Animal Sniffer により、`source` / `target` だけでは検出できない Java 8 以降の標準 API 使用も拒否します。

## コンテナで起動

Docker Engine と Compose v2 が利用できる環境では、リポジトリ直下で実行します。

```sh
docker compose up --build
```

初回起動時に空のデータベースへ DDL とデモデータが投入されます。
画面は **http://127.0.0.1:8080/wholesale/login.do** です。DB のポートはホストへ公開しません。
終了は `Ctrl+C`、再起動は同じコマンドです。DB は名前付きボリュームに保存され、再起動で初期化されません。

バッチのヘルプも独立して起動できます。

```sh
docker compose --profile batch run --rm batch help
```

`samples` はバッチコンテナ内の `/data/samples` に読み取り専用でマウントされます。
ファイル出力を使う前に `.runtime/exports` を作成してください。Linux で UID/GID が 1000 以外の場合は
`LOCAL_UID` / `LOCAL_GID` を実行利用者の値に設定します。出力先 `/data/exports` はこのディレクトリへ対応します。

## ローカルでビルド・起動

JDK 8、Maven、PostgreSQL、Tomcat 9 をあらかじめ展開・準備してください。ダウンロード済みバイナリはこのリポジトリに含めません。
`JAVA_HOME` は JDK 8、`mvn` と `psql` はコマンド検索パス上で使用できるようにします。

PostgreSQL に、所有者が `wholesale` の空の DB `wholesale` を用意します。
ローカルデモ設定はホスト `127.0.0.1`、ポート `5432`、DB 利用者 `wholesale`、パスワード `wholesale-local` です。

```powershell
$env:PGPASSWORD = 'wholesale-local'
.\scripts\initialize-database.ps1
mvn -B verify
.\scripts\start-local.ps1 -TomcatHome 'C:\tools\apache-tomcat-9.0.121'
```

初期化コマンドは**空でないスキーマを拒否**します。既存 DB の削除やリセットは行いません。
接続先を変える場合は `initialize-database.ps1` の `-HostName` / `-Port` / `-DatabaseName` / `-UserName` を指定します。
`psql` が検索パスにない場合は `-Psql 'C:\tools\pgsql\bin\psql.exe'` で指定できます。

サーバーはフォアグラウンドで起動します。終了は `Ctrl+C` です。別ポート・DB の例:

```powershell
.\scripts\start-local.ps1 -TomcatHome 'C:\tools\apache-tomcat-9.0.121' `
  -Port 18080 -DbUrl 'jdbc:postgresql://127.0.0.1:15432/wholesale' `
  -DbUser 'wholesale' -DbPassword 'wholesale-local'
```

Linux / macOS では `PGHOST` / `PGPORT` / `PGUSER` / `PGDATABASE` / `PGPASSWORD` を設定して
`sh scripts/initialize-database.sh` を実行します。ビルド後は `JAVA_HOME` と `CATALINA_HOME` を設定し、
`sh scripts/start-local.sh` で起動します。接続先を変える場合は `DB_URL` / `DB_USER` / `DB_PASSWORD`、
ポートを変える場合は `PORT` を設定します。

Tomcat の作業領域・ログは `.runtime/tomcat`、WAR は `wholesale-web/target/wholesale.war` です。
既存の Tomcat インストールの設定は変更しません。

## デモ利用者

パスワードは **`Demo-<利用者ID>-2026!`** です。例: `sales` のパスワードは `Demo-sales-2026!`。

| 利用者ID | 用途 |
|---|---|
| `sales` | 営業 |
| `manager` | 業務承認・マスタ管理 |
| `warehouse` | 倉庫業務 |
| `billing` | 請求・入金 |
| `admin` | システム管理 |
| `batch` | バッチ実行 |

ログイン後のメニューから各業務画面へ移動します。作業する業務に合わせて利用者を切り替えてください。

## バッチの起動

実行用のビルド成果物は `wholesale-batch/target/wholesale-batch-1.0.0-standalone.jar` です。
Web サーバーの起動は不要ですが、業務処理には同じ DB への接続が必要です。

```powershell
$env:WHOLESALE_BATCH_PASSWORD = 'Demo-batch-2026!'
java '-Dfile.encoding=UTF-8' '-Duser.timezone=Asia/Tokyo' `
  '-Ddb.url=jdbc:postgresql://127.0.0.1:5432/wholesale' `
  '-Ddb.username=wholesale' '-Ddb.password=wholesale-local' `
  -jar .\wholesale-batch\target\wholesale-batch-1.0.0-standalone.jar help
```

接続情報は JVM の `db.url` / `db.username` / `db.password` システムプロパティで上書きできます。
PowerShell では `-D...` 全体を引用符で囲んでください。

標準のローカル DB 設定を使う場合の実行例:

```powershell
java '-Dfile.encoding=UTF-8' -jar .\wholesale-batch\target\wholesale-batch-1.0.0-standalone.jar `
  import-products --file .\samples\products-valid.csv --run-key products-001 `
  --user batch --password-env WHOLESALE_BATCH_PASSWORD

java '-Dfile.encoding=UTF-8' -jar .\wholesale-batch\target\wholesale-batch-1.0.0-standalone.jar `
  daily-allocation --through 2026-09-10 --limit 100 --run-key allocation-20260910 `
  --user batch --password-env WHOLESALE_BATCH_PASSWORD
```

日付・実行キーは対象の作業に合わせて変更してください。同じキーと同じ内容の完了済み処理は再実行されません。
異なる内容に同じキーを流用すると拒否されます。処理中のまま残った実行は、元プロセスの停止と行結果を確認してから対処します。
終了コードは `0` 完了、`2` 引数・認証・設定エラー、`3` 行エラーまたは件数上限による部分処理、`1` 実行障害です。

受注取込は `import-orders` です。連続する同じ `external_key` の行を一つの下書きにまとめ、
グループ全体で保存・拒否します。管理者、または `BATCH` と `SALES` / `MANAGER` の両方を持つ利用者で実行してください。
通常の `batch` 利用者だけでは受注を登録できません。サンプルは `samples/orders-valid.csv` です。

```powershell
$env:WHOLESALE_ADMIN_PASSWORD = 'Demo-admin-2026!'
java '-Dfile.encoding=UTF-8' -jar .\wholesale-batch\target\wholesale-batch-1.0.0-standalone.jar `
  import-orders --file .\samples\orders-valid.csv --run-key orders-001 `
  --user admin --password-env WHOLESALE_ADMIN_PASSWORD
```

明細出力は `export-shipments` / `export-receipts` / `export-order-lines` を使用します。
`--output` は未作成ファイル、`--limit` は件数上限です。対応する `--from` / `--to` / `--status` と
継続カーソルの詳細は `help` を参照してください。

## 自動テスト

`mvn verify` は単体テストと Java 7 API 制約を実行します。
PostgreSQL を必要とするテストは、専用 DB を用意して `db.tests=true` を指定した場合に実行されます。
H2 等への自動置換や、DB 接続失敗を成功として扱う動作はありません。

```powershell
.\scripts\initialize-database.ps1 -DatabaseName wholesale_test
mvn -B verify '-Ddb.tests=true' `
  '-Ddb.url=jdbc:postgresql://127.0.0.1:5432/wholesale_test' `
  '-Ddb.username=wholesale' '-Ddb.password=wholesale-local'
```

テスト用 DB 名は `wholesale_test` または `wholesale_test_` で始まる名前にします。
GitHub Actions では PostgreSQL でのテストに加え、Tomcat 上の WAR とバッチを実行します。

Node.js 22 以降があれば、起動中のデモ環境に対して HTTP と単独 JAR の検査も実行できます。
検査は架空のマスタ・伝票を登録するため、検査用の環境を指定してください。

```powershell
node .\scripts\http-smoke.mjs http://127.0.0.1:8080/wholesale
$env:SMOKE_BASE_URL = 'http://127.0.0.1:8080/wholesale'
node .\scripts\batch-smoke.mjs
```

DB が標準設定と異なる場合は、バッチ検査用の `DB_URL` / `DB_USER` / `DB_PASSWORD` を設定します。
`SMOKE_BASE_URL` の指定時は、先に HTTP 検査を実行してください。日次引当・月次請求を単独 JAR で処理し、
Web 画面からその結果を確認します。検査結果とログは `.runtime/smoke` に保存されます。

## ソース規模

2026-09-08 時点の本体は **23,416 行**です（cloc 2.10 の空白・コメントを除くコード行）。
依存ライブラリ・生成物・テスト・デモデータは本体に含めていません。

| 分類 | ファイル数 | コード行 |
|---|---:|---:|
| Java | 265 | 18,864 |
| JSP・JSP断片 | 101 | 1,760 |
| Hibernate マッピング XML | 14 | 1,019 |
| その他の本体 XML | 17 | 382 |
| DDL SQL | 14 | 1,391 |

別集計は Java テスト 10,696 行、シード SQL 121 行、Maven・実行設定 XML 299 行です。
HTTP/CLI 検査用 JavaScript と起動スクリプトも本体の上記数値には含めません。
再計測は `.\scripts\measure-source.ps1 -Cloc 'cloc.exeのパス'` で実行できます。
結果は `.runtime/source-metrics.json` にファイル別で保存されます。
