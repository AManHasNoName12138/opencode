# OpenCode V1 / V2 Linux 源码构建与并存指导手册

> 更新日期：2026-09-30。适用于 Linux 上的 V1、V2 预览版与官方 V2 源码构建及隔离运行。
>
> 场景：Linux 开发机已使用 `curl -fsSL https://opencode.ai/v2/install | bash` 安装 OpenCode，希望保留日常版本，同时阅读、构建、运行源码。
>
> 适用范围：步骤依据下列固定源码提交与官方文档编写，示例通过 Bash 语法检查；目标平台的编译与运行结果须按验收步骤确认。远程分支信息记录于 2026-09-29，后续使用以固定提交为基准。

## 1. 版本选择与并存原则

- **fork `AManHasNoName12138/opencode` 的本文 dev 快照包含 V1 入口、V2 预览实现及共享模块。** 预览 CLI 的产物名为 `lildax`，无参数启动 TUI，不支持项目目录位置参数。
- **构建官方 V2，使用上游 `anomalyco/opencode` 的 v2 分支或对应发布标签。** fork 的预览实现与官方 V2 是不同源码快照，入口参数和服务实现需分别核对。
- 编译默认生成仓库内的产物，不会自动覆盖官网安装的二进制；执行仓库安装器的 `--binary` 会写入相同安装路径。
- 运行时可能共享配置、数据、后台服务、临时目录与端口。实际数据库及服务是否相同，取决于 channel、环境变量与启动方式。
- 使用独立 worktree、四个 XDG 目录及 `TMPDIR`；官方 V2 首次测试再加 `--standalone`。预览版不支持该参数。

### 适用源码快照

| 对象 | 分支 / 标签 | 固定提交 | 说明 |
| --- | --- | --- | --- |
| AManHasNoName12138/opencode | `dev` | `3c893f0a166cfc433819b4eff65d2e6c7696a1c9` | V1 包版本 1.18.33，含 lildax 预览实现 |
| 上游 V2 固定快照 | `v2` | `ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b` | 根包版本 2.0.19；本文 V2 源码分析依据此快照 |
| 上游发布标签 | `v2.0.19` | `1fd016ef32286de9489b7b24f1029f52c49a27b3` | 提交时间 2026-09-29，消息为 release: v2.0.19 |

**分支头、发布标签、已安装二进制不是同一个概念。** 分支头可以包含发布标签之后的修改。package.json 版本也不保证本地构建输出相同版本；构建脚本根据 channel、时间和环境变量生成开发版本。[S21][S23]

## 2. 三套源码入口

| 项目 | fork 的 V1 | fork 的 V2 preview | 上游官方 V2 |
| --- | --- | --- | --- |
| 所在快照 | fork dev | 同一个 fork dev | upstream v2 |
| 主 CLI 包 | packages/opencode | packages/cli | packages/cli |
| 构建产物名 | opencode | lildax | opencode |
| 根目录 bun dev | 进入该入口 | 不进入该入口 | 进入该入口 |
| 不带子命令的默认动作 | 启动 V1 TUI | 启动预览 TUI | 启动 V2 TUI |
| 项目目录位置参数 | 支持 | 不支持 | 支持 |
| 其他入口 | V1 CLI 子命令 | api / debug / migrate / service / serve | V2 CLI 子命令 |
| Bun 声明 | 1.3.14 | 1.3.14 | 1.4.2 |

源码入口说明：

1. fork 的 `packages/opencode/src/config/v2-compat.ts` 以 OpenCode V1 身份处理配置兼容，拒绝原生 V2 的 permissions 结构。[S3]
2. fork 的 `packages/cli/src/commands/commands.ts` 自称 `OpenCode 2.0 preview command line interface`，根命令未声明项目目录位置参数；构建脚本设置 `binary = "lildax"`。CLI 入口将默认动作绑定到 `handlers/default.ts`，该处理器获取 daemon transport 后导入 TUI 并执行 `runTui(transport)`，因此无参数运行会启动 TUI。[S4][S5][S24][S25]
3. 上游 V2 的贡献指南要求以 `v2` 为基分支；根 dev 进入 `packages/cli/src/index.ts`；CLI 包为 `@opencode/cli`，bin 包含 opencode、opencode2。[S7][S8][S9]

