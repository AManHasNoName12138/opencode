# GitHub PR 贡献指南

这份指南面向已经熟悉 Git，但还不熟悉 GitHub 协作流程的开发者。目标是让你能在 `opencode` 仓库中修复 bug 或实现 feature，并把改动以 Pull Request 的形式提交给上游仓库，同时把本地 `/understand --language zh` 生成的文件管理好，不污染 PR。

## 1. 先把 Git 和 GitHub 的概念对齐

你熟悉的 Git 负责本地提交、分支、合并、rebase 和远端同步。GitHub 在 Git 之上增加了协作对象：

| GitHub 概念 | 对应含义 | 你需要关心什么 |
| --- | --- | --- |
| Repository | 托管在 GitHub 上的仓库 | `anomalyco/opencode` 是上游仓库 |
| Fork | 你账号下的一份仓库拷贝 | 没有上游写权限时，把分支 push 到自己的 fork |
| Pull Request | 请求上游合并你的分支 | 不是 `git pull`，而是一次代码评审和合并请求 |
| Base branch | 目标分支 | 本仓库默认分支是 `dev` |
| Head branch | 你的贡献分支 | 例如 `<your-user>:fix/session-retry` |
| Issue | bug、需求或讨论入口 | 本仓库要求 PR 关联已有 issue |
| Review | 维护者对 PR 的反馈 | 继续向同一个分支 push commit 即可更新 PR |
| Checks | CI、测试、lint 等自动检查 | PR 页面 `Checks` 标签能看到失败原因 |

GitHub 官方文档把 PR 定义为“提议合并代码变更”，它的核心作用是让维护者在合并前讨论、审查并检查变更。

## 2. 本仓库的贡献约定

先看两份本地文档：

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [AGENTS.md](./AGENTS.md)

这里摘出最容易影响 PR 是否顺利的规则：

- PR 必须关联一个已有 issue。PR 描述中使用 `Fixes #123` 或 `Closes #123`。
- UI 或核心产品 feature 需要先经过维护者设计 review，不建议直接实现一个大 feature 再开 PR。
- PR 要小而聚焦，只解决一个 bug 或一个明确 feature。
- PR 标题和 commit message 使用 conventional commit 风格：`type(scope): summary`。
- 可用类型：`feat`、`fix`、`docs`、`chore`、`refactor`、`test`。
- 常用 scope：`core`、`opencode`、`tui`、`app`、`desktop`、`sdk`、`plugin`。
- 不要写很长的 AI 风格 PR 描述。简短说明“改了什么、为什么、怎么验证”。
- 测试不要从仓库根目录运行。进入对应 package 后再运行，例如 `packages/opencode`。
- 类型检查使用 `bun typecheck`，不要直接运行 `tsc`。
- 修改 API 或 SDK 相关内容后，按仓库说明运行 `./packages/sdk/js/script/build.ts` 重新生成 JavaScript SDK。

推荐标题示例：

```text
fix(core): handle queued prompt retry
feat(plugin): add provider capability flag
docs: clarify GitHub PR workflow
test(opencode): cover session interruption no-op
```

## 3. 第一次配置：fork 和 remote

如果你没有 `anomalyco/opencode` 的写权限，推荐使用标准 fork 模型：

- `origin` 指向你自己的 fork。
- `upstream` 指向官方上游仓库 `anomalyco/opencode`。
- 你从 `upstream/dev` 同步最新代码。
- 你把贡献分支 push 到 `origin`。
- 你在 GitHub 上从 `origin/<branch>` 向 `upstream/dev` 开 PR。

### 3.1 从零开始 clone

先在 GitHub 网页上 fork `https://github.com/anomalyco/opencode` 到你的账号，然后：

```powershell
git clone https://github.com/<your-user>/opencode.git
cd opencode
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch --all --prune
git switch dev
```

确认 remote：

```powershell
git remote -v
```

期望看到类似：

```text
origin    https://github.com/<your-user>/opencode.git (fetch)
origin    https://github.com/<your-user>/opencode.git (push)
upstream  https://github.com/anomalyco/opencode.git (fetch)
upstream  https://github.com/anomalyco/opencode.git (push)
```

### 3.2 如果你已经 clone 了上游仓库

当前这个工作区的 `origin` 指向 `https://github.com/anomalyco/opencode.git`。如果你要以外部贡献者身份开 PR，可以先在 GitHub 上创建 fork，然后把 remote 改成标准 fork 模型：

```powershell
git remote rename origin upstream
git remote add origin https://github.com/<your-user>/opencode.git
git fetch --all --prune
git switch dev
```

如果你想少改 remote，也可以保留 `origin` 指向上游，再新增一个以你用户名命名的 remote：

```powershell
git remote add <your-user> https://github.com/<your-user>/opencode.git
git push -u <your-user> fix/some-bug
```

