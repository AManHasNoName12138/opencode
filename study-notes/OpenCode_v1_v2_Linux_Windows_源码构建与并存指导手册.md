# OpenCode V1 / V2 Linux / Windows 源码构建与并存指导手册

> 更新日期：2026-10-04。适用于 Linux、Windows 原生 PowerShell 与 WSL2 上的 V1、V2 预览版及官方 V2 源码构建与隔离运行。
>
> 场景：Linux 开发机已使用 `curl -fsSL https://opencode.ai/v2/install | bash` 安装 OpenCode，或 Windows 已有日常使用的 OpenCode，希望保留日常版本，同时阅读、构建、运行源码。
>
> 适用范围：步骤依据下列固定源码提交与官方文档编写；Linux 示例沿用已做 Bash 语法检查的手册，Windows 验证范围见第 9.10 节。未据此宣称三套产品完成 Windows 全量构建或交互验收。远程分支信息记录于 2026-09-29，后续使用以固定提交为基准。

阅读路线：Linux 使用第 3–8 节；Windows 原生从第 9.1 节开始；WSL2 使用第 9.9 节衔接 Linux 步骤。第 1–2 节的版本区分与第 6 节的隔离原则适用于三条路线。

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
  mkdir -p "$root"/{data,state,cache,config,tmp,runtime,project}

  # 清除可能指回日常环境或发布构建环境的覆盖值。
  unset OPENCODE_CONFIG OPENCODE_CONFIG_DIR OPENCODE_CONFIG_CONTENT
  unset OPENCODE_TUI_CONFIG OPENCODE_DB OPENCODE_DISABLE_CHANNEL_DB
  unset OPENCODE_CLI_CONFIG_CONTENT OPENCODE_TUI_CHANNEL
  unset OPENCODE_BIN_PATH OPENCODE_TEST_HOME
  unset OPENCODE_PASSWORD OPENCODE_SERVER_PASSWORD OPENCODE_PTY_HANDOFF
  unset OPENCODE_PTY_BIN OPENCODE_PTY_RUNTIME_DIR OPENCODE_NODE_PTY_PATH
  unset OPENCODE_CHANNEL OPENCODE_VERSION OPENCODE_BUMP OPENCODE_RELEASE
  unset BUN_COMPILE_RELEASE

  export XDG_DATA_HOME="$root/data"
  export XDG_STATE_HOME="$root/state"
  export XDG_CACHE_HOME="$root/cache"
  export XDG_CONFIG_HOME="$root/config"
  export XDG_RUNTIME_DIR="$root/runtime"
  export TMPDIR="$root/tmp"
  export OPENCODE_CONFIG_DIR="$root/config/opencode"
  export OPENCODE_DISABLE_AUTOUPDATE=1
  exec "$@"
)
```

应用通常追加 opencode 子目录，实际数据在 `$root/data/opencode`。[S11][S17] 不要把日常配置目录软链接到开发环境。

官方 V2 的持久 PTY 另读 `OPENCODE_PTY_RUNTIME_DIR` / `XDG_RUNTIME_DIR`，其可执行文件也可被 `OPENCODE_PTY_BIN` 覆盖；因此本次补全这些变量的隔离，清除会改变构建运行时的 `BUN_COMPILE_RELEASE`。详见第 9.7 节。[S27][S28]

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

V2 默认构建 Web UI、安装额外原生依赖、编译并校验产物。这里的校验检查构建图和产物中的禁用资源，并不执行产物的 `--version`；仍须手动烟测。文件名是 opencode，产物目录前缀是 cli-，不能照搬预览版 lildax。[S10][S26]

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

## 9. Windows 源码构建、运行与并存

本节继续固定到第 1 节的 `3c893f0`（fork V1 / preview）与 `ff72659`（官方 V2），不以当前工作区 HEAD 或最新分支替代证据。研究的是 CLI / TUI，桌面应用的 Electron 构建不在本节范围内。

### 9.1 先选择 Windows 原生或 WSL2

| 路线 | 实际运行时 | 操作方式 | 适用目的 |
| --- | --- | --- | --- |
| Windows 原生 | Windows `bun.exe` / `opencode.exe` | 本节 PowerShell 步骤 | 研究 Windows 路径、Shell、ConPTY、进程与 EXE 行为 |
| WSL2 | Linux Bun / ELF 产物 | 第 9.9 节加第 3–8 节 Bash 步骤 | 研究 Linux 行为、使用 Linux 工具链 |
| Git Bash | 通常仍是 Windows `bun.exe` | 先核对实际运行时 | 提供 Bash 命令环境；不等同于 WSL 或 Linux |

Windows 原生准备 Git for Windows、Windows Terminal、**PowerShell 7.3 或更新版本（`pwsh`）**，以及两个快照对应的 Bun。Windows 自带的 `powershell.exe` 5.1 不满足下文隔离函数的要求：旧式原生参数传递可能破坏带空格、末尾反斜杠或嵌套引号的参数。Windows Terminal 是终端宿主，不代表其中的 Shell 已升级；先检查 `$PSVersionTable.PSVersion`。Bun 官方当前最低要求为 Windows 10 1809，具体 OpenTUI / PTY / 原生依赖仍需各自验收。[D3][D10]

不要因为默认使用 pnpm 就替换本仓库的包管理器：这两个快照明确声明 Bun，并使用 Bun workspace、catalog、锁文件和运行时 API。构建脚本实际接受 `^1.3.14` / `^1.4.2`，但复现本文优先使用声明的精确版本；满足 semver 范围不等于所有原生依赖均已验证。[S1][S7][S21][S29]

### 9.2 记录日常入口，准备两版 Bun

先在日常 PowerShell 中执行：

```powershell
Get-Command opencode -All -ErrorAction SilentlyContinue |
    Select-Object CommandType, Name, Source, Definition