两条线都是多包工程，core、server、schema、protocol、TUI 等模块可能被分阶段重构或复用。npm scope、Effect 版本、目录名称都是辅助线索，不能单独作为产品代际判据。例如官方 V2 仍依赖 `@opencode-ai/pty`。

2026-09-29 的远程分支记录中，fork 的公开分支为 dev、study-notes，没有 v2 分支。需要官方 V2 源码时，可添加 upstream 并创建独立 worktree，见第 5 节。

## 3. 构建前准备与隔离函数

以下使用 Bash，常规示例面向 glibc Linux x64 / ARM64；musl 见第 7 节。

### 3.1 记录官网安装版

```bash
type -a opencode
command -v opencode
readlink -f "$HOME/.opencode/bin/opencode"
"$HOME/.opencode/bin/opencode" --version
sha256sum "$HOME/.opencode/bin/opencode"
uname -m
ldd --version
```

曾通过 /v2/install 成功安装，不保证当前 shell 仍运行那个文件。PATH、alias、后续覆盖都可能改变入口。opencode2 是兼容入口，不能当成单独保留的一份 V2 二进制。

### 3.2 准备 Bun

推荐分别使用 fork 声明的 1.3.14、V2 声明的 1.4.2。Bun 官方支持传入版本标签：[D3]

```bash
# 按当前要构建的代码选择一个；这是 Bun 安装，不是 OpenCode 安装。
curl -fsSL https://bun.com/install | bash -s "bun-v1.3.14"
# 或：
curl -fsSL https://bun.com/install | bash -s "bun-v1.4.2"
export PATH="$HOME/.bun/bin:$PATH"
bun --version
git --version
```

Bun 安装器可能更新同一 Bun 路径和 shell 配置。需要长期保留两版时，使用现有版本管理器或独立工具目录；每次构建让正确的 bun 位于 PATH 首位。仅绝对路径调用外层 Bun、而 PATH 指向另一版本，可能使脚本内部调用错版。

Linux 的 Bun 安装需要 unzip。依赖安装和首次构建需要网络；原生依赖、模型元数据、Web UI 构建均可能成为失败点。

### 3.3 先定义隔离函数

完整粘贴到当前 Bash。函数只修改子 shell 环境，不修改日常终端的全局变量。

```bash
ocenv() (
  set -euo pipefail
  local profile="${1:-}"
  case "$profile" in
    v1|v2|v2-preview) shift ;;
    *) echo 'usage: ocenv v1|v2|v2-preview COMMAND [ARGS...]' >&2; exit 2 ;;
  esac
  [[ $# -gt 0 ]] || { echo 'missing command' >&2; exit 2; }
  local root="$HOME/.local/share/opencode-source/$profile"
  umask 077
  mkdir -p "$root"/{data,state,cache,config,tmp,project}

  # 清除可能指回日常环境或发布构建环境的覆盖值。
  unset OPENCODE_CONFIG OPENCODE_CONFIG_DIR OPENCODE_CONFIG_CONTENT
  unset OPENCODE_TUI_CONFIG OPENCODE_DB OPENCODE_DISABLE_CHANNEL_DB
  unset OPENCODE_BIN_PATH OPENCODE_TEST_HOME
  unset OPENCODE_PASSWORD OPENCODE_SERVER_PASSWORD OPENCODE_PTY_HANDOFF
  unset OPENCODE_CHANNEL OPENCODE_VERSION OPENCODE_BUMP OPENCODE_RELEASE

  export XDG_DATA_HOME="$root/data"
  export XDG_STATE_HOME="$root/state"
  export XDG_CACHE_HOME="$root/cache"
  export XDG_CONFIG_HOME="$root/config"
  export TMPDIR="$root/tmp"
  export OPENCODE_CONFIG_DIR="$root/config/opencode"
  export OPENCODE_DISABLE_AUTOUPDATE=1
  exec "$@"
)
```

应用通常追加 opencode 子目录，实际数据在 `$root/data/opencode`。[S11][S17] 不要把日常配置目录软链接到开发环境。

**边界：这不是操作系统沙箱。** 同一用户、工作目录、项目 `.opencode` / `opencode.json(c)`、Git 文件、上级目录指令与供应商环境变量仍可能共享。不要让两套实验会话同时修改同一工作区；配置迁移用项目副本或独立 worktree。即使从空项目启动，也应留意家目录中的公共指令。

