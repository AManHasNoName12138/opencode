# OpenCode Linux / Windows 源码构建、独立安装与并存手册

> 更新：2026-10-13。仅讨论当前 V2 架构的 CLI/TUI、Linux 和原生 Windows。
>
> Linux 已通过 `curl -fsSL https://opencode.ai/v2/install | bash` 安装官方版；Windows 已下载并解压 [opencode-windows-x64.zip（2.0.6）](https://opencode.ai/files/bin/2.0.6/opencode-windows-x64.zip)。本文保留这两份安装，另外构建、安装源码开发版。
>
> 本文依据的上游 `dev` 快照是 `e31136bdbdb43e934d8bbd81e75a2065a2625699`，根包版本 `2.0.26`。已核对本地相关实现与该快照一致；后续分支继续前进时，以实际提交重新检查本文标出的构建和隔离边界。

源码开发版用于**学习源码、功能开发和测试**，统一使用 `opencode-dev` 作为启动入口名称。

最终使用方式：**官方版继续运行原来的 `opencode`；源码开发版只通过专用启动器运行。** 两者的程序文件、数据库、凭据、配置、缓存、临时目录、后台服务和项目副本各自独立。

| 开发机 | 官方版入口 | 源码开发版入口 | 源码开发版根目录，简称 `ROOT` |
| --- | --- | --- | --- |
| Linux | 原来的 `opencode`，通常是 `~/.opencode/bin/opencode` | `~/opencode-dev/opencode-dev` | `~/opencode-dev` |
| Windows | 官方 ZIP 解压目录中的 `opencode.exe` | `& "$env:LOCALAPPDATA\OpenCodeDev\opencode-dev.ps1"` | `%LOCALAPPDATA%\OpenCodeDev` |

执行顺序：先读第 1–2 节，Linux 按第 3 节，Windows 按第 4 节，再完成第 5 节并存验收。第 6 节用于日常修改、更新和回退。

## 1. 当前源码中影响构建和并存的机制

### 1.1 `dev` 现在就是当前实现

用户提供的 [5caf1f9：chore: promote v2 to dev](https://github.com/anomalyco/opencode/commit/5caf1f9f6f5f30e13fc50a788ad953d97ae3748f) 于 2026-10-10 将 V2 提升到 `dev`；它是本文快照的祖先。新开发从 `dev` 或本文固定提交建立分支，不再按旧手册寻找另一套入口。

当前运行链路是：

```text
根目录 bun run dev
  → packages/cli/src/index.ts
  → CLI 命令处理器 / packages/tui
  → ServerConnection：显式远程服务、独占子服务或托管后台服务
  → packages/server：HTTP API 与运行时组装
  → packages/core：会话、工具、配置、凭据与数据库
```

`packages/schema`、`packages/protocol` 定义契约，`packages/client` 提供客户端，`packages/app` 提供构建时嵌入的 Web UI。本文构建的是 CLI/TUI 可执行文件，不是 Electron 桌面安装包。[源码：package.json][S1]、[CONTRIBUTING.md][S2]

### 1.2 构建版本与 channel 必须显式控制

`opencode-dev` 是开发启动器的名称；编译 channel 保持 `local`。不要因入口改名而将 channel 改为 `dev`，后者在当前源码中与官方发布通道共享部分默认路径和服务设置。

[packages/script/src/index.ts][S3] 从环境变量、发布参数和 Git 分支推导 channel/version：

- Bun 版本约束来自根包的 `packageManager: bun@1.4.2`，脚本实际接受 `^1.4.2`。本文固定 **Bun 1.4.2**，避免直接沿用旧开发环境中的 1.3.x。
- 在 `dev` 上直接构建，默认 channel 是 `dev`。它与 `latest`、`beta`、`next` 共用默认服务文件名和端口；数据库默认名称也相同。
- 本文启动器强制构建为 **`local`**，版本为 `0.0.0-local-<UTC年月日时分秒>`，记录启动构建时的秒级时间，便于安装、定位进程和切换版本。重复安装已有产物不会生成新版本号。
- 编译产物中的 channel/version 是构建时常量。运行旧二进制时临时设置 `OPENCODE_CHANNEL`，不会把它改造成另一条发布通道。
- `OPENCODE_RELEASE` 在 `Script.release` 中按非空字符串判断，设置为 `0` 也不代表关闭。它用于发布流程；本文的 `packages/cli/script/build.ts` 不使用它控制本地构建。启动器不继承发布参数，也不继承会影响版本推导或 Bun 编译器选择的 `OPENCODE_BUMP`、`BUN_COMPILE_RELEASE`。

发布流程中的使用方包括根目录 [script/publish.ts][S27]、CLI/桌面发布脚本；[桌面发布元数据脚本][S28] 还直接把 `OPENCODE_RELEASE` 当作 GitHub release ID。源码构建无需设置这个变量。

[version.ts][S4] 将 `channel === "local"` 视为本地构建；[updater.ts][S5] 的自动更新检查会跳过它。启动器另设 `OPENCODE_DISABLE_AUTOUPDATE=1`，并在开发配置中写入 `"update": "disable"`。

**手工 `upgrade`/`update --method ...` 是另一条命令路径，不能仅凭 local channel 假定绝不会执行安装。** 启动器拦截直接调用 `upgrade`、`update`、`uninstall`；源码开发版更新统一重新构建并切换版本目录。不要绕过启动器调用这些命令。[升级处理器][S6]

### 1.3 真正要隔离的状态

下面是本文源码开发版的布局；四个 XDG 变量指向表中的父目录，OpenCode 会再追加 `opencode`。

| 对象 | 源码开发版位置 / 设置 | 源码原因 |
| --- | --- | --- |
| 安装包 | `ROOT/releases/<版本>/bin/opencode[.exe]` | 独立复制构建产物，不覆盖官方入口 |
| 当前版本 | `ROOT/current.txt` | 启动器读取版本号，更新时切换指针 |
| 主目录 | `ROOT/home` | `os.homedir()`、全局 `.agents`、`.claude`、`~` 路径展开都需要独立 |
| 全局配置 | `ROOT/config/opencode` | XDG 配置加 `OPENCODE_CONFIG_DIR` 明确固定 |
| 数据库 | `ROOT/data/opencode/opencode-local.db` | channel 默认后缀加显式 `OPENCODE_DB` 双重固定 |
| 凭据、会话 | 开发数据库内 | 当前 `Credential` 使用 SQL 表；不是简单复制旧认证文件 |
| 缓存 / 下载工具 | `ROOT/cache/opencode` / 其 `bin` 子目录 | 与官方缓存分开 |
| 日志 / 仓库数据 | `ROOT/data/opencode/log`、`repos` | 均从开发 data 根派生 |
| 状态 / TUI | `ROOT/state/opencode`，TUI 在其 `local/tui` 子目录 | 与官方服务记录、客户端状态分开 |
| CLI/TUI 设置 | `ROOT/config/opencode/cli.json` | 当前客户端配置独立于服务端的 `opencode.json` |
| 服务配置 | `ROOT/config/opencode/service-local.json` | 配置、口令和持久化服务环境在这里 |
| 服务注册 | `ROOT/state/opencode/service-local.json` | 记录该服务的 PID、URL、版本和认证信息 |
| 临时文件 | `ROOT/tmp/opencode` | OpenCode 使用 `os.tmpdir()`；只设 XDG 不会改变它 |
| 持久终端 | `ROOT/state/opencode/pty` | 当前守护进程从 `global.state` 派生运行目录 |
| 运行目录 / 工具缓存 | `ROOT/runtime`、`ROOT/cache/bun`、`ROOT/cache/npm` | 子进程沿用开发环境 |
| 源码与测试项目 | `ROOT/workspaces/...` | 独立 clone，避免两个版本同时改同一工作目录 |

依据：[全局路径][S7]、[XDG roots][S8]、[数据库路径][S9]、[凭据存储][S10]、[服务配置][S11]、[持久终端][S12]、[CLI 配置][S25]、[TUI 存储][S26]。

当前 `latest/dev/beta/next` 默认服务端口是 `49374`，`local` 默认是 `49375`。**端口不是隔离命名空间**：本文另为源码开发版指定未占用的 `127.0.0.1:49476`，并在启动前检查；如冲突，选另一空闲端口。不要照搬官方的 `service*.json`，也不要把开发服务端口改成官方服务端口。

默认 TUI 对版本不匹配的托管服务采用替换策略；服务发现依据注册文件和服务探测。若直接复用官方状态目录，就可能重启官方服务。`dev:live` 更是有意读取原来 `opencode service status` 和口令、连接已安装服务，**不用于本文的隔离开发**。[连接选择][S13]、[TUI 入口][S14]、[服务启动][S15]

### 1.4 构建脚本具体做了什么

本文统一执行 [packages/cli/script/build.ts][S16]，采用 Bun 编译路线：

1. 清理 `packages/cli/dist`，按目标补充 OpenTUI/PTY 依赖。
2. 构建 `packages/app`，把 Web UI 压缩为 `.cache/bun-app-archive.bin` 后嵌入。
3. 处理插件运行模块、平台文件监视器、可用平台的 `opencode-pty` 资产。
4. `Bun.build({ compile: ... })` 生成原生平台可执行文件，并检查产物内容。

产物目录为 `cli-*`，而 `--target` 参数以 `opencode-*` 开头：

| 主机 / 目标 | `--target=` | 相对 `packages/cli/dist` 的产物 |
| --- | --- | --- |
| Linux x64 glibc | `opencode-linux-x64` | `cli-linux-x64/bin/opencode` |
| Linux ARM64 glibc | `opencode-linux-arm64` | `cli-linux-arm64/bin/opencode` |
| Linux x64 musl | `opencode-linux-x64-musl` | `cli-linux-x64-musl/bin/opencode` |
| Linux ARM64 musl | `opencode-linux-arm64-musl` | `cli-linux-arm64-musl/bin/opencode` |
| Windows x64 | `opencode-windows-x64` | `cli-windows-x64/bin/opencode.exe` |

构建脚本还接受 x64 `-baseline` 目标；musl 的顺序是 `opencode-linux-x64-baseline-musl`。需要时同时调整目标和产物目录。`--single` 按运行 Bun 的平台/架构选择，默认不选 musl；这里用显式目标消除歧义。

首次构建保留默认依赖安装和 Web UI 构建。`--skip-web-ui` 会嵌入空归档，并不是复用上一次 Web UI；`--skip-install` 只适合已确认目标平台依赖齐全的情况。仓库另有 `build-node.ts` 的 Node SEA 路线，参数和产物不要与本文混用。

**不要把 `--outdir` 指向安装目录、开发配置目录或源码根目录。** 脚本会递归清理输出目录；本文保留默认 `dist`，再把产物复制到仓库外安装。构建完成后，已安装副本不依赖这份 `dist` 或源码目录持续存在。[Web UI 打包][S17]

## 2. 启动器与隔离边界

本手册附带两个可复制使用的启动器：

- Linux：[scripts/opencode-dev.sh](scripts/opencode-dev.sh)，保存为 LF 换行，安装时命名为 `opencode-dev`；仓库已通过 `.gitattributes` 固定其 LF 换行。
- Windows：[scripts/opencode-dev.ps1](scripts/opencode-dev.ps1)，要求 **PowerShell 7.3+（`pwsh`）**，用 `&` 调用。

将对应脚本复制到开发安装根目录，脚本所在目录就是 `ROOT`。不要 `source` / dot-source；不要把开发可执行文件目录加入全局 PATH，也不要覆盖现有 `opencode` alias。启动器内部会把开发可执行文件目录放在子进程 PATH 首位。

启动器从环境变量白名单重建运行环境：保留系统运行、终端、PATH、代理和证书配置；不继承官方 OpenCode 覆盖项、服务口令、提供商 API Key、发布参数或 shell 启动钩子。Windows 同时改写子进程的 `HOME/USERPROFILE/HOMEDRIVE/HOMEPATH/APPDATA/LOCALAPPDATA`，Linux 改写子进程 `HOME`；两端同时固定 XDG 和临时目录。Windows 调用结束或异常退出后恢复调用它的 PowerShell 环境和工作目录。

Bun 源码运行及构建还可能加载开发 clone 中的 `.env`；不要从官方项目复制带有官方 DB、服务 URL 或发布参数的环境文件。编译产物的 Bun `autoloadDotenv` 已由构建脚本关闭。

`--exec /程序绝对路径 参数...` 是启动器的辅助模式，用同一套环境执行 Bun、Git 或诊断程序；它保留当前工作目录。普通启动若发现当前目录不在 `ROOT` 下，则从 `ROOT/workspaces/scratch` 启动，避免在系统目录或官方项目里误开会话。传入显式项目路径时仍需自己选择开发副本。

默认设定 `OPENCODE_CONFIG_PROJECT_DISABLE=1`，关闭服务端项目配置和项目指令发现。开发配置、规则、MCP、插件等从 `ROOT/config/opencode` 和开发 home 配置；按需单独配置身份、登录账号。不要把官方数据库、服务注册文件或整套配置链接到这里。[配置发现][S18]、[项目指令][S19]

这里有两个需要据源码区分的边界：

1. 当前 TUI 的自定义主题仍独立扫描工作目录祖先的 `.opencode/themes`，不受上述服务端开关控制。检查开发目录祖先是否有官方自定义主题；如有，将开发根目录放到没有这些祖先配置的路径。不能声称一个环境变量关闭了全部目录发现。[主题发现][S20]
2. 这套方案隔离应用状态和通常的开发流程，**不改变操作系统账户权限**。不要让两套会话修改同一项目副本，也不要配置指向官方数据的绝对路径、软链接或服务 URL。若要约束任意修改后的代码/插件都无法访问官方文件，需要独立 OS 账户或虚拟机；环境变量不是文件访问沙箱。

两台机器分别初始化 ROOT、服务口令和数据；无需同步 `data/state/tmp`，尤其不要同步运行中的 SQLite 数据库。可以同步开发分支的源码提交，分别构建本机目标。

## 3. Linux：构建并安装源码开发版

### 3.1 记录官方安装，创建新目录

使用 Bash。准备 Git、curl、unzip、CA 证书和提供 `ss` 的 iproute2；Linux Bun 的系统要求见 [Bun 安装文档](https://bun.com/docs/installation)。以下从**包含本手册及其 scripts 的仓库目录**开始，在同一终端依次执行；`GUIDE_REPO` 仅用来复制启动器，实际开发会另建 clone。

```bash
set -euo pipefail
GUIDE_REPO="$(git rev-parse --show-toplevel)"
OFFICIAL="$HOME/.opencode/bin/opencode"
OC_ROOT="$HOME/opencode-dev"
OC="$OC_ROOT/opencode-dev"
BUN="$OC_ROOT/tools/bun/bin/bun"
OC_SOURCE="$OC_ROOT/workspaces/opencode"
PIN=e31136bdbdb43e934d8bbd81e75a2065a2625699

type -a opencode
test -x "$OFFICIAL"
"$OFFICIAL" --version
test ! -e "$OC_ROOT"  # 初始化要求新目录；后续更新使用第 6 节
umask 077
mkdir -p "$OC_ROOT"/{downloads,tools/bun/bin,config/opencode,workspaces,releases}
install -m 755 "$GUIDE_REPO/study-notes/scripts/opencode-dev.sh" "$OC"
sha256sum "$OFFICIAL" > "$OC_ROOT/official-sha256.before"
"$OFFICIAL" service status > "$OC_ROOT/official-service.before"
printf '%s\n' '{"update":"disable"}' > "$OC_ROOT/config/opencode/opencode.json"
printf '%s\n' '{"hostname":"127.0.0.1","port":49476}' > "$OC_ROOT/config/opencode/service-local.json"
```

安装脚本 URL 是滚动入口，Linux 官方版的实际版本以此时 `--version` 为准。若 `type -a` 显示日常入口另有位置，将 `OFFICIAL` 改成实际官方文件绝对路径，并一直使用该路径验收。

**不要执行 `./install --binary ...` 来安装源码开发版。** 当前 [官方安装器](https://opencode.ai/v2/install) 将目标固定为 `$HOME/.opencode/bin`；`--no-modify-path` 也不会更换安装目录。本文用独立目录复制安装。

### 3.2 独立准备 Bun 1.4.2

直接使用 [Bun 1.4.2 发布资产](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2)，放入开发工具目录，不修改已有 Bun 或 shell 配置。

```bash
case "$(uname -m)" in
  x86_64) ARCH=x64; BUN_ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64; BUN_ARCH=aarch64 ;;
  *) echo '请先确认 Bun 和 OpenCode 支持该架构' >&2; exit 1 ;;
esac
BUN_ASSET="bun-linux-$BUN_ARCH"
TARGET="opencode-linux-$ARCH"
if [[ -f /etc/alpine-release ]] || (ldd --version 2>&1 || true) | grep -qi musl; then
  BUN_ASSET="$BUN_ASSET-musl"
  TARGET="$TARGET-musl"
fi
ARTIFACT="${TARGET/opencode-/cli-}"
curl -fL "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/$BUN_ASSET.zip" \
  -o "$OC_ROOT/downloads/bun-1.4.2.zip"
unzip -q "$OC_ROOT/downloads/bun-1.4.2.zip" -d "$OC_ROOT/downloads/bun-1.4.2"
install -m 755 "$OC_ROOT/downloads/bun-1.4.2/$BUN_ASSET/bun" "$BUN"
"$OC" --exec "$BUN" --version
```

确认输出 `1.4.2`。OpenCode 的 ARM64 目标名使用 `arm64`，Bun 1.4.2 的 Linux ARM64 发布资产及解压目录使用 `aarch64`，因此分开设置 `ARCH` 与 `BUN_ARCH`；musl 资产对应 `bun-linux-aarch64-musl.zip`。[Bun 官方资产清单](https://github.com/oven-sh/bun/releases/expanded_assets/bun-v1.4.2)

启动器会把这份 Bun 放在内部 PATH 首位，因此构建脚本再调用 `bun` 时也使用同一份。

### 3.3 获取源码并构建

```bash
"$OC" --exec "$(command -v git)" clone --branch dev \
  https://github.com/anomalyco/opencode.git "$OC_SOURCE"
cd "$OC_SOURCE"
git switch -c source-dev "$PIN"
git rev-parse HEAD

"$OC" --exec "$BUN" install --frozen-lockfile
# 在这里修改源码；检查命令仍从仓库根运行
"$OC" --exec "$BUN" run check
"$OC" --exec "$BUN" run packages/cli/script/build.ts "--target=$TARGET"
test -x "$OC_SOURCE/packages/cli/dist/$ARTIFACT/bin/opencode"
git diff --stat
```

`source-dev` 从已分析的 `dev` 快照出发。要跟随之后的 `upstream/dev`，先按第 6 节更新并核对源码，不要把旧快照的结论自动视作永远有效。若修改需要提交，可给此 clone 添加自己的 fork remote；它不会改变原来的工作仓库。

依赖下载、Web UI 构建和可执行文件编译均可能访问网络。构建脚本内部还会补充目标依赖，构建后检查 `git diff`，确认是否有锁文件变化。若只是首次验证未修改源码，`check` 也可帮助发现环境或上游快照问题；失败时先处理错误再安装。

### 3.4 把产物安装到仓库外

继续在 `$OC_SOURCE` 根目录执行。下面通过专用 Bun 和启动器读取**已构建产物**的 `package.json`；该次调用生成的环境版本号不会改写产物中的版本。`ARTIFACT` 使用第 3.2 节生成的目标目录名。

```bash
VERSION="$("$OC" --exec "$BUN" -p \
  "require('./packages/cli/dist/$ARTIFACT/package.json').version")"
[[ "$VERSION" =~ ^0\.0\.0-local-[0-9]+$ ]]
RELEASE="$OC_ROOT/releases/$VERSION"
test ! -e "$RELEASE"
cp -a "$OC_SOURCE/packages/cli/dist/$ARTIFACT" "$RELEASE"
git rev-parse HEAD > "$RELEASE/source-commit.txt"
git diff --binary HEAD > "$RELEASE/source-changes.patch"
git status --short > "$RELEASE/source-status.txt"
sha256sum "$RELEASE/bin/opencode" > "$RELEASE/binary.sha256"
"$OC" --exec "$RELEASE/bin/opencode" --version
printf '%s\n' "$VERSION" > "$OC_ROOT/current.txt.new"
mv -f "$OC_ROOT/current.txt.new" "$OC_ROOT/current.txt"
"$OC" --version
"$OC" debug paths
```

`source-changes.patch` 记录已跟踪文件的修改；未跟踪的新源码只会出现在 status 中。需要完整复现时，应先提交所有源码修改或另行保管新文件。不要把 API Key 放进源码或补丁。

现在已经完成源码开发版安装。常用入口可以是独立 alias：`alias opencode-dev="$OC_ROOT/opencode-dev"`；保留原来的 `opencode`。不通过把 release/bin 加入全局 PATH 来切换。

### 3.5 第一次启动

先检查端口；有输出时不要启动，改 `service-local.json` 中的端口并重新检查。

```bash
ss -ltnp 'sport = :49476'
cd "$OC_ROOT/workspaces"
"$OC" --exec "$(command -v git)" clone https://github.com/anomalyco/opencode.git sandbox-project
cd sandbox-project
"$OC" service start
"$OC" service status
"$OC" api server.info
"$OC" .
```

`ss` 的表头不算占用；实际监听行必须为空。这里用独立 clone 演示项目隔离，实际可替换成自己的项目仓库。源码开发版初次启动没有官方会话和凭据，使用 `"$OC" auth login` 或 TUI 单独登录；退出 TUI 后，开发托管服务继续运行。

## 4. Windows：原生构建并安装源码开发版

### 4.1 环境与官方 ZIP 安装

使用 Windows Terminal 中的 **PowerShell 7.3+**，准备 Git for Windows。Bun 当前文档要求 Windows 10 1809 或更新；本文使用 x64 原生目标。[Bun 系统要求](https://bun.com/docs/installation)

官方 [2.0.6 ZIP](https://opencode.ai/files/bin/2.0.6/opencode-windows-x64.zip) 继续保留原解压位置。先定位实际 `opencode.exe`，不要假定它位于 `.opencode/bin`；也不要将新的产物解压或复制到那个目录。

以下从包含本手册和 scripts 的仓库目录开始，在同一终端依次执行：

```powershell
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion -lt [version]'7.3') { throw '请使用 PowerShell 7.3+ (pwsh)' }
$GuideRepo = git rev-parse --show-toplevel 2>$null
if ($LASTEXITCODE -ne 0 -or -not $GuideRepo) { throw '请从包含本手册的 Git 仓库执行' }
$GuideRepo = $GuideRepo.Trim()
$OcRoot = Join-Path $env:LOCALAPPDATA 'OpenCodeDev'
$Oc = Join-Path $OcRoot 'opencode-dev.ps1'
$Bun = Join-Path $OcRoot 'tools/bun/bin/bun.exe'
$OcSource = Join-Path $OcRoot 'workspaces/opencode'
$Pin = 'e31136bdbdb43e934d8bbd81e75a2065a2625699'
$Git = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
$Official = (Get-Command opencode.exe -CommandType Application | Select-Object -First 1).Source

Get-Command opencode.exe -All | Select-Object Source
& $Official --version
if ($LASTEXITCODE -ne 0) { throw '官方程序验证失败' }
if (Test-Path -LiteralPath $OcRoot) { throw '初始化要求新目录；更新已有源码开发版见第 6 节' }
foreach ($part in @('downloads', 'tools/bun/bin', 'config/opencode', 'workspaces', 'releases')) {
    New-Item -ItemType Directory -Path (Join-Path $OcRoot $part) -Force | Out-Null
}
Copy-Item -LiteralPath (Join-Path $GuideRepo 'study-notes/scripts/opencode-dev.ps1') -Destination $Oc
Get-FileHash -LiteralPath $Official -Algorithm SHA256 | ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $OcRoot 'official-sha256.before.json') -Encoding utf8
& $Official service status | Set-Content -LiteralPath (Join-Path $OcRoot 'official-service.before')
'{"update":"disable"}' |
    Set-Content -LiteralPath (Join-Path $OcRoot 'config/opencode/opencode.json') -Encoding utf8
'{"hostname":"127.0.0.1","port":49476}' |
    Set-Content -LiteralPath (Join-Path $OcRoot 'config/opencode/service-local.json') -Encoding utf8
```

如果官方目录未在 PATH 中，把 `$Official` 赋值那行改成实际绝对路径，例如 `D:\Apps\OpenCode-2.0.6\opencode.exe`。若存在多个安装，以实际从指定 ZIP 解压且日常使用的文件为准。`--version` 应与实际安装吻合，不能只按 ZIP 文件名推定它从未更新。

`$OcRoot` 可以改成自己有写权限的短路径，例如 `D:\opencode-dev`。设置后整套步骤保持一致；不要设置或覆盖 PowerShell 的只读 `$HOME` 变量。脚本通过子进程环境控制开发主目录，不修改 Windows 用户配置文件位置或系统注册表。

Git for Windows 默认 Bash 路径为 `C:\Program Files\Git\bin\bash.exe`。启动器会据此设置 `OPENCODE_GIT_BASH_PATH`；若安装在别处，修改脚本中这一行。这供 Windows 原生版运行需要 Bash 的工具使用，主 CLI、Bun、服务及数据路径均为 Windows 原生实现。

### 4.2 安装独立 Bun 并获取源码

```powershell
$BunZip = Join-Path $OcRoot 'downloads/bun-1.4.2.zip'
$BunUnpack = Join-Path $OcRoot 'downloads/bun-1.4.2'
Invoke-WebRequest 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-windows-x64.zip' -OutFile $BunZip
Expand-Archive -LiteralPath $BunZip -DestinationPath $BunUnpack
Copy-Item -LiteralPath (Join-Path $BunUnpack 'bun-windows-x64/bun.exe') -Destination $Bun
& $Oc --exec $Bun --version
if ($LASTEXITCODE -ne 0) { throw 'Bun 验证失败' }

& $Oc --exec $Git clone --branch dev https://github.com/anomalyco/opencode.git $OcSource
if ($LASTEXITCODE -ne 0) { throw 'clone 失败' }
Set-Location -LiteralPath $OcSource
& $Git switch -c source-dev $Pin
if ($LASTEXITCODE -ne 0) { throw '源码快照切换失败' }
& $Git rev-parse HEAD
& $Oc --exec $Bun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
```

确认 Bun 输出 `1.4.2`。已有 `C:\Users\<用户>\.bun\bin\bun.exe` 即使可用，也可能仍是 1.3.x；此处不升级或替换它。

### 4.3 修改、检查和构建

在独立 clone 中完成代码修改，然后在它的根目录执行：

```powershell
Set-Location -LiteralPath $OcSource
& $Oc --exec $Bun run check
if ($LASTEXITCODE -ne 0) { throw '源码检查失败，先解决错误' }
& $Oc --exec $Bun run packages/cli/script/build.ts --target=opencode-windows-x64
if ($LASTEXITCODE -ne 0) { throw '构建失败' }
$Artifact = Join-Path $OcSource 'packages/cli/dist/cli-windows-x64'
if (-not (Test-Path -LiteralPath (Join-Path $Artifact 'bin/opencode.exe'))) { throw '未找到构建产物' }
& $Git diff --stat
```

Windows 原生构建包含 Windows OpenTUI、PTY、文件监视器依赖。构建脚本支持此目标不等于所有功能与 Linux 完全相同：当前 [persistent-pty/binary.bun.ts][S21] 明确在 `win32` 返回不可用，[服务信息][S22] 会报告 `persistentPty: false`；普通 PTY 仍有 [Windows ConPTY 处理][S23]。不要把“跨服务重启保留持久终端”作为当前 Windows 原生版的已支持功能。

### 4.4 安装到独立版本目录

```powershell
$Version = (Get-Content -LiteralPath (Join-Path $Artifact 'package.json') -Raw | ConvertFrom-Json).version
if ($Version -notmatch '^0\.0\.0-local-[0-9]+$') { throw '构建未使用预期的 local 版本号' }
$Release = Join-Path $OcRoot "releases/$Version"
if (Test-Path -LiteralPath $Release) { throw '版本目录已存在，请勿重复安装同一产物；需要更新时先重新构建' }
Copy-Item -LiteralPath $Artifact -Destination $Release -Recurse
& $Git rev-parse HEAD | Set-Content -LiteralPath (Join-Path $Release 'source-commit.txt')
& $Git diff --binary "--output=$(Join-Path $Release 'source-changes.patch')" HEAD --
if ($LASTEXITCODE -ne 0) { throw '记录源码补丁失败' }
& $Git status --short | Set-Content -LiteralPath (Join-Path $Release 'source-status.txt') -Encoding utf8
Get-FileHash -LiteralPath (Join-Path $Release 'bin/opencode.exe') -Algorithm SHA256 |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Release 'binary.sha256.json')
& $Oc --exec (Join-Path $Release 'bin/opencode.exe') --version
if ($LASTEXITCODE -ne 0) { throw '安装包自检失败' }
$Version | Set-Content -LiteralPath (Join-Path $OcRoot 'current.txt.new') -Encoding utf8
Move-Item -LiteralPath (Join-Path $OcRoot 'current.txt.new') -Destination (Join-Path $OcRoot 'current.txt') -Force
& $Oc --version
& $Oc debug paths
```

每次安装都复制到新的版本目录。Windows 运行中的 `.exe` 可能被锁定，更新前关闭开发 TUI、停止开发服务即可；不需要结束所有同名 `opencode.exe` 进程，也不要使用 `taskkill /IM opencode.exe /F`。

`source-changes.patch` 由 Git 的 `--output` 直接写出，保留文本及二进制补丁的原始字节。选项放在 `HEAD` 前、输出路径与 `--output=` 作为同一个参数传递，遵循 [Git 命令行约定](https://git-scm.com/docs/gitcli)。不要通过 PowerShell 的 `Set-Content` 管道转存补丁，换行转换可能使 `git apply` 失败。与 Linux 步骤一样，此补丁仅记录已跟踪文件的修改，新文件应提交或另外保管。

如果脚本受本机执行策略限制，可在检查脚本后按组织允许的方式签名/解除文件阻止，或用 `pwsh -NoProfile -ExecutionPolicy Bypass -File "$Oc" ...` 对该次进程运行；无需修改全机执行策略。不要在 Windows PowerShell 5.1 下勉强运行启动器，它对含空格、引号和结尾反斜杠的原生参数处理不同。

### 4.5 第一次启动

```powershell
if (Get-NetTCPConnection -LocalPort 49476 -State Listen -ErrorAction SilentlyContinue) {
    throw '49476 已被占用，请在开发 service-local.json 中选择另一个空闲端口'
}
Set-Location -LiteralPath (Join-Path $OcRoot 'workspaces')
& $Oc --exec $Git clone https://github.com/anomalyco/opencode.git sandbox-project
if ($LASTEXITCODE -ne 0) { throw '测试项目 clone 失败' }
Set-Location -LiteralPath (Join-Path $OcRoot 'workspaces/sandbox-project')
& $Oc service start
if ($LASTEXITCODE -ne 0) { throw '开发服务启动失败' }
& $Oc service status
& $Oc api server.info
& $Oc .
```

需要登录时执行 `& $Oc auth login`，身份保存在开发数据库。可在当前用户的 PowerShell profile 中增加名称不同的快捷函数：

```powershell
function opencode-dev { & "$env:LOCALAPPDATA\OpenCodeDev\opencode-dev.ps1" @args }
```

自定义了 `$OcRoot` 时，相应调整函数中的绝对路径。保留原来的 `opencode` 命令和官方 PATH。

## 5. 两机分别完成并存验收

### 5.1 先比较客户端路径，再核对真正的服务

Linux 执行 `"$OFFICIAL" debug paths` 与 `"$OC" debug paths`；Windows 执行 `& $Official debug paths` 与 `& $Oc debug paths`。如果旧官方版本不支持某诊断子命令，不要为了验收先升级它；记录其既有安装和服务位置即可。

源码开发版的 `home/config/data/state/cache/tmp/db` 必须全部在 ROOT 内，其中 home 必须是 `ROOT/home`。如果出现官方目录，停止开发服务并修正启动器后再继续，不导入真实会话或凭据。

`debug paths` 仅证明当前 CLI 的路径。再执行源码开发版 **`api server.info`**，检查实际服务返回的 `version`、`pid`、`paths` 与开发安装吻合；`service status` 应返回选定的 `http://127.0.0.1:49476`。不要通过 `--server` 指向官方服务，也不要注入官方 `OPENCODE_PASSWORD`。

查看服务注册时只打印必要字段，避免把文件中的口令复制进日志或截图：

```bash
"$OC" --exec "$BUN" -p '
const fs = require("node:fs");
const path = require("node:path");
const r = JSON.parse(fs.readFileSync(path.join(process.env.XDG_STATE_HOME, "opencode/service-local.json"), "utf8"));
JSON.stringify({version:r.version, pid:r.pid, url:r.url});'
```

```powershell
$PersonalService = Get-Content -LiteralPath (Join-Path $OcRoot 'state/opencode/service-local.json') -Raw | ConvertFrom-Json
$PersonalService | Select-Object version, pid, url
Get-Process -Id $PersonalService.pid -ErrorAction Stop | Select-Object Id, Path
```

Linux 可用 `readlink -f /proc/<上一步PID>/exe` 查看实际服务可执行文件，应该位于开发 release 下。Windows 的 Path 也应指向源码开发版的版本目录。

若提示 PID 不存在、Path 为空或路径不在预期的开发 release 下，则本项验收未通过。注册文件可能留下已退出进程的信息；重新执行开发启动器的 `service status` 和 `api server.info` 核对。若服务已停止，先启动开发 TUI，再读取新的注册信息；反复退出时检查开发日志。

### 5.2 同时使用并验证停止互不影响

1. 终端 A 使用原来的官方 `opencode` 打开日常项目，确认原有会话、配置和账号仍在。
2. 终端 B 使用开发启动器打开 `ROOT/workspaces` 中的独立项目副本，建立一条测试会话。
3. 确认两边能同时工作，开发会话只出现在源码开发版，官方服务 PID/URL 没有因启动源码开发版而被替换。
4. 关闭开发 TUI，执行开发启动器的 `service stop`；官方会话应继续可用。再次启动源码开发版，检查开发测试会话保留。

```bash
"$OC" service stop
"$OFFICIAL" service status
sha256sum -c "$OC_ROOT/official-sha256.before"
"$OFFICIAL" --version
```

```powershell
& $Oc service stop
& $Official service status
$Before = Get-Content -LiteralPath (Join-Path $OcRoot 'official-sha256.before.json') -Raw | ConvertFrom-Json
$After = Get-FileHash -LiteralPath $Official -Algorithm SHA256
if ($Before.Hash -ne $After.Hash) { throw '官方文件已变化，检查是否被覆盖或官方自身发生了更新' }
& $Official --version
```

官方版若自行自动更新，校验和或 PID 也可能变化，需要区分原因；不要在本文流程中修改其自动更新策略。官方正在工作时，数据库本来就在变化，不能要求其文件哈希静止来证明隔离。

### 5.3 需要完全随 TUI 退出的开发服务

日常默认使用独立的开发托管服务。如果只是一次试验，可先停止开发托管服务，再使用 `"$OC" --standalone .` 或 `& $Oc --standalone .`。源码中的 [Standalone][S24] 会以 `serve --stdio --port 0` 启动独占子服务，随机端口，生命周期随客户端结束。

`--standalone` 只改变服务生命周期，**不会自动更换数据库或配置目录**，仍必须通过开发启动器运行。托管模式和独占模式之间切换时先退出/停止开发旧服务，避免两个开发服务同时操作同一份数据。官方服务不受此步骤影响。

## 6. 日常修改、升级、回退和移除

重新打开终端后，先恢复路径变量；不要重跑要求“ROOT 不存在”的首次初始化。自定义过 ROOT 或 Linux 目标时使用自己的值。

```bash
set -euo pipefail
OC_ROOT="$HOME/opencode-dev"
OC="$OC_ROOT/opencode-dev"
BUN="$OC_ROOT/tools/bun/bin/bun"
OC_SOURCE="$OC_ROOT/workspaces/opencode"
TARGET=opencode-linux-x64  # 按第 1.4 节改为本机目标
ARTIFACT="${TARGET/opencode-/cli-}"
cd "$OC_SOURCE"
```

```powershell
$ErrorActionPreference = 'Stop'
$OcRoot = Join-Path $env:LOCALAPPDATA 'OpenCodeDev'
$Oc = Join-Path $OcRoot 'opencode-dev.ps1'
$Bun = Join-Path $OcRoot 'tools/bun/bin/bun.exe'
$OcSource = Join-Path $OcRoot 'workspaces/opencode'
$Git = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
$Artifact = Join-Path $OcSource 'packages/cli/dist/cli-windows-x64'
Set-Location -LiteralPath $OcSource
```

### 6.1 快速运行源码

Linux 在 `$OC_SOURCE` 根目录运行：

```bash
"$OC" service stop
"$OC" --exec "$BUN" run dev --standalone "$OC_ROOT/workspaces/scratch"
```

Windows 在 `$OcSource` 根目录运行：

```powershell
& $Oc service stop
& $Oc --exec $Bun run dev --standalone (Join-Path $OcRoot 'workspaces/scratch')
```

`run dev` 后的 `--standalone` 和项目路径会传给 `dev` 脚本，再传到 CLI 的 `src/index.ts`；`--standalone` 是 OpenCode 参数。这里按 [Bun 的脚本参数语法](https://bun.sh/docs/runtime#run-a-package-json-script)直接传递。

先退出已开的开发 TUI。源码运行同样使用开发状态，官方服务保持运行。源码入口没有编译常量时版本显示为 `local`，与安装包的时间戳版本不同。持久安装仍需重新构建；不要用 `dev:live` 代替上面的命令。

启动器默认禁用项目配置/项目 AGENTS 自动发现。若开发 OpenCode 需要遵循仓库指令，应先阅读该 clone 的 `AGENTS.md`，需要注入时复制所需规则到开发全局配置的 `AGENTS.md`。若主动启用项目发现，先审查开发项目与所有祖先的配置、插件和外部路径，这属于更改本文的默认隔离条件。

### 6.2 跟进上游和重新安装

1. 保存/提交源码修改。在本文新 clone 中 `origin` 指向 `anomalyco/opencode`；执行 `git fetch origin dev`，在 `source-dev` 上合并或 rebase `origin/dev`，处理冲突。已添加 fork 的场景按自己的 remote 名称调整。
2. 重新核对根 `packageManager`、构建脚本、Global 路径、服务配置与数据库路径，必要时更新开发工具链和启动器。
3. 在源码根目录，通过启动器执行 `bun install --frozen-lockfile`、`bun run check` 和本机目标构建。相关测试在对应包目录运行；例如改动 `packages/core`，在该目录执行 `bun test`，不从仓库根运行测试。改动 public Protocol/Server `HttpApi` 时，按仓库要求在 `packages/client` 执行 `bun run generate`。
4. 构建成功后退出全部开发 TUI，执行**开发** `service stop`，再备份开发的 `data/config/state/home`。这时数据库已停止写入，备份才可用于可靠回退。
5. 重复第 3.4 或 4.4 节，把新产物复制到新版本目录并切换 `current.txt`；保留旧版本和备份。
6. 再次启动开发服务，核对 `api server.info` 的版本、PID 和路径，执行所改功能的实际验收。

启动器使用秒级时间戳；安装前确认新产物与上一安装的版本号不同，避免服务版本检测无法识别程序变化。遇到版本目录已存在时，先检查是否重复安装了同一产物。Bun 子命令在一个构建进程中继承相同版本号；运行启动器不会改写已编译版本。

停止开发服务后，可这样备份；先确认上一条 `service stop` 成功且开发 TUI 均已退出：

```bash
BACKUP="$OC_ROOT/backups/$(date -u +%Y%m%d%H%M%S)"
mkdir -p "$BACKUP"
cp -a "$OC_ROOT/data" "$OC_ROOT/config" "$OC_ROOT/state" "$OC_ROOT/home" "$BACKUP/"
cp "$OC_ROOT/current.txt" "$BACKUP/current.txt"
```

```powershell
$Backup = Join-Path $OcRoot ('backups/' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss'))
New-Item -ItemType Directory -Path $Backup | Out-Null
foreach ($part in @('data', 'config', 'state', 'home', 'current.txt')) {
    Copy-Item -LiteralPath (Join-Path $OcRoot $part) -Destination $Backup -Recurse
}
```

备份包含开发凭据，按凭据文件保管。它不包含官方数据，也无需备份临时目录和可重建的下载缓存。

### 6.3 回退

先关闭开发 TUI 并停止开发服务。**只切换旧二进制不保证能读取已被新版本迁移的数据库。** 要回退到已验证状态：

1. 保留当前开发 `data/config/state/home` 的另一个离线备份。
2. 将这些开发目录移到备份位置，再恢复所选备份中对应目录；不要把两份数据库目录直接合并。
3. 恢复该备份的 `current.txt`，确认对应 `releases/<版本>` 仍在。
4. 仅启动源码开发版进行验收。恢复的会话进度以备份时刻为准。

整个过程不操作官方目录。服务注册可能包含旧 PID，正常服务发现会探测实际进程；不要手工将官方 PID 或口令写入开发注册文件。

### 6.4 移除源码开发版

关闭开发 TUI，使用开发启动器执行 `service stop`，确认相关开发进程已退出，再移除自己添加的 `opencode-dev` alias/函数。保留需要的源码提交和备份后，删除**精确的开发 ROOT** 即可。

先显示并确认 ROOT 的绝对路径、内容及是否为软链接/junction，确保它不是官方安装、现有源码仓库或用户主目录。Windows 使用 `Remove-Item -LiteralPath <已核对的开发环境 ROOT 的绝对路径> -Recurse`，不要跨 shell 拼接删除命令。不调用官方卸载器、不结束所有同名进程、不删除官方用户目录。

## 7. 常见故障与验证范围

| 现象 | 检查与处理 |
| --- | --- |
| 提示要求 Bun `^1.4.2` | 通过启动器检查专用 Bun 版本与 PATH；仅更改外层 Bun 路径而内部 PATH 仍指向旧版不够 |
| 无法下载依赖或原生资产 | 启动器保留代理/证书变量；检查本机代理地址、GitHub/npm 可达性及平台依赖，不通过换回官方数据目录解决 |
| 官方账号在源码开发版中消失 | 这是预期隔离结果；源码开发版单独登录。父 shell 的 API Key 默认也不继承 |
| 私有 Git 仓库或外部 CLI 登录失效 | 开发 HOME 不含原来的 Git/SSH/云 CLI 配置；在开发环境单独配置，或有意识地增加必要白名单项，避免整份复用官方主目录 |
| 服务端口冲突 | 关闭开发 TUI，用开发 `service set port <新空闲端口>` 配置；该命令会停止开发服务，再重新启动验证 |
| 显示源码开发版的版本号但会话像官方版 | 检查 `debug paths`，再用 `api server.info` 核对实际服务；检查显式 `--server`、符号链接及开发配置里的外部路径 |
| 服务环境仍指向别处 | `service-local.json` 的 `env` 会覆盖继承环境；不要复制官方配置或向其中写入官方 XDG/HOME/DB。检查后重启开发服务 |
| Windows 输出 Access denied / 文件占用 | 退出开发 TUI并停止开发服务，复制到新 release 目录；保留官方进程，避免覆盖运行中的 `.exe` |
| 项目 AGENTS/MCP 没有加载 | 默认禁用了项目发现；把开发所需内容独立配置到开发全局目录，或按第 6.1 节审查后改变该开关 |
| Windows 持久终端不可用 | 当前服务报告 `persistentPty: false`，这是源码中的平台能力边界，不代表整个 Windows 构建不受支持 |
| `--standalone` 后仍看到旧开发会话 | 正常：该选项隔离服务进程，不创建新的开发数据库 |

此前文档验证包括：固定提交的源码追踪、所有 Bash/PowerShell 示例语法、启动器的版本目录选择、参数保真、退出码、异常后的环境恢复、升级命令拦截和固定源码链接的路径检查。Windows 探针运行于 PowerShell 7.6.5，以当时本机的 Bun 1.3.14 执行测试程序，直接导入实际 `global-roots.ts` 和 `database-path.ts` 验证路径；Bash 行为探针在 Git Bash 中运行。探针没有启动官方 OpenCode，也没有把 Bun 1.3.14 当作本文支持的构建工具链。

2026-10-12 审查复核还验证了：Windows 使用 `git diff --binary HEAD --output` 保存的补丁可以恢复 LF 文本、中文文本和二进制文件，恢复后的哈希一致；非 Git 目录会显示预期提示；实际 PowerShell 启动器在同一分钟内生成不同秒位的版本号。Linux 资产选择片段以 x64、aarch64/arm64 和 glibc/musl 组合执行检查，并对照 Bun 官方发布资产清单核实名称；此检查不等同于在 ARM64 主机上构建。

2026-10-13 复核使用 PowerShell 7.6.5、Bun 1.4.3 和 Git for Windows 2.45.1：确认 `--exec` 不依赖 `current.txt` 且不添加 release 的 PATH；版本读取支持含空格、单引号和中文的安装路径；根 `dev` 脚本正确传递参数；服务 PID 已退出时验收明确失败。调整后的 Git 补丁命令再次通过文本及二进制恢复验证，全部示例通过语法检查，Bash 启动器的 LF 属性已核对。以上均使用临时测试目录；本文构建步骤仍固定 Bun 1.4.2。

**没有据此宣称两台开发机完成了全量构建、真实 TUI 交互或模型调用验收。** Linux 与 Windows 的真实构建、端口、服务和双实例验收应分别执行第 3–5 节；构建脚本的产物检查也不能代替运行时验收。

## 8. 固定源码索引

以下链接固定在本文分析的上游提交，避免 `dev` 漂移后无法复核。源码在本机可直接阅读对应仓库相对路径。

- 入口与构建：[根包脚本][S1]、[开发指南][S2]、[版本推导][S3]、[Bun 构建][S16]、[Web UI 归档][S17]。
- 数据与配置：[路径根][S8]、[Global][S7]、[数据库选择][S9]、[凭据][S10]、[配置发现][S18]、[指令发现][S19]、[CLI 配置][S25]、[TUI 存储][S26]。
- 服务与升级：[服务配置][S11]、[连接选择][S13]、[默认 TUI][S14]、[服务进程][S15]、[独占服务][S24]、[自动更新][S5]、[手工升级][S6]。
- 平台差异：[持久 PTY][S12]、[Bun PTY 能力][S21]、[服务能力报告][S22]、[普通 PTY][S23]、[主题目录发现][S20]。

[S1]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/package.json
[S2]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/CONTRIBUTING.md
[S3]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/script/src/index.ts
[S4]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/src/version.ts
[S5]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/src/services/updater.ts
[S6]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/src/commands/handlers/upgrade.ts
[S7]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/util/src/global.ts
[S8]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/util/src/global-roots.ts
[S9]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/src/database-path.ts
[S10]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/core/src/credential.ts
[S11]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/src/services/service-config.ts
[S12]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/core/src/persistent-pty/index.ts
[S13]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/src/services/server-connection.ts
[S14]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/src/commands/handlers/default.ts
[S15]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/src/server-process.ts
[S16]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/script/build.ts
[S17]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/script/app-assets.ts
[S18]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/core/src/config/discovery.ts
[S19]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/core/src/config/plugin/instruction.ts
[S20]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/tui/src/util/config-directories.ts
[S21]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/core/src/persistent-pty/binary.bun.ts
[S22]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/server/src/handlers/server.ts
[S23]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/core/src/pty/pty.bun.ts
[S24]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/src/services/standalone.ts
[S25]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/cli/src/config/config.ts
[S26]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/tui/src/context/storage.tsx
[S27]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/script/publish.ts
[S28]: https://github.com/anomalyco/opencode/blob/e31136bdbdb43e934d8bbd81e75a2065a2625699/packages/desktop/scripts/finalize-latest-json.ts