这种方式也能开 PR，但长期贡献时 `origin = fork`、`upstream = upstream repo` 更直观。

### 3.3 Windows 或沙盒里看到 dubious ownership

如果 Git 报：

```text
fatal: detected dubious ownership in repository
```

这是 Git 的安全保护，不是仓库坏了。确认路径可信后，执行一次：

```powershell
git config --global --add safe.directory C:/Users/shuwe/CodeProjects/open-source/opencode
```

这只修改你的全局 Git 配置，不会进入 PR。

## 4. 每次开始工作前：同步 `dev`

本仓库默认分支是 `dev`，不是 `main`。开始任何 bugfix 或 feature 前，先同步：

```powershell
git fetch upstream
git switch dev
git pull --ff-only upstream dev
git push origin dev
```

如果你的 fork 的 `dev` 只用于跟随上游，`--ff-only` 可以避免在本地默认分支上产生多余 merge commit。

然后从最新 `dev` 拉工作分支：

```powershell
git switch -c fix/short-bug-name
```

分支命名建议：

```text
fix/session-retry
fix/windows-path-normalization
feat/plugin-auth-provider
docs/github-pr-guide
test/session-interruption
```

## 5. 修 bug 的推荐流程

1. 在 GitHub 上确认或创建 issue，记录复现步骤、期望行为、实际行为。
2. 本地同步 `dev`，新建 `fix/...` 分支。
3. 先复现 bug。能写回归测试就先写一个会失败的测试。
4. 修改实现，保持改动聚焦。
5. 在受影响 package 下运行类型检查和测试。
6. 检查 diff，只提交和 bug 直接相关的文件。
7. push 分支，开 PR，描述复现、修复思路和验证方式。

常用命令：

```powershell
git fetch upstream
git switch dev
git pull --ff-only upstream dev
git switch -c fix/session-interrupt-noop

# 修改代码后
git status --short
git diff
git add <changed-files>
git commit -m "fix(core): ignore idle session interruption"
git push -u origin fix/session-interrupt-noop
```

验证示例：

```powershell
cd packages/opencode
bun typecheck
bun test
```

如果改的是 `packages/core`：

```powershell
cd packages/core
bun typecheck
bun test
```

如果改的是 Web UI：

```powershell
cd packages/app
bun typecheck
bun test
```

根目录可以运行 lint：

```powershell
bun run lint
```

但不要在根目录运行 `bun test`，仓库已经明确用脚本阻止这种做法。

## 6. 做 feature 的推荐流程

Feature 比 bugfix 更容易被维护者拒绝，先确认方向很重要：

1. 搜索已有 issue 和 PR，确认没有重复工作。
2. 对 UI 或核心产品功能，先在 issue 里描述方案并等待维护者反馈。
3. 把 feature 拆小，第一版只做最小可评审闭环。
4. 尽量补测试或文档，尤其是行为变化、配置变化、SDK/API 变化。
5. PR 描述中说明为什么需要这个 feature、用户如何使用、有哪些边界。

提交示例：

```powershell
git switch -c feat/plugin-provider-capability
git add <changed-files>
git commit -m "feat(plugin): expose provider capability flag"
git push -u origin feat/plugin-provider-capability
```

如果改动触及 V2 Session Core，注意不要破坏这些边界：

- durable prompt admission 和 model execution 分离。
- `SessionExecution` 保持 process-global、Session-ID based。
- runner、model resolution、tool registry、permissions、filesystem 都保持 Location-scoped。
- 每个 provider turn 保持一次明确的 `llm.stream(request)` 调用。

这些约束写在 [AGENTS.md](./AGENTS.md) 里，相关 PR 最好在描述中点明自己没有改变这些边界。

## 7. 开 PR：网页方式

push 分支后：

```powershell
git push -u origin fix/session-interrupt-noop
```

然后在 GitHub 网页上：

1. 打开 `https://github.com/anomalyco/opencode`。
2. 如果看到黄色提示条，点击 `Compare & pull request`。
3. 如果没有提示条，点击 `Pull requests`，再点击 `New pull request`。
4. 选择 `compare across forks`。
5. `base repository` 选 `anomalyco/opencode`，`base branch` 选 `dev`。
6. `head repository` 选你的 fork，`compare branch` 选你的工作分支。
7. 填标题和描述。
8. 如果还没准备好正式 review，创建 Draft PR。
9. 勾选 `Allow edits from maintainers`，方便维护者直接帮你修小问题。

PR 标题示例：

```text
fix(core): ignore idle session interruption
```

PR 描述模板：

```markdown
## Summary
- Fixed idle Session V2 interruption returning a noisy error.
- Kept active interruption behavior unchanged.

## Issue
Fixes #123

## Verification
- `cd packages/core && bun typecheck`
- `cd packages/core && bun test`
```