## 4. 构建 fork 的 V1

### 4.1 获取固定快照与安装依赖

以下假定目标目录不存在。已有目录时保留未提交修改，另选目录或 worktree。

```bash
mkdir -p "$HOME/src"
git clone --branch dev https://github.com/AManHasNoName12138/opencode.git "$HOME/src/opencode"
cd "$HOME/src/opencode"
git switch -c local-v1 3c893f0a166cfc433819b4eff65d2e6c7696a1c9
# 使用 Bun 1.3.14。
bun --version
ocenv v1 bun install --frozen-lockfile
```

frozen-lockfile 用于避免安装时静默改锁文件；失败先检查 Bun 版本与错误，不要直接删除锁文件重新解析依赖。

### 4.2 构建并验证

```bash
cd "$HOME/src/opencode"
ocenv v1 env OPENCODE_CHANNEL=local bun run packages/opencode/script/build.ts --single
case "$(uname -m)" in
  x86_64) OC_ARCH=x64 ;;
  aarch64|arm64) OC_ARCH=arm64 ;;
  *) echo '请检查脚本支持的目标'; exit 1 ;;
esac
OC_V1_BIN="$HOME/src/opencode/packages/opencode/dist/opencode-linux-$OC_ARCH/bin/opencode"
ocenv v1 "$OC_V1_BIN" --version
ocenv v1 "$OC_V1_BIN" --help
```

local channel 的版本输出不一定是 1.18.33。脚本会生成代码、默认嵌入 Web UI、重建 dist，并对当前平台产物执行版本烟测。[S2]

### 4.3 运行

```bash
ocenv v1 "$OC_V1_BIN" "$HOME/.local/share/opencode-source/v1/project"
# 源码直跑：
cd "$HOME/src/opencode"
ocenv v1 bun dev "$HOME/.local/share/opencode-source/v1/project"
# 如需 HTTP 服务，选择未占用端口：
ocenv v1 bun dev serve --port 14096
```

无需把产物复制到 ~/.opencode/bin；不要为运行本地版执行 `./install --binary ...`。

## 5. 构建上游官方 V2

### 5.1 添加 upstream 与独立 worktree

```bash
cd "$HOME/src/opencode"
git remote -v
# 仅当 upstream 不存在时添加；已存在先核对地址。
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream v2
# 固定到本文核查的提交：
git worktree add -b local-v2 "$HOME/src/opencode-v2" ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b
cd "$HOME/src/opencode-v2"
git rev-parse HEAD
```

worktree 共享 Git 对象与远程配置，但工作文件、通常各自的依赖安装目录独立，适合两套依赖并存。

如果要复现已安装发布版，先读取其 version 再获取对应标签，不能只看分支头。例如，本文记录的发布标签为：

```bash
git fetch upstream tag v2.0.19
git rev-parse v2.0.19^{commit}
# 对应 1fd016ef32286de9489b7b24f1029f52c49a27b3
```

可另建基于该标签的 worktree。下文依据 ff72659 快照；切换到其他提交后重新核对 packageManager、贡献指南与构建脚本。复现源码版本也不等于完整复现官方二进制构建环境。

### 5.2 安装依赖与编译

切换到 Bun 1.4.2 后执行：

```bash
cd "$HOME/src/opencode-v2"
bun --version
ocenv v2 bun install --frozen-lockfile
ocenv v2 env OPENCODE_CHANNEL=local bun run packages/cli/script/build.ts --single
case "$(uname -m)" in
  x86_64) OC_ARCH=x64 ;;
  aarch64|arm64) OC_ARCH=arm64 ;;
  *) echo '请检查脚本支持的目标'; exit 1 ;;
esac
OC_V2_BIN="$HOME/src/opencode-v2/packages/cli/dist/cli-linux-$OC_ARCH/bin/opencode"
ocenv v2 "$OC_V2_BIN" --version
ocenv v2 "$OC_V2_BIN" --help
```

V2 默认构建 Web UI、安装额外原生依赖、编译并校验产物。文件名是 opencode，产物目录前缀是 cli-，不能照搬预览版 lildax。[S10]