where.exe opencode
Get-Command bun, git, pwsh -All -ErrorAction SilentlyContinue |
    Select-Object CommandType, Name, Source
$PSVersionTable.PSVersion
```

`where.exe` 查询 PATH 中的文件；`Get-Command` 还能揭示同名 alias / function。Windows 上可能通过 npm、Scoop、Chocolatey、安装器或手动解压安装，不应把 Linux 的 `~/.opencode/bin/opencode` 当成唯一入口。先用解析出的真实命令记录 `--version`；若是 `.cmd` / `.ps1` 包装器，再定位它调用的 EXE。对该 EXE 执行 `Get-FileHash -Algorithm SHA256 -LiteralPath '实际绝对路径'`，保存路径和哈希。

两版 Bun 可从 [1.3.14 发布页](https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14) 与 [1.4.2 发布页](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2) 获取对应 Windows ZIP，各自解压到独立目录。按实际解压位置修改以下变量；保持文件名为 `bun.exe`，不要改名成 `bun-v1.exe`，CLI 的自启动判断会识别运行时名称。[D3][S30][S31]

```powershell
$OcBunV1 = 'C:\Tools\bun-1.3.14\bun-windows-x64\bun.exe'
$OcBunV2 = 'C:\Tools\bun-1.4.2\bun-windows-x64\bun.exe'
foreach ($OcBun in @($OcBunV1, $OcBunV2)) {
    if (-not (Test-Path -LiteralPath $OcBun -PathType Leaf)) {
        throw "请先修改 Bun 路径或解压相应版本：$OcBun"
    }
    & $OcBun --version
    if ($LASTEXITCODE -ne 0) { throw "Bun 无法启动：$OcBun" }
    & $OcBun -p 'process.platform + String.fromCharCode(32) + process.arch'
    if ($LASTEXITCODE -ne 0) { throw '无法读取 Bun 平台' }
}
```

x64 示例应输出 `win32 x64`。Windows ARM64 主机若运行 x64 Bun，`--single` 仍按 `process.arch === "x64"` 选择 x64 目标；原生 ARM64 构建须选对应版本实际提供的 ARM64 Bun 和原生依赖。目标表列有 arm64，只说明脚本声明支持该目标，不代表本机 ARM64 已通过构建。不要用 `$env:PROCESSOR_ARCHITECTURE` 代替 Bun 的实际架构。[S2][S5][S10]

官方安装脚本也支持 `-Version`，但重复安装可能更新同一个 Bun 路径；独立解压更便于并存。下面的包装函数在调用 Bun 时临时将该 Bun 目录放在 PATH 首位，使构建脚本内部的 `bun install` / `bun run build` 使用同一版本。

### 9.3 PowerShell 隔离函数

先完整粘贴下列函数。`Invoke-Oc` 仅接受真实 `.exe` 的路径，参数用数组传递；不要把整条命令拼成字符串。`-Build` 只用于构建，将 channel 固定为 `local`，同时清除可能触发发布的环境变量。

```powershell
function Invoke-Oc {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('v1', 'v2', 'v2-preview')]
        [string] $ProfileName,
        [Parameter(Mandatory = $true)]
        [string] $FilePath,
        [string[]] $ArgumentList = @(),
        [switch] $Build
    )

    $ErrorActionPreference = 'Stop'
    if ($PSVersionTable.PSVersion -lt [version]'7.3') {
        throw '请用 PowerShell 7.3 或更新版本的 pwsh 运行此函数'
    }
    $PSNativeCommandArgumentPassing = 'Standard'
    $executable = (Resolve-Path -LiteralPath $FilePath).ProviderPath
    if ([IO.Path]::GetExtension($executable) -ine '.exe') {
        throw 'FilePath 必须指向 bun.exe、opencode.exe 或 lildax.exe 等真实 EXE'
    }
    $root = Join-Path $env:USERPROFILE ".local\share\opencode-source\$ProfileName"
    foreach ($directory in @('data', 'state', 'cache', 'config', 'tmp', 'runtime', 'project')) {
        [IO.Directory]::CreateDirectory((Join-Path $root $directory)) | Out-Null
    }

    $clear = @(
        'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT',
        'OPENCODE_TUI_CONFIG', 'OPENCODE_CLI_CONFIG_CONTENT', 'OPENCODE_TUI_CHANNEL',
        'OPENCODE_DB', 'OPENCODE_DISABLE_CHANNEL_DB',
        'OPENCODE_BIN_PATH', 'OPENCODE_TEST_HOME',
        'OPENCODE_PASSWORD', 'OPENCODE_SERVER_PASSWORD',
        'OPENCODE_PTY_HANDOFF', 'OPENCODE_PTY_BIN', 'OPENCODE_PTY_RUNTIME_DIR',
        'OPENCODE_NODE_PTY_PATH', 'OPENCODE_CHANNEL', 'OPENCODE_VERSION',
        'OPENCODE_BUMP', 'OPENCODE_RELEASE', 'BUN_COMPILE_RELEASE'
    )
    $set = @{
        XDG_DATA_HOME = Join-Path $root 'data'
        XDG_STATE_HOME = Join-Path $root 'state'
        XDG_CACHE_HOME = Join-Path $root 'cache'
        XDG_CONFIG_HOME = Join-Path $root 'config'
        XDG_RUNTIME_DIR = Join-Path $root 'runtime'
        TEMP = Join-Path $root 'tmp'
        TMP = Join-Path $root 'tmp'
        TMPDIR = Join-Path $root 'tmp'
        OPENCODE_CONFIG_DIR = Join-Path $root 'config\opencode'
        OPENCODE_DISABLE_AUTOUPDATE = '1'
    }
    if ($Build) { $set['OPENCODE_CHANNEL'] = 'local' }
    if ([IO.Path]::GetFileName($executable) -ieq 'bun.exe') {
        $set['PATH'] = (Split-Path -Parent $executable) + ';' + $env:PATH
    }

    $saved = @{}
    $names = @($clear) + @($set.Keys) | Select-Object -Unique
    foreach ($name in $names) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    try {
        foreach ($name in $names) {
            # 清除可能同时继承的 Path / PATH 等大小写重复项。
            while (Test-Path -LiteralPath "Env:$name") {
                Remove-Item -LiteralPath "Env:$name"
            }
        }
        foreach ($name in $set.Keys) {
            [Environment]::SetEnvironmentVariable($name, [string]$set[$name], 'Process')
        }
        & $executable @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "命令失败，退出码 $LASTEXITCODE ：$executable"
        }
    }
    finally {
        foreach ($name in $names) {
            while (Test-Path -LiteralPath "Env:$name") {
                Remove-Item -LiteralPath "Env:$name"
            }
            if ($null -ne $saved[$name]) {
                [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
            }
        }
    }
}
```

**为什么不能直接照搬 Bash 函数：** PowerShell 的普通函数或 `& { ... }` 作用域并不隔离进程环境变量。这里临时设置当前进程环境，让子进程继承，再用 `finally` 在正常完成或错误退出时恢复；不会写用户级或系统级环境变量。同一个 PowerShell 进程内不要并行调用此函数，比较两版时分别开终端。已派生的后台服务保留启动时的环境，不会随父进程恢复而改变。

清除覆盖值使用 `Remove-Item Env:...`，而非将值设为空串；例如 DB 路径的 `??` 判断不会把空串视为“未设置”。函数还清理继承环境中可能重复的 `Path` / `PATH`，再设置一个一致的值；恢复时按 Windows 不区分大小写的变量语义恢复保存值，不保留重复项。函数局部选择标准原生参数传递，避免外层 Shell 设置为 Legacy 时重新引入引号问题。[S12][D10]

源码将四个 XDG 根目录分别追加 `opencode`，Windows 默认仍是用户家目录下的 `.local\share`、`.local\state`、`.cache`、`.config`，并非统一转去 `%APPDATA%`；fork 的 `xdg-basedir@5.1.0` 与官方 V2 自有 `roots()` 都如此。[S11][S17][D7]

`os.tmpdir()` 在 Windows 读 `TEMP` / `TMP`，只设 Linux 的 `TMPDIR` 不足以隔离。这里同时设置三者，并隔离 `XDG_RUNTIME_DIR`，覆盖持久 PTY 的另一条目录选择链。[D4][S27] NTFS 权限不等同于 Linux `umask 077`；此函数只负责目录与环境分流，不提供权限沙箱，也不隔离项目配置、Git 凭据、供应商环境变量和用户家目录指令。

可先检查函数的实际子进程环境，尚不启动 OpenCode：

```powershell
Invoke-Oc -ProfileName v1 -FilePath $OcBunV1 -ArgumentList @(
    '-p', 'JSON.stringify({data:process.env.XDG_DATA_HOME,tmp:require(''os'').tmpdir(),runtime:process.env.XDG_RUNTIME_DIR,exe:process.execPath})'
)
```

输出中的 data、tmp、runtime 应位于当前用户的 `opencode-source\v1` 下，exe 应为选择的 Bun。带空格的路径通过变量和参数数组传递，不需要手工加嵌套引号。

### 9.4 Windows 原生：构建 fork V1

使用新的目录，避免改变现有开发仓库分支。路径可替换成较短的本地磁盘路径；不要共用 WSL 的 `node_modules`。

```powershell
$OcSourceRoot = Join-Path $env:USERPROFILE 'src'
$OcFork = Join-Path $OcSourceRoot 'opencode-source-fork'
$OcUpstream = Join-Path $OcSourceRoot 'opencode-source-v2'
[IO.Directory]::CreateDirectory($OcSourceRoot) | Out-Null
if (Test-Path -LiteralPath $OcFork) { throw '目标目录已存在，请另选目录或使用已有独立 worktree' }
git clone --branch dev https://github.com/AManHasNoName12138/opencode.git $OcFork
if ($LASTEXITCODE -ne 0) { throw 'clone 失败' }
Set-Location -LiteralPath $OcFork
git switch -c local-v1 3c893f0a166cfc433819b4eff65d2e6c7696a1c9
if ($LASTEXITCODE -ne 0) { throw '固定源码提交失败' }
git rev-parse HEAD