## 8. 开 PR：GitHub CLI 方式

安装并登录 GitHub CLI 后：

```powershell
gh auth login
```

创建 PR：

```powershell
gh pr create `
  --repo anomalyco/opencode `
  --base dev `
  --head <your-user>:fix/session-interrupt-noop `
  --title "fix(core): ignore idle session interruption" `
  --body "Fixes #123`n`n## Summary`n- Ignore interruption when the session is idle.`n`n## Verification`n- cd packages/core && bun typecheck"
```

如果 PR 还只是早期方案：

```powershell
gh pr create `
  --repo anomalyco/opencode `
  --base dev `
  --head <your-user>:feat/plugin-provider-capability `
  --title "feat(plugin): expose provider capability flag" `
  --draft
```

如果你使用的是标准 fork 模型，且当前分支已经 push 到 `origin`，也可以简化为：

```powershell
gh pr create --base dev --fill
```

但第一次贡献时建议显式写 `--repo`、`--base`、`--head`，能减少选错目标分支的风险。

## 9. PR 打开后的日常维护

### 9.1 根据 review 修改

PR 创建后，不需要重新开 PR。你只要继续在同一个分支提交并 push，GitHub 会自动更新 PR：

```powershell
git switch fix/session-interrupt-noop
# 修改代码
git add <changed-files>
git commit -m "test(core): cover idle interruption"
git push
```

如果只是修拼写、格式或 review 里的小调整，也可以 amend 上一个 commit：

```powershell
git add <changed-files>
git commit --amend --no-edit
git push --force-with-lease
```

只用 `--force-with-lease`，不要用普通 `--force`。

### 9.2 让 PR 跟上最新 `dev`

当 GitHub 提示分支落后，或者 CI 需要最新上游代码时：

```powershell
git fetch upstream
git switch fix/session-interrupt-noop
git rebase upstream/dev
git push --force-with-lease
```

如果 rebase 有冲突：

```powershell
# 解决冲突文件
git add <resolved-files>
git rebase --continue
git push --force-with-lease
```

### 9.3 CI 失败怎么办

1. 打开 PR 的 `Checks` 标签，看失败的是 typecheck、test、lint 还是构建。
2. 在本地进入对应 package 复现同样命令。
3. 修复后 push 到同一个分支。
4. 如果 CI 失败和你的改动无关，在 PR 里简短说明观察到的情况。

## 10. 提交前检查清单

开 PR 前跑一遍：

```powershell
git status --short
git diff --check
git diff --stat upstream/dev...HEAD
git diff --name-only upstream/dev...HEAD
```

你要确认：

- diff 里没有 `.understand-anything/`。
- diff 里没有 `.env`、token、日志、临时文件。
- PR 只包含本次 bugfix 或 feature 必要文件。
- commit message 和 PR 标题符合 conventional commit 风格。
- PR 描述引用了 issue，例如 `Fixes #123`。
- 验证命令来自对应 package 目录，不是仓库根目录的 `bun test`。
- 如果修改 API/SDK，已经运行 SDK 生成命令并提交生成结果。

## 11. 管理 `/understand --language zh` 生成的文件

你当前本地有 `.understand-anything/`，其中包含：

- `.understandignore`
- `config.json`
- `knowledge-graph.json`
- `fingerprints.json`
- `meta.json`
- `intermediate/scan-result.json`
- `.trash-*` 临时/历史中间产物

这些文件很适合保留在本机辅助理解代码，但通常不适合提交到上游 PR，原因是：

- 文件体积大，`knowledge-graph.json` 和 `fingerprints.json` 会让 PR 很重。
- 内容和本地分析时间、当前 commit、语言设置绑定，维护者不一定能复用。
- 每次重新运行 `/understand` 都可能产生大量 diff。
- 这些文件是个人工作流产物，不是项目运行或测试所需源码。

当前仓库里 `.understand-anything/` 还没有被 Git 跟踪，这是最好的起点。

### 11.1 推荐方案：写入 `.git/info/exclude`

这是最推荐的方式。`.git/info/exclude` 是当前仓库本地的忽略规则，不会被提交，不会影响远端，也不会影响你的 PR。

在仓库根目录运行：

```powershell
@"

# Local /understand output
/.understand-anything/
"@ | Add-Content -Encoding utf8 -LiteralPath .git/info/exclude
```

然后确认它不再出现在 status 里：

```powershell
git status --short
```

如果你想确认规则是否生效：

```powershell
git check-ignore -v .understand-anything/knowledge-graph.json
```

看到来源是 `.git/info/exclude` 就对了。

### 11.2 不推荐直接改仓库 `.gitignore`

也可以把下面规则加入根目录 `.gitignore`：

```gitignore
/.understand-anything/
```