### 5.3 首次测试使用 standalone

```bash
ocenv v2 "$OC_V2_BIN" --standalone "$HOME/.local/share/opencode-source/v2/project"
# 或源码直跑：
cd "$HOME/src/opencode-v2"
ocenv v2 bun dev --standalone "$HOME/.local/share/opencode-source/v2/project"
```

standalone 启动该客户端的私有服务，使用动态端口，生命周期随客户端连接租约结束。它绕开共享后台服务发现，但仍需 XDG / 配置隔离才能隔离持久数据。[S14][S20]

需要长期开发服务时可不加 standalone，始终用同一 profile 管理：

```bash
ocenv v2 "$OC_V2_BIN" service status
ocenv v2 "$OC_V2_BIN" service start
ocenv v2 "$OC_V2_BIN" service stop
# 若需要另选端口：
ocenv v2 "$OC_V2_BIN" service set port 14097
```

不要误用裸 `opencode service stop`，它可能操作日常版。不同 profile 的 managed service 也可能选中相同端口；显式分配端口或用 standalone。

`bun run dev:live` 会连接已安装服务与真实会话，是有意调试日常环境的入口，不是隔离运行步骤。[S7]

## 6. 冲突机制：哪些共享，哪些不一定共享

### 6.1 二进制与命令解析

| 动作 | 影响 |
| --- | --- |
| 仓库内安装依赖、编译到默认 dist | 不执行官网路径的全局安装 |
| 用绝对路径运行本地产物 | 二进制路径独立；运行数据仍需隔离 |
| ./install --binary | 覆盖 ~/.opencode/bin/opencode |
| 安装器 --no-modify-path | 仅抑制 shell 配置修改，仍写相同路径 |
| 把产物目录放 PATH 首位 | 改变命令优先级，不隔离数据库、配置和服务 |
| OPENCODE_BIN_PATH | 只有入口包装器读取时才生效 |

XDG_DATA_HOME 不控制 curl 的二进制安装路径。官方迁移指南明确说明两代默认不再并排安装，V2 curl 安装器替换 V1 二进制。[D1]

### 6.2 XDG 与数据库

默认 Linux 目录：[S11][S17]

| 用途 | 路径 |
| --- | --- |
| 配置 | ~/.config/opencode |
| 数据、日志等 | ~/.local/share/opencode |
| 状态、服务注册等 | ~/.local/state/opencode |
| 缓存 | ~/.cache/opencode |
| 临时文件 | os.tmpdir() 下的 opencode，通常位于 /tmp |

官方 V2 数据库路径规则：[S12]

| 条件 | 文件选择 |
| --- | --- |
| 设置 OPENCODE_DB | 优先使用指定文件 / 路径，还支持 :memory: |
| channel 为 latest/dev/beta/next/prod | opencode.db |
| OPENCODE_DISABLE_CHANNEL_DB 为 1 或 true | opencode.db |
| 其他 channel，如 local | opencode-local.db 等带 channel 后缀的文件 |

因此，源码直跑通常为 local，不应断言它必定与发布版使用同一 DB。fork 数据库也有 channel 分流，但共享名称的 channel 集合与当前 V2 不完全一样。[S18]

即使 DB 文件不同，其他配置、缓存、凭据或状态也不会因此完全隔离；数据库迁移亦不保证能被旧版反向读取。不要直接用日常 DB 验证实验构建。

### 6.3 当前官方 V2 的服务行为

| channel | 注册文件 | 默认 managed service 端口 |
| --- | --- | --- |
| latest/dev/beta/next | service.json | 49374 |
| local | service-local.json | 49375 |
| 其他 | service-<channel>.json | 按 channel 哈希计算 |

注册文件位于对应 Global.state 下。[S13] 普通 TUI default handler 传入 `mismatch: "replace"`，发现同一注册记录的服务版本不匹配时会替换。连接器还支持 ignore/error；显式 --server 在版本不同时告警后继续。注册文件被其他实例替换后，旧服务会发现所有权丢失并退出。[S14–S16]

**共享服务发现范围且触发相应策略时，版本切换可能导致服务替换。** fork 预览版使用自己的 daemon.ts 实现，应与此处官方 V2 的服务配置和连接策略分别理解。