Invoke-Oc -ProfileName v1 -FilePath $OcBunV1 -ArgumentList @('install', '--frozen-lockfile')
Invoke-Oc -ProfileName v1 -FilePath $OcBunV1 -Build -ArgumentList @(
    'run', 'packages/opencode/script/build.ts', '--single'
)
$OcV1Arch = (& $OcBunV1 -p 'process.arch').Trim()
if ($LASTEXITCODE -ne 0 -or $OcV1Arch -notin @('x64', 'arm64')) { throw '不支持的 Bun 架构' }
$OcV1Bin = Join-Path $OcFork "packages\opencode\dist\opencode-windows-$OcV1Arch\bin\opencode.exe"
if (-not (Test-Path -LiteralPath $OcV1Bin)) { throw "未生成预期产物：$OcV1Bin" }
Invoke-Oc -ProfileName v1 -FilePath $OcV1Bin -ArgumentList @('--version')
Invoke-Oc -ProfileName v1 -FilePath $OcV1Bin -ArgumentList @('--help')
```

构建默认嵌入 Web UI；只研究 CLI / TUI 时可在构建参数数组末尾加入 `--skip-embed-web-ui`，并记录这是不含嵌入 Web UI 的构建。V1 脚本里的 `$` 模板由 Bun Shell 执行，内置 `rm`、`mkdir` 等跨平台操作；看见 `rm -rf` 不能据此断言必须在 Git Bash 中构建，也不要把这些源码片段直接粘到 PowerShell。[S2][D5]

在空项目运行编译产物，或二选一源码直跑：

```powershell
$OcV1Project = Join-Path $env:USERPROFILE '.local\share\opencode-source\v1\project'
Invoke-Oc -ProfileName v1 -FilePath $OcV1Bin -ArgumentList @($OcV1Project)
# 退出上面的 TUI 后，如需源码直跑：
Set-Location -LiteralPath $OcFork
Invoke-Oc -ProfileName v1 -FilePath $OcBunV1 -ArgumentList @('dev', $OcV1Project)
# 如需单独的前台 HTTP 服务；Ctrl+C 退出：
Invoke-Oc -ProfileName v1 -FilePath $OcBunV1 -ArgumentList @('dev', 'serve', '--port', '14096')
```

构建脚本的 V1 烟测使用不带 `.exe` 的路径调用；若构建报告启动失败但 EXE 已存在，保留该失败记录，并用上面显式 `.exe` 路径核验，不能把存在文件当作构建成功。Bun 对 Windows 编译产物自动追加 `.exe`。[S2][D6]

### 9.5 Windows 原生：构建上游官方 V2

接上节创建的仓库；先核对 remote，已有 upstream 时不要覆盖地址。以下条件分支只在缺少 upstream 时添加。

```powershell
Set-Location -LiteralPath $OcFork
$OcRemotes = @(git remote)
if ($LASTEXITCODE -ne 0) { throw '无法读取 Git remote' }
if ($OcRemotes -contains 'upstream') {
    $OcRemoteUrl = git remote get-url upstream
    if ($LASTEXITCODE -ne 0 -or $OcRemoteUrl -ne 'https://github.com/anomalyco/opencode.git') {
        throw '已有 upstream，请先核对其是否指向 anomalyco/opencode'
    }
}
if ($OcRemotes -notcontains 'upstream') {
    git remote add upstream https://github.com/anomalyco/opencode.git
    if ($LASTEXITCODE -ne 0) { throw '添加 upstream 失败' }
}
git fetch upstream v2
if ($LASTEXITCODE -ne 0) { throw '获取 upstream v2 失败' }
git cat-file -e 'ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b^{commit}'
if ($LASTEXITCODE -ne 0) { throw '固定提交不在本地，请获取该提交，勿静默改用分支头' }
if (Test-Path -LiteralPath $OcUpstream) { throw 'V2 目标目录已存在，请另选目录' }
git worktree add -b local-v2 $OcUpstream ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b
if ($LASTEXITCODE -ne 0) { throw '创建 V2 worktree 失败' }
Set-Location -LiteralPath $OcUpstream
git rev-parse HEAD