但这会变成一个需要提交的仓库改动。除非你准备提交一个专门的 `chore` 或 `docs` PR 让维护者接受这条共享忽略规则，否则不要为了本地文件去改 `.gitignore`。

本地个人文件优先放：

- 当前仓库专用：`.git/info/exclude`
- 所有仓库通用：全局 ignore 文件
- 团队共享规则：项目 `.gitignore`

### 11.3 如果你想在本机用 Git 单独管理这些文件

如果你想给 `.understand-anything/` 自己留版本历史，又不想影响父仓库 PR，可以把它做成一个嵌套的本地 Git 仓库，并让父仓库忽略整个目录。

先确保父仓库忽略它：

```powershell
@"

# Local /understand output
/.understand-anything/
"@ | Add-Content -Encoding utf8 -LiteralPath .git/info/exclude
```

进入 `.understand-anything/` 初始化独立仓库：

```powershell
cd .understand-anything
git init
```

给这个内部仓库单独设置忽略规则，避免把 `.trash-*` 和大量临时文件都提交进去：

```powershell
@"
/.trash-*
/tmp/
/intermediate/*
!/intermediate/scan-result.json
"@ | Set-Content -Encoding utf8 -LiteralPath .gitignore
```

提交你真正想留历史的文件：

```powershell
git add .understandignore config.json meta.json knowledge-graph.json fingerprints.json intermediate/scan-result.json .gitignore
git commit -m "chore: save opencode zh knowledge graph"
```

这样父仓库的 PR 不会看到 `.understand-anything/`，而你又可以在内部仓库里查看知识图谱的变化历史。

注意：不要把这个内部仓库 push 到 `anomalyco/opencode`。如果需要远端备份，使用你自己的私有仓库。

### 11.4 如果你已经误暂存了 `.understand-anything/`

如果只是 staged，还没 commit：

```powershell
git restore --staged .understand-anything
```

然后把它加入 `.git/info/exclude`。

如果已经 commit，但还没 push，最干净的做法通常是重做这个 commit：

```powershell
git reset --soft HEAD~1
git restore --staged .understand-anything
git commit -m "<原来的合适提交信息>"
```

如果 `.understand-anything/` 已经被远端仓库跟踪，单靠 ignore 不会让 Git 停止跟踪。需要先从索引移除：

```powershell
git rm -r --cached .understand-anything
```

但当前这个仓库里它还没有被跟踪，所以不要主动运行这条命令。

### 11.5 拉取远端时会不会受影响

只要 `.understand-anything/` 保持未跟踪且被本地 exclude：

- `git fetch upstream` 不受影响。
- `git pull --ff-only upstream dev` 一般不受影响。
- `git rebase upstream/dev` 一般不受影响。
- `git diff upstream/dev...HEAD` 不会包含它。
- `git push origin <branch>` 不会上传它。
- GitHub PR 不会显示它。

唯一需要留意的是：如果未来上游真的新增了同名路径 `.understand-anything/` 并开始跟踪，Git 可能因为本地未跟踪文件挡住 checkout 或 merge。这个概率很低；遇到时先备份或移动本地目录，再继续同步。

## 12. 一个完整示例

假设你要修 issue `#123`，分支名 `fix/session-interrupt-noop`：

```powershell
# 只做一次：忽略本地 /understand 产物
@"

# Local /understand output
/.understand-anything/
"@ | Add-Content -Encoding utf8 -LiteralPath .git/info/exclude

# 同步上游 dev
git fetch upstream
git switch dev
git pull --ff-only upstream dev
git push origin dev

# 新建工作分支
git switch -c fix/session-interrupt-noop

# 修改代码后检查
git status --short
git diff

# 提交
git add <changed-files>
git commit -m "fix(core): ignore idle session interruption"

# 验证
cd packages/core
bun typecheck
bun test
cd ../..

# 最后确认没有本地知识图谱文件
git status --short
git diff --name-only upstream/dev...HEAD

# 推送并开 PR
git push -u origin fix/session-interrupt-noop
gh pr create `
  --repo anomalyco/opencode `
  --base dev `
  --head <your-user>:fix/session-interrupt-noop `
  --title "fix(core): ignore idle session interruption" `
  --body "Fixes #123`n`n## Summary`n- Ignore interruption when no local session drain is active.`n`n## Verification`n- cd packages/core && bun typecheck`n- cd packages/core && bun test"
```

## 13. 参考资料

- GitHub Docs: [Fork a repository](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo)
- GitHub Docs: [Creating a pull request from a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request-from-a-fork)
- GitHub Docs: [Syncing a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork)
- GitHub CLI Manual: [`gh pr create`](https://cli.github.com/manual/gh_pr_create)
- Git Manual: [`gitignore`](https://git-scm.com/docs/gitignore)