### 6.4 配置兼容的方向

V2 可以读取并在内存中规范化部分 V1 配置，普通读取不等于把原文件全部改写。终端配置则由 tui.json(c) 演进为全局 cli.json，首次启动可能迁移支持的设置。[D1]

不能把“V2 能读部分 V1 配置”反推成“V1 能读原生 V2 配置”。权限结构、MCP、插件与服务 API 要分别核查。在隔离目录重新配置供应商、复制必要设置；不要为了找回会话直接指回日常 DB。

## 7. 构建开关、平台差异与预览实现

| 需求 | V1 | 官方 V2 |
| --- | --- | --- |
| 当前普通目标 | --single | --single |
| 加入 baseline | --single --baseline | --single --baseline |
| 跳过额外依赖安装 | --skip-install | --skip-install |
| 不嵌入 Web UI | --skip-embed-web-ui | --skip-web-ui |
| sourcemap | --sourcemaps | 本快照按 channel 决定，不能照搬 V1 开关 |
| 指定单个目标 | 未提供同样的通用 target 入口 | --target=opencode-linux-x64 等 |
| 自定义输出目录 | 脚本默认目录 | --outdir=<目录> |

注意：

- 两个脚本的 --single --baseline 都是把 baseline 加入筛选，不等于只生成 baseline；需要对应目标时运行带 baseline 的产物。它也不代表支持所有旧 CPU。
- --single 会排除 ABI 专用目标，不会自动为 Alpine 选择 musl。V2 可用 `--target=opencode-linux-x64-musl` 或 `--target=opencode-linux-x64-baseline-musl`；目标名以 opencode- 开头，产物目录仍以 cli- 开头。
- V1 此快照没有同样的 target 参数；musl 用户采用支持的多目标构建，或在独立开发分支明确修改目标筛选并复核。
- V2 --skip-web-ui 返回空 Web 资源归档，不是复用旧资源。
- V2 构建脚本会递归删除 outdir 再重建。只能指定专用、可重建的产物目录，不要指向家目录或资料目录。
- --skip-install 不补齐缺失依赖，也不保证离线构建。

### 可选：构建与运行 fork 中的 V2 preview

以下步骤用于研究预览 CLI 与 TUI；如需构建官方 V2，使用第 5 节的上游快照。先完成 fork 依赖安装，并在当前 Bash 定义 ocenv 函数。

```bash
cd "$HOME/src/opencode"
# 使用 fork 对应 Bun 1.3.14 与依赖。
ocenv v2-preview env OPENCODE_CHANNEL=local bun run packages/cli/script/build.ts --single
# 根据主机架构选择 glibc 常规产物。
case "$(uname -m)" in
  x86_64) OC_ARCH=x64 ;;
  aarch64|arm64) OC_ARCH=arm64 ;;
  *) echo '请检查脚本支持的目标'; exit 1 ;;
esac
OC_PREVIEW_BIN="$HOME/src/opencode/packages/cli/dist/cli-linux-$OC_ARCH/bin/lildax"
ocenv v2-preview "$OC_PREVIEW_BIN" --help
# 不带子命令和项目目录参数，启动预览 TUI。
ocenv v2-preview "$OC_PREVIEW_BIN"
```

预览 CLI 的两类入口如下：[S4][S24][S25]

| 调用方式 | 行为 |
| --- | --- |
| `lildax` | 执行默认处理器，经 daemon transport 启动 TUI |
| `lildax api/debug/migrate/service/serve ...` | 执行对应子命令 |
| `lildax <directory>` | 根命令未定义此位置参数，不应使用 |

预览版具有 TUI，但项目选择不能照搬官方 V2 的目录位置参数；需依据该预览快照的 TUI 功能操作。预览版也未提供本文官方 V2 的 dev:live / standalone 入口。退出 TUI 后，如需停止预览后台服务，仍通过同一隔离 profile 操作：

```bash
ocenv v2-preview "$OC_PREVIEW_BIN" service status
ocenv v2-preview "$OC_PREVIEW_BIN" service stop
```

仅退出 TUI 不应视为已经停止后台服务。

## 8. 验收、排障与退出