Invoke-Oc -ProfileName v2 -FilePath $OcBunV2 -ArgumentList @('install', '--frozen-lockfile')
Invoke-Oc -ProfileName v2 -FilePath $OcBunV2 -Build -ArgumentList @(
    'run', 'packages/cli/script/build.ts', '--single'
)
$OcV2Arch = (& $OcBunV2 -p 'process.arch').Trim()
if ($LASTEXITCODE -ne 0 -or $OcV2Arch -notin @('x64', 'arm64')) { throw '不支持的 Bun 架构' }
$OcV2Bin = Join-Path $OcUpstream "packages\cli\dist\cli-windows-$OcV2Arch\bin\opencode.exe"
if (-not (Test-Path -LiteralPath $OcV2Bin)) { throw "未生成预期产物：$OcV2Bin" }
Invoke-Oc -ProfileName v2 -FilePath $OcV2Bin -ArgumentList @('--version')
Invoke-Oc -ProfileName v2 -FilePath $OcV2Bin -ArgumentList @('--help')
$OcV2Project = Join-Path $env:USERPROFILE '.local\share\opencode-source\v2\project'
Invoke-Oc -ProfileName v2 -FilePath $OcV2Bin -ArgumentList @('--standalone', $OcV2Project)
```

若要按发布标签构建，在 `git rev-parse 'v2.0.19^{commit}'` 这类表达式外使用单引号；对应关系见第 5.1 节。若分支历史变化或浅克隆使固定提交不可达，应显式获取固定 SHA 或含它的引用，再重试；不要把另一个快照当成本文验收对象。

源码直跑和后台服务是两种选择，退出前一个测试后再执行下一个：

```powershell
Set-Location -LiteralPath $OcUpstream
Invoke-Oc -ProfileName v2 -FilePath $OcBunV2 -ArgumentList @('dev', '--standalone', $OcV2Project)
# 如需 managed service，先分配端口再启动；这些命令均使用 v2 profile：
Invoke-Oc -ProfileName v2 -FilePath $OcV2Bin -ArgumentList @('service', 'set', 'port', '14097')
Invoke-Oc -ProfileName v2 -FilePath $OcV2Bin -ArgumentList @('service', 'start')
Invoke-Oc -ProfileName v2 -FilePath $OcV2Bin -ArgumentList @('service', 'status')
Invoke-Oc -ProfileName v2 -FilePath $OcV2Bin -ArgumentList @($OcV2Project)
# 退出 TUI 后停止自己的开发服务：
Invoke-Oc -ProfileName v2 -FilePath $OcV2Bin -ArgumentList @('service', 'stop')
```

`--standalone` 派生 `serve --stdio --port 0`，通过管道报告地址，stdin 关闭结束服务租约；managed service 通过独立注册文件发现，并以 detached 子进程存活。这里的 `service` 不是 Windows SCM 注册服务，不能按服务名称去 `services.msc` 启停。[S20][S30][S32][S33] `dev:live` 还包含 `sh -c` 且刻意连接已安装服务，不属于上述隔离流程。[S7]

### 9.6 Windows 原生：可选的 fork V2 preview

回到 fork，仍使用 Bun 1.3.14 与该 worktree 已安装的依赖。`packages/cli` 相同的目录名称并不意味着与上游 V2 是同一个 CLI。

```powershell
Set-Location -LiteralPath $OcFork
Invoke-Oc -ProfileName v2-preview -FilePath $OcBunV1 -Build -ArgumentList @(
    'run', 'packages/cli/script/build.ts', '--single'
)
$OcPreviewBin = Join-Path $OcFork "packages\cli\dist\cli-windows-$OcV1Arch\bin\lildax.exe"
if (-not (Test-Path -LiteralPath $OcPreviewBin)) { throw "未生成预期产物：$OcPreviewBin" }
Invoke-Oc -ProfileName v2-preview -FilePath $OcPreviewBin -ArgumentList @('--help')
# 从隔离空项目启动；根命令不接受目录位置参数，也不支持 --standalone：
Push-Location -LiteralPath (Join-Path $env:USERPROFILE '.local\share\opencode-source\v2-preview\project')
try {
    Invoke-Oc -ProfileName v2-preview -FilePath $OcPreviewBin
}
finally {
    Pop-Location
}
Invoke-Oc -ProfileName v2-preview -FilePath $OcPreviewBin -ArgumentList @('service', 'status')
Invoke-Oc -ProfileName v2-preview -FilePath $OcPreviewBin -ArgumentList @('service', 'stop')
```

改变启动 cwd 只避免从源码仓库启动，并不等于通过参数选定了 TUI 项目；项目选择依该快照的 TUI 操作。preview 的 daemon 使用 `state\opencode\server.json` 和独立 `password` 文件，自启动 `serve --register`；默认从 4096 起尝试端口，不使用官方 V2 的 `service-local.json` / 49375 规则。[S31][S34] 官方 V2 的 `service set port` 也不能照搬到 preview。

### 9.7 源码深读：Windows 差异为何影响这些步骤

#### 9.7.1 构建目标、依赖与校验是三层检查

| 层次 | 源码行为 | 对操作的影响 |
| --- | --- | --- |
| 目标选择 | 三套脚本的 `--single` 比较 `process.platform` / `process.arch`；`win32` 转成目录中的 `windows` | Windows x64 输出 `*-windows-x64`，没有 glibc / musl 后缀 |
| 原生模块 | V1 额外安装 OpenTUI、watcher、fff；preview 额外安装 OpenTUI；V2 额外安装 OpenTUI 和 PTY 包，并按目标绑定 watcher | 普通 `bun install` 成功不代表跨架构原生资源齐全；`--skip-install` 不能修复缺失资源 |
| 运行校验 | V1 对本平台目标执行 `--version`；preview 检查 `Bun.build().success`；V2 还扫描构建图与禁用资源 | V2 的 `verifyArtifact` 并非启动测试，必须另外验证 EXE、TUI、Shell、PTY |

以上分别对应 [S2][S5][S10][S26]。产物路径如下（`<arch>` 是 `x64` 或 `arm64`）：

| 版本 | Windows 产物 |
| --- | --- |
| fork V1 | `packages\opencode\dist\opencode-windows-<arch>\bin\opencode.exe` |
| fork preview | `packages\cli\dist\cli-windows-<arch>\bin\lildax.exe` |
| 官方 V2 | `packages\cli\dist\cli-windows-<arch>\bin\opencode.exe` |

V2 可在构建参数中将 `--single` 换成 `--target=opencode-windows-x64` 或 `--target=opencode-windows-arm64`；`--target` 优先于 `--single`。x64 的 `--single --baseline` 会同时选择普通和 baseline 目录，V2 也可明确选择 `--target=opencode-windows-x64-baseline`。这些是该快照的目标名称，不应把当前 Bun 关于 baseline 的说明倒推成所有历史 Bun 版本的 CPU 行为。[S10]

V2 的 `BUN_COMPILE_RELEASE` 会另行下载指定 Bun release 的编译运行时，并调用外部 `unzip`；因此默认隔离函数清除它。只有需要复现该覆盖构建时才专门配置，不应因为默认 Windows 构建就无条件安装 `unzip`。发布压缩、上传步骤也不同于本地构建；尤其 `OPENCODE_RELEASE=0` 仍是非空字符串，在 `Script.release` 中为真，必须移除而非设为 `0`。[S10][S21][S29]

根 `postinstall` 的 `fix-node-pty` 在 Windows 不执行 Unix `spawn-helper` 的 chmod 修复，它不是编译所有 Windows 原生依赖的安装器。只有实际日志表明进入某个依赖的源码编译路径，才按该依赖要求补齐 C++ / Python 等工具，不能把安装 Visual Studio 当成所有错误的通用修复。[S35]

#### 9.7.2 外层 PowerShell、工具 Shell、PTY 并不是同一件事

fork 的 `core/src/shell.ts` 和官方 V2 的 `core/src/shell/select.ts` 都先考虑显式 Shell 配置及有效的 `SHELL` 环境值；没有这些覆盖时，Windows 候选顺序为 `pwsh` → `powershell` → Git Bash → `COMSPEC` / cmd。**在 PowerShell 中启动 TUI 不等于会话内所有命令必然用 PowerShell；安装 Git Bash 也不等于它必然被选中。** [S36][S37]

`OPENCODE_GIT_BASH_PATH` 指向 Git 的 `bin\bash.exe`，用于 Git Bash 路径解析，不是强制切换默认 Shell 的通用开关。需要时核对该文件后在当前终端设置：

```powershell
$OcGitBash = 'C:\Program Files\Git\bin\bash.exe'
if (-not (Test-Path -LiteralPath $OcGitBash)) { throw '请改成实际 Git Bash 路径' }
$env:OPENCODE_GIT_BASH_PATH = $OcGitBash
```

此变量由 `Invoke-Oc` 保留以供子进程使用；长期运行的服务需要重启才能继承新值。不要指向 `C:\Windows\System32\bash.exe` 并把它误认成 Git Bash。

普通 PTY 的 Bun 实现使用 `bun-pty`；官方 V2 在 Windows 加载 `kernel32.dll`，调用 `SetConsoleCtrlHandler(null, 0)`，处理 detached server 派生 ConPTY Shell 时继承“忽略 Ctrl+C”状态的问题。因此验收应包括终端中断，不能只看画面是否出现。[S38]

持久 PTY 则是另一条链：`PersistentPty` → `makeDaemonTransport` → `resolveBinary` → 外部 `opencode-pty`。V2 构建的 `resolveOpencodePty` 在目标不是 Linux / macOS 时直接返回 `undefined`；Windows 产物不嵌入该守护程序，Bun 运行时解析器在无覆盖、无嵌入资源时退回 PATH 上的 `opencode-pty`。[S27][S28][S39] **这说明本文 Windows 构建不能承诺持久终端开箱即用，并不等于所有 TUI 或普通 Shell 功能都不可用。** 不应拿 Linux 的 `opencode-pty` 复制到 Windows 来补齐；需要该功能时优先按 WSL2 路线验证。

官方 V2 服务还将 fff 默认值设为 `process.platform !== "win32"`；Windows 上未设置 `OPENCODE_DISABLE_FFF` 时默认禁用该路径。这是平台分支，并非安装成功就会自动开启所有索引实现。[S32]

#### 9.7.3 服务、数据库与 EXE 的生命周期

隔离的数据流是：`Invoke-Oc` 环境 → CLI → `selfCommand()` 选定的当前 EXE / Bun 入口 → 子服务继承环境 → Global 根目录 → 数据库与服务注册。managed service 的持久 `env` 配置会在继承环境之后合并，有能力覆盖 XDG 等值；不要向开发 profile 复制日常 `service*.json`，也不要用 `service set env` 把目录重新指回日常环境。[S13][S30][S33]

普通 TUI 默认使用 `mismatch: "replace"`；只有目录隔离才能让不同版本落到不同注册记录。`local` channel 虽将 DB 命名为 `opencode-local.db`，却不自动为多个工作区分配不同服务端口；两个独立 V2 profile 仍可能争用 49375。`standalone` 的端口 0 解决本次服务的端口分配，XDG 隔离解决持久数据，两者作用不同。[S12–S15][S20]

Windows 运行中的 EXE 可能阻止删除或替换。三套脚本都重建输出目录，**重新编译前先退出对应 TUI、停止该 profile 的开发服务**。官方 V2 的 `retained-image.ts` 确有硬链接保护，但 `installed()` 仅识别 `node_modules` 内的安装及家目录 `.opencode\bin\opencode.exe`，普通 worktree 的 dist 产物不满足该条件；不能据此保证正在运行的开发 EXE 可直接重建。[S40]

需要另一份产物时，V2 可使用 `--outdir=dist-second`，其相对路径基于 `packages/cli`，而非当前 PowerShell 目录。但构建首先递归删除 outdir，只排除“正好等于包目录”，**没有通用的目录范围保护**；只能指定专门的可重建产物目录。V1 / preview 在此快照没有同样的 outdir 开关。[S2][S5][S10]

### 9.8 Windows 验收与排障

按以下顺序验收，明确是哪一层通过：

1. 记录固定 SHA、两个 Bun 的版本和架构、实际构建命令；依赖安装失败时保留 frozen-lockfile 错误。
2. 核对三种产物的目录和 `.exe` 名称，分别通过隔离函数执行帮助 / 版本命令。
3. 官方 V2 先用 standalone 打开空项目，再测试一次 Shell 命令、文件读写、终端中断；需要持久终端时单独记录它的结果。
4. 检查 profile 中生成的 DB、日志、配置及服务记录；可以用下列只读命令查看文件位置，不要直接打印可能含密码的注册文件内容。
5. 退出 TUI、停止开发服务，再比对日常入口的实际路径、版本与 EXE 哈希。

```powershell
$OcProfileRoot = Join-Path $env:USERPROFILE '.local\share\opencode-source\v2'
Get-ChildItem -LiteralPath $OcProfileRoot -Recurse -File |
    Where-Object { $_.Name -like '*.db*' -or $_.Name -like 'service*.json' } |
    Select-Object FullName, Length, LastWriteTime
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(14096, 14097, 49374, 49375) } |
    Select-Object LocalAddress, LocalPort, OwningProcess
```

| 症状 | 源码对应的检查方向 |
| --- | --- |
| 编译结果架构不符 | 查看该 Bun 的 `process.arch`；Windows ARM64 的 x64 模拟进程仍选择 x64 |
| `bun` 内外版本不同 | `Invoke-Oc` 是否调用真实 `bun.exe` 并前置其目录；不要只改外层命令路径 |
| 路径含空格后参数错位 | 使用 `-LiteralPath`、调用运算符 `&` 和 `-ArgumentList` 数组；不要拼接命令或用 `Invoke-Expression` |
| `opencode.ps1` 因执行策略被拒绝 | 先定位真实 EXE，调用 dist 产物；无需为本手册关闭整机执行策略 |
| `EPERM` / `EBUSY`、无法删除 dist | 先退出该 EXE 及开发服务，核对是否有文件占用；不要按进程名批量终止日常版本 |
| ARM64 原生依赖缺失 | 核对相应版本实际发布的预编译包；不要混用 x64 / ARM64 `node_modules` |
| `Failed to start server` / 等待超时 | 同 profile 查看状态、日志与监听端口；preview 和官方 V2 的注册格式不同 |
| 普通 TUI 可用，持久终端报找不到程序 | 检查第 9.7.2 节的 `opencode-pty` 平台资源限制 |
| Ctrl+C 不工作、交互 Shell 退出异常 | 分别核对外层终端、实际 Shell、普通 PTY 与持久 PTY；不要把四者归为同一个故障 |
| profile 内没有临时文件但公共 temp 有写入 | 用 Bun 检查 `os.tmpdir()`，确认 `TEMP` / `TMP` 及服务启动时继承值 |

源码修改后的类型检查仍在包目录执行，例如在对应 worktree 的 `packages/cli` 中运行 `Invoke-Oc -ProfileName v2 -FilePath $OcBunV2 -ArgumentList @('typecheck')`；测试也在受影响包执行，不从仓库根目录跑测试。不要在 V1 快照使用官方 V2 的包布局假设。

### 9.9 WSL2：复用 Linux 步骤，但保留边界

先在 Windows PowerShell 查看发行版状态：

```powershell
wsl --status
wsl --list --verbose
```

没有 WSL 时按 [Microsoft WSL 安装文档](https://learn.microsoft.com/en-us/windows/wsl/install) 完成安装；安装可能要求提权和重启。进入选定的 WSL2 Linux 发行版后，在 Bash 里执行：

```bash
uname -srm
type -a bun git opencode
bun -p 'process.platform + " " + process.arch'
```

这里 Bun 必须报告 `linux`，而不是经互操作调用 Windows `bun.exe` 后得到的 `win32`。然后按第 3 节定义 Linux `ocenv`，在 WSL 家目录 `~/src` 内重新克隆、安装依赖并完成第 4 / 5 / 7 节。Linux 源码工具通常应和源码放在 WSL 文件系统中，避免把大量依赖放到 `/mnt/c`；Microsoft 的文件系统指南也建议按运行工具所在系统存放项目。[D8]

Windows 与 WSL 应各有源码检出和 `node_modules`；不通过 `git worktree` 跨两套系统共享带有绝对路径元数据的工作树。Windows profile 使用 Windows 用户目录，WSL profile 使用 Linux 用户目录；相同字符串 `~/.local/share/...` 不表示相同物理位置。不要主动将配置、数据库或 PTY 运行目录链接回另一套环境。

WSL 不是网络隔离保证；localhost 转发、镜像网络等设置会影响服务可达性与端口使用。[D9] 首次测试仍优先 standalone，长期服务分别分配端口。不为本地源码验收额外设置 `--hostname 0.0.0.0`。如果明确通过 `--server` 连接 Windows 或 WSL 的另一个服务，实际会话和数据库在服务端，客户端的 XDG 设置无法把远端数据改为本地隔离副本。

### 9.10 本次文档验证范围

- **源码核查**：通过 Git 对象读取两个固定提交，追踪构建目标 → Bun 编译 → 原生绑定 → CLI 入口 → 自启动 / 服务发现 → Global / DB / PTY 路径；没有用当前工作区实现冒充固定快照。
- **命令验证**：Windows 代码块进行 PowerShell 语法解析；隔离函数在 PowerShell 7.6.5 / Bun 1.3.14 下验证环境继承、临时目录、PATH、带空格及末尾反斜杠参数、中文参数，以及失败后的环境恢复。PowerShell 5.1 验证为提前报出版本要求，不执行包装命令。Linux 代码块重新做 Bash 语法检查。
- **尚未验证**：未安装这两套完整 workspace 依赖，未执行三套 OpenCode 的全量 Windows 构建、真实 TUI / 服务或 Windows ARM64 验收；本机 Bun 1.3.14 的检查不替代 Bun 1.4.2 的产品验收。实际机器按第 9.8 节记录结果。

## 10. 证据索引

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
- [S26 V2 产物与构建图静态检查](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/script/verify-artifact.ts)
- [S27 V2 持久 PTY 与运行目录](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/core/src/persistent-pty/index.ts)
- [S28 V2 持久 PTY 可执行文件解析](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/core/src/persistent-pty/binary.bun.ts)
- [S29 fork 构建版本、channel 与 release 判断](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/script/src/index.ts)
- [S30 V2 CLI 自启动命令](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/src/util/process.ts)
- [S31 fork preview daemon 注册与进程启动](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/cli/src/services/daemon.ts)
- [S32 V2 服务模式、stdin 租约与 Windows 默认值](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/src/server-process.ts)
- [S33 V2 managed service 派生及环境合并](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/client/src/service-contender.ts)
- [S34 fork preview 监听端口选择](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/cli/src/commands/handlers/serve.ts)
- [S35 V2 node-pty postinstall 修复](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/core/script/fix-node-pty.ts)
- [S36 fork Shell 选择及 Windows 进程树处理](https://github.com/AManHasNoName12138/opencode/blob/3c893f0a166cfc433819b4eff65d2e6c7696a1c9/packages/core/src/shell.ts)
- [S37 V2 Shell 选择](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/core/src/shell/select.ts)
- [S38 V2 普通 Bun PTY 与 Windows Ctrl+C](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/core/src/pty/pty.bun.ts)
- [S39 V2 构建时 PTY 资源平台筛选](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/script/opencode-pty.ts)
- [S40 V2 Windows 运行镜像保留及安装路径判定](https://github.com/anomalyco/opencode/blob/ff72659a47b8cbfcb7b13f5a94b6f1e239460c5b/packages/cli/src/services/retained-image.ts)
- [D1 V1 到 V2 迁移](https://opencode.ai/v2/docs/migrate-v1/)
- [D2 V2 故障排查](https://opencode.ai/v2/docs/troubleshooting/)
- [D3 Bun 安装与指定版本](https://bun.sh/docs/installation)
- [D4 Node os.tmpdir 的 Windows 环境变量规则](https://nodejs.org/api/os.html#ostmpdir)
- [D5 Bun Shell 的跨平台内置命令](https://bun.sh/docs/runtime/shell)
- [D6 Bun Windows 可执行文件与自动 .exe 后缀](https://bun.sh/docs/bundler/executables)
- [D7 xdg-basedir 5.1.0 的根目录实现](https://github.com/sindresorhus/xdg-basedir/blob/v5.1.0/index.js)
- [D8 Microsoft WSL 文件系统指导](https://learn.microsoft.com/en-us/windows/wsl/filesystems)
- [D9 Microsoft WSL 网络模式](https://learn.microsoft.com/en-us/windows/wsl/networking)
- [D10 PowerShell 原生参数传递模式](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing?view=powershell-7.5#passing-arguments-to-native-commands)

- [V2 安装器](https://opencode.ai/v2/install)
- [V1 文档](https://opencode.ai/docs/)
- [V2 文档](https://opencode.ai/v2/docs/)