1. 保存 git rev-parse HEAD、bun --version、构建命令与完整错误日志。
2. 隔离运行产物 version/help，再测试空项目。
3. 对比官网安装路径的版本与 SHA256；日常自动更新也可能改变文件，不能仅凭差异认定被源码构建覆盖。
4. 检查开发数据位于各自 opencode-source/<profile> 目录。
5. managed service 始终用同一 profile 启停；standalone 正常退出客户端即可。

| 症状 | 优先检查 |
| --- | --- |
| opencode 版本没变 | 本地产物未进入 PATH；用绝对路径运行 |
| 输出 local / 0.0.0-local-... | 开发版本正常，不能按首位数字判断代际 |
| 配置、凭据、会话不见了 | 隔离目录本来就是新环境；在开发环境重新配置 |
| permissions 不支持 | V1 读取了原生 V2 配置，检查全局覆盖及项目配置 |
| 服务端口已占用 | 目录隔离不等于端口隔离，使用 standalone 或不同端口 |
| 原生产物无法启动 | 架构、glibc/musl、CPU 目标、构建日志 |
| 依赖 / 类型错误 | commit、Bun、锁文件与完整 workspace 安装 |
| 日常会话连到开发服务 | 路径、channel、注册文件、dev:live、--server |

源码修改后的测试和类型检查优先在受影响包内执行；不要在仓库根目录运行 test。V2 改公开 Protocol/HttpApi 后，在 packages/client 执行 bun run generate，不要手改生成文件。[S8]

只在独立目录构建运行时，退出开发客户端、停止自己的开发服务，再使用官网安装路径即可，无需重装。若已经让不同版本打开同一数据库，换回二进制并不保证回退成功。备份活跃 SQLite 应采用一致性备份方法，或正常停止对应服务后完整备份相关数据，避免只复制 DB 而遗漏 WAL。

## 9. 证据索引

源码链接固定提交；官网文档和安装器会更新。更换源码提交后，重新核对构建脚本、CLI 参数与运行时路径。

- [S1 fork 根 package.json](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/package.json)
- [S2 V1 构建脚本](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/opencode/script/build.ts)
- [S3 V1 配置兼容检查](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/opencode/src/config/v2-compat.ts)
- [S4 V2 preview 命令定义](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/cli/src/commands/commands.ts)
- [S5 lildax 构建脚本](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/cli/script/build.ts)
- [S6 fork 安装器](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/install)
- [S7 V2 根脚本和 Bun 声明](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/package.json)
- [S8 V2 CONTRIBUTING](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/CONTRIBUTING.md)
- [S9 V2 CLI 包](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/package.json)
- [S10 V2 构建脚本](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/script/build.ts)
- [S11 V2 XDG 与临时目录](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/util/src/global-roots.ts)
- [S12 V2 数据库路径](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/src/database-path.ts)
- [S13 V2 服务名称与端口](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/src/services/service-config.ts)
- [S14 V2 连接策略](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/src/services/server-connection.ts)
- [S15 V2 TUI replace 策略](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/src/commands/handlers/default.ts)
- [S16 V2 注册所有权](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/src/services/service-registration.ts)
- [S17 fork Global](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/core/src/global.ts)
- [S18 fork 数据库路径](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/core/src/database/database.ts)
- [S19 Node 包装器 OPENCODE_BIN_PATH](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/opencode/bin/opencode)
- [S20 V2 standalone](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/src/services/standalone.ts)
- [S21 V2 构建 channel 与 version](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/script/src/index.ts)
- [S22 V2 自动更新策略](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/src/services/updater.ts)
- [S23 v2.0.19 发布提交](https://github.com/anomalyco/opencode/commit/1fd016ef32286de9489b7b24f1029f52c49a27b3)
- [S24 预览 CLI 默认 TUI 处理器](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/cli/src/commands/handlers/default.ts)
- [S25 预览 CLI 默认处理器注册](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/cli/src/index.ts)
- [D1 V1 到 V2 迁移](https://opencode.ai/v2/docs/migrate-v1/)
- [D2 V2 故障排查](https://opencode.ai/v2/docs/troubleshooting/)
- [D3 Bun 安装与指定版本](https://bun.sh/docs/installation)

- [V2 安装器](https://opencode.ai/v2/install)
- [V1 文档](https://opencode.ai/docs/)
- [V2 文档](https://opencode.ai/v2/docs/)