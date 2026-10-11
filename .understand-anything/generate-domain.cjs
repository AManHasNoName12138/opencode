const fs = require('node:fs')
const cp = require('node:child_process')
const root = process.cwd()
const graph = {
  version: '1.0.0',
  project: {
    name: 'OpenCode',
    languages: ['TypeScript', 'JavaScript', 'Rust'],
    frameworks: ['Effect', 'SolidJS', 'SolidStart', 'Hono', 'Drizzle ORM', 'Bun', 'Tauri'],
    description: '开源 AI 编程代理，围绕项目目录开展多轮模型会话、受权限约束的代码操作和会话分享，并提供 Zen / Go 模型接入与商业计费。当前代码同时保留 legacy 会话链路和独立演进的 V2 Session Core；商业推理还包含迁移到新服务的转发边界。',
    analyzedAt: new Date().toISOString(),
    gitCommitHash: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  },
  nodes: [], edges: [], layers: [], tour: [],
}
function domain(id, name, summary, entities, rules, interactions) {
  graph.nodes.push({ id: `domain:${id}`, type: 'domain', name, summary, tags: [id], complexity: 'complex', domainMeta: { entities, businessRules: rules, crossDomainInteractions: interactions } })
}
function flow(domainID, id, name, summary, entryPoint, entryType, steps) {
  graph.nodes.push({ id: `flow:${id}`, type: 'flow', name, summary, tags: [domainID], complexity: steps.length > 4 ? 'complex' : 'moderate', domainMeta: { entryPoint, entryType } })
  graph.edges.push({ source: `domain:${domainID}`, target: `flow:${id}`, type: 'contains_flow', direction: 'forward', weight: 1 })
  steps.forEach(([key, title, text, file], i) => {
    if (!fs.existsSync(file)) throw Error(`Missing evidence file: ${file}`)
    graph.nodes.push({ id: `step:${id}:${key}`, type: 'step', name: title, summary: text, tags: [domainID, id], complexity: 'moderate', filePath: file })
    graph.edges.push({ source: `flow:${id}`, target: `step:${id}:${key}`, type: 'flow_step', direction: 'forward', weight: Math.round((i + 1) / steps.length * 10) / 10 })
  })
}
const core = 'packages/core/src/'
const consoleCore = 'packages/console/core/src/'
const consoleApp = 'packages/console/app/src/'
domain('agent-sessions', '智能体会话与持续执行', '把用户请求转化为可持久记录、多轮推进的编程会话。V2 通过 durable inbox、安全边界和显式 provider turn 组织执行；legacy SessionPrompt 仍保留独立实现，二者不能被视为同一条运行链路。', ['SessionV2', 'session_input', 'SessionMessage', 'SessionRunCoordinator', 'SessionContextEpoch', 'SessionPrompt'], ['复用 Session ID 采用已有 Session；复用 prompt message ID 仅在 Session、prompt 和 delivery 完全匹配时构成重试，否则冲突。', 'prompt 先完成持久接纳，resume:false 仅接纳；默认 steer，queue 在会话将闲置时一次提升一条。', '同一 Session 的进程内执行串行化，不同 Session 可并发；wake 仅排空待处理输入，不承担崩溃后 provider 工作恢复。', 'V2 每个 provider turn 显式调用一次 llm.stream，并从持久投影重新装配后续历史；EventV2 replay owner 不是分布式 Session 执行锁。', '自动压缩已接入 runner；公开 compact、wait、shell、skill 操作仍返回 OperationUnavailableError。'], ['从模型接入领域解析当前 Location 可用模型。', '向工具领域派发本地调用，并将结果写回历史。', '使用项目 Location 与快照；legacy 会话可进入分享流程。'])
flow('agent-sessions', 'admit-session-input', '接纳 V2 用户输入', '建立或采用 Session，持久接纳用户 prompt，并按 resume 选项发出执行提示。接纳成功并不等于用户消息已经出现在可见历史中。', 'SessionV2.create / SessionV2.prompt；server.session session.create / session.prompt', 'http', [
 ['adopt-session', '建立或采用 Session', 'create 先查询指定 ID；已有 Session 直接返回，否则解析项目并发布 Created，投影创建竞态也采用已存在的身份。', core+'session.ts'],
 ['normalize-prompt', '规范化 prompt 与投递方式', 'resolvePrompt 规范化附件 MIME；没有指定 delivery 时使用 steer，没有 message ID 时生成 ID。', core+'session.ts'],
 ['persist-admission', '发布 PromptAdmitted 并落入 inbox', 'SessionInput.admit 查找既有记录或发布持久 PromptAdmitted；投影将接纳信息保存到 session_input，保留 admittedSeq。', core+'session/input.ts'],
 ['reconcile-retry', '核对精确重试', '对照 Session、prompt 内容和 delivery；不一致转为 PromptConflictError。历史已投影 prompt 的兼容读取可补出 promoted inbox 记录。', core+'session/input.ts'],
 ['schedule-wake', '按 resume 选项唤醒', 'resume 不为 false 时调用进程全局 SessionExecution.wake；返回接纳结果而不等待模型完成。', core+'session.ts'],
])
flow('agent-sessions', 'drain-session-input', '串行推进 V2 会话', '按 Session ID 协调本地 drain，在安全边界提升 durable 输入，运行明确的模型轮次并根据工具结果和新输入继续。', 'SessionExecution.wake / resume；SessionV2.interrupt', 'event', [
 ['coordinate', '合并 wake 并串行化同会话执行', 'SessionRunCoordinator 将同一 Session 的显式 resume 加入已有执行，合并 wake；interrupt 停止当前拥有的 fiber，空闲时无操作。', core+'session/run-coordinator.ts'],
 ['locate', '在 drain 开始时解析 Location', 'SessionExecutionLocal 从 SessionStore 读取最新 session.location，通过 LocationServiceMap.get 提供 runner 所需的 Location 服务。', core+'session/execution/local.ts'],
 ['promote', '在安全边界提升 steer 或 queue', '提升截止序列内的 steer；queue 仅在将闲置时提升一条并重新评估继续条件。新用户输入将当前 agent 的 provider-turn 计数重置为 1。', core+'session/runner/llm.ts'],
 ['assemble', '重载历史并构造本轮请求', '选择 agent、准备 Context Epoch、解析模型、读取 SessionHistory，附上可见工具定义；到达 agent 步数上限时禁用工具。', core+'session/runner/llm.ts'],
 ['stream', '执行一个 provider turn', '显式调用 llm.stream(request)，把 LLMEvent 发布为会话事件；providerExecuted 工具由供应商处理，其余本地调用进入工具结算。', core+'session/runner/llm.ts'],
 ['continue', '结算结果并检查下一轮', '等待本地工具结果，随后重新读取持久历史。需要继续或存在 steer 时继续当前 drain，闲置边界再检查 queue；无 eligible 输入的 advisory wake 直接结束。', core+'session/runner/llm.ts'],
])
flow('agent-sessions', 'maintain-session-context', '维护系统上下文与自动压缩', '把动态系统信息与会话历史边界分开管理，在上下文过大时生成可持久重用的压缩摘要。', 'SessionRunner.runTurn 的上下文准备与自动压缩检查', 'event', [
 ['collect-context', '组合系统、技能与引用上下文', 'runner 并发加载 SystemContextRegistry、SkillGuidance 与 ReferenceGuidance，再合并成 SystemContext。', core+'session/runner/llm.ts'],
 ['reconcile-epoch', '建立或协调 Context Epoch', '首次持久保存 baseline 与 snapshot；上下文变化可发布 ContextUpdated，压缩后的 replacement 条件决定何时替换 baseline。', core+'session/context-epoch.ts'],
 ['select-history', '选取与 baseline 对齐的历史', 'SessionHistory 基于最新 compaction 和 baselineSeq 选择消息，保留需要的后续 system 更新并解码成运行历史。', core+'session/history.ts'],
 ['compact-history', '自动压缩后重建请求', 'SessionCompaction 检查预算或处理适用的 context overflow，发布 Compaction.Started / Ended 并保存摘要；runner 再加载投影。此流程不代表公开 compact API 已开放。', core+'session/compaction.ts'],
])
flow('agent-sessions', 'run-legacy-session', '运行 legacy 会话链路', '保留 packages/opencode 中的 SessionPrompt、消息 parts、MCP 和插件集成。该流程独立于 V2 durable inbox，不能把 legacy 能力直接归因于 V2。', 'SessionPrompt.prompt / SessionPrompt.loop', 'manual', [
 ['create-message', '立即建立 legacy 用户消息', '读取 Session、清理 revert、createUserMessage 并 touch；输入中的 tools 开关可转换为 legacy permission 规则。', 'packages/opencode/src/session/prompt.ts'],
 ['start-loop', '按 noReply 决定启动循环', 'noReply 为 true 时直接返回消息，否则进入 SessionPrompt.loop，由 legacy runner 管理继续条件。', 'packages/opencode/src/session/prompt.ts'],
 ['resolve-tools', '解析 legacy 工具与插件', 'SessionTools.resolve 结合 agent、permission、MCP 与 registry；插件可变换消息，系统提示包含环境、指令、MCP 与技能。', 'packages/opencode/src/session/prompt.ts'],
 ['process-result', '处理流输出与完成条件', 'SessionProcessor handle.process 运行本轮，维护 assistant 消息及结构化输出；根据 finish、工具调用和错误决定继续或结束。', 'packages/opencode/src/session/prompt.ts'],
])
domain('tools-and-approvals', '代码操作、工具与用户授权', '把模型的本地工具调用转成受 Location 约束的文件、命令和技能操作。canonical Tool 表达执行契约，叶子工具负责副作用前授权，registry 负责有效注册与统一输出结算。', ['Tool', 'ToolRegistry', 'ApplicationTools', 'PermissionV2', 'PermissionSaved', 'SkillV2', 'ToolOutputStore'], ['Location 注册覆盖 application 注册；同位置最新活跃注册优先，scope 关闭后恢复前一项。', '定义过滤仅控制模型可见性，registry 不执行授权；叶子工具必须在副作用之前调用 PermissionV2。', '配置中的 deny 不可被已记住的 allow 覆盖；always 按项目保存规则。', 'V2 canonical registry 的 MCP、插件工具注册仍有设计缺口，不能假定 legacy 集成已全部迁移。'], ['接收会话 runner 的 tool-call，并把结算结果交还会话历史。', '使用项目 Location 解析路径，按项目保存授权。'])
flow('tools-and-approvals', 'execute-local-tool', '执行并结算本地工具', '通过有效工具目录执行模型调用，处理过期注册、输入输出校验和有限的模型可见输出。', 'SessionRunner 捕获非 providerExecuted 的 tool-call', 'event', [
 ['materialize', '形成有效工具目录', 'ToolRegistry 合并 application 与 Location 注册，并根据 agent 规则过滤整项禁用的工具定义。', core+'tool/registry.ts'],
 ['capture-tool', '校验工具身份与调用契约', 'settle 检查 advertised registration 是否仍有效，再通过 canonical Tool 执行输入解码与输出契约；未知或过期调用得到错误结果。', core+'tool/registry.ts'],
 ['perform-edit', '授权后执行文件修改', '以 edit 为例：解析真实路径，必要时先申请 external_directory，再申请 edit；精确匹配文本并用 writeIfUnchanged 避免覆盖并发修改。', core+'tool/edit.ts'],
 ['bound-output', '结算结果并限制模型输出', '捕获预期 ToolFailure，使用 ToolOutputStore.bound 统一控制模型输出并保留 managed outputPaths；runner 随后持久化结果。', core+'tool/registry.ts'],
])
flow('tools-and-approvals', 'resolve-permission', '处理权限请求与用户回复', '根据 agent 配置和已保存规则判定 allow、deny 或 ask；ask 在用户回复前挂起具体操作。', 'PermissionV2.assert；server.permission 的回复接口', 'event', [
 ['evaluate', '评估 action 与 resource 规则', '组合配置与项目保存规则，优先执行配置 deny；多资源请求中任何 deny 阻止执行，任何 ask 要求询问。', core+'permission.ts'],
 ['ask', '发布 Asked 并等待', '创建带 Session、来源 tool call 和资源的 pending request，发布 Permission Asked；assert 等待 Deferred 完成。', core+'permission.ts'],
 ['reply', '应用允许或拒绝回复', '回复发布 Replied；reject 终止当前请求并拒绝同会话其余待定请求，有文字反馈时使用 CorrectedError。', core+'permission.ts'],
 ['remember', '保存 always 并释放匹配请求', 'always 在请求提供 save patterns 时保存项目规则，重新评估其余 pending requests；符合允许条件且没有配置 deny 的请求一起放行。', core+'permission.ts'],
])
flow('tools-and-approvals', 'load-agent-skill', '发现并加载技能说明', '从 Location 技能来源形成目录，按名称及权限加载工作流说明和少量资源路径到工具结果中。', 'skill 工具调用', 'event', [
 ['discover', '加载并缓存技能来源', 'SkillV2 从目录、URL 或 embedded 来源加载技能；目录识别 Markdown 与 SKILL.md，按来源缓存并按名字合并。', core+'skill.ts'],
 ['authorize', '查找名称并申请 skill 权限', 'skill 工具只接受当前目录中的技能名称，使用 skill action 和该名称申请权限。', core+'tool/skill.ts'],
 ['return-guidance', '返回说明与相对资源基准', '返回 skill_content、技能目录和最多十个采样资源路径，供后续模型步骤使用。', core+'tool/skill.ts'],
])
domain('projects-and-changes', '项目位置、工作副本与变更恢复', '以 Project 和 Location 界定会话运行的代码目录，并管理同项目的 Git worktree 副本。快照和 SessionRevert 提供按消息边界暂存、取消或确认文件回退的能力。', ['Project', 'Location', 'ProjectDirectories', 'ProjectCopy', 'Snapshot', 'SessionRevert'], ['项目身份优先从规范化 remote 推导，其次使用缓存或根提交；非 Git 目录使用 global 身份。', 'Location 由 directory 与可选 workspaceID 表示；省略 workspaceID 为 implicit-local，不能据此声称已实现分布式放置。', '项目副本必须来自已登记目录；移除必须有可识别的 copy strategy。', '回退按持久消息序列和 assistant snapshot 计划文件恢复；stage、clear、commit 具有不同含义。'], ['会话创建和 drain 从此领域获取项目身份与运行位置。', '工具在 Location 内执行文件操作；权限保存按 Project 归属。'])
flow('projects-and-changes', 'resolve-project-location', '识别项目与运行位置', '将目录解析为稳定项目身份，再为该位置提供独立运行服务。', 'Project.resolve / Location.boundNode', 'manual', [
 ['discover-repository', '发现 Git 仓库', '从输入目录发现 repository；非 Git 路径返回 global 项目与文件系统根目录。', core+'project.ts'],
 ['identify-project', '计算项目身份', '规范化 remote 主机和路径形成 hash，后备依次使用 repo-local 缓存与根提交，同时返回 commonDirectory 和 worktree。', core+'project.ts'],
 ['bind-location', '绑定 Location 服务', 'Location.boundNode 保存输入目录、workspaceID、解析出的项目和 VCS 信息；LocationServiceMap 为执行提供对应服务集合。', core+'location.ts'],
])
flow('projects-and-changes', 'manage-project-copy', '创建并登记 Git 工作副本', '使用 ProjectCopy 的 strategy 创建可独立工作的项目目录，并与目录登记及刷新机制保持一致。', 'ProjectCopy.create；server.project-copy', 'http', [
 ['validate-source', '验证 strategy 与项目来源目录', '选择已注册的 strategy，将 sourceDirectory 规范化，并确认来源属于项目目录登记。', core+'project/copy.ts'],
 ['choose-destination', '生成可用目标目录', '使用输入 name 或生成 slug；目标冲突时尝试带数字后缀，超过限定次数报告 DestinationExistsError。', core+'project/copy.ts'],
 ['create-worktree', '创建 Git worktree', 'git_worktree strategy 发现源仓库，调用 Git.worktree.create，并返回规范化的新目录。', core+'project/copy-strategies.ts'],
 ['record-directory', '记录副本并通知更新', '登记新 directory 与 strategy，发布目录更新事件；refresh 可重新发现现存 worktree 并清除失效登记。', core+'project/copy.ts'],
])
flow('projects-and-changes', 'revert-session-changes', '按会话消息边界恢复变更', '从 assistant 快照生成回退计划，暂存文件和消息边界的回退；随后可以取消或确认。', 'SessionV2.revert.stage / clear / commit', 'http', [
 ['plan', '定位消息边界与受影响文件', '读取指定 message 的 seq，查找后续 assistant 消息的 snapshot.start 与文件列表，为每个文件保留首个恢复快照。', core+'session/revert.ts'],
 ['stage-files', '保留原状态并暂存文件恢复', '捕获当前或复用已有原始快照；除 files:false 外，按计划恢复文件并计算相对原状态的 diff。', core+'session/revert.ts'],
 ['publish-stage', '发布 Revert.Staged', '持久记录 messageID、原快照、patch 与文件变化；Session 投影据此展现待确认的回退边界。', core+'session/revert.ts'],
 ['resolve-stage', '取消或确认回退', 'clear 根据原始快照恢复文件并发布 Cleared；commit 发布 Committed，确认所选消息边界。两者是互斥后续选择。', core+'session/revert.ts'],
])
domain('models-and-integrations', '模型目录与供应商连接', '维护 Location 可用的供应商、模型和变体，并通过 integration 管理 API key、环境变量和 OAuth 连接。V2 runner 从该目录选择模型，构造当前已支持的协议 route。', ['Catalog', 'ProviderV2', 'ModelV2', 'Integration', 'Credential', 'SessionRunnerModel'], ['OAuth attempt 有独立生命周期，连接解析可刷新临近过期的 OAuth 凭据。', '显式选择不可用模型或变体必须报错，不能静默改用另一个选择。', 'V2 SessionRunnerModel 当前支持 AI SDK 元数据对应的 OpenAI Responses、Anthropic Messages 和带 URL 的 OpenAI-compatible Chat；不能将 llm 包全部供应商能力视为 V2 已接通。'], ['为会话执行提供带鉴权、模型参数和上下文限额的 route。', '可连接商业领域的 OpenCode 服务，也可独立连接其他供应商。'])
flow('models-and-integrations', 'connect-provider', '建立供应商连接', '让用户通过 API key 或 OAuth 连接 integration，并在以后请求中获得可用凭据。', 'Integration.connection.key / oauth；Integration.attempt.complete', 'http', [
 ['list-methods', '列出连接方式与现有连接', 'Integration.list / get 返回注册 methods，并组合已存 Credential 与可用环境变量连接。', core+'integration.ts'],
 ['authorize', '执行 key 或 OAuth 连接', 'key method 验证用户输入后保存凭据；OAuth method 发起授权并创建可查询、完成或取消的 attempt。', core+'integration.ts'],
 ['persist', '完成授权并通知目录', 'OAuth attempt 成功后写入 Credential；连接创建、更新或移除发布 ConnectionUpdated，驱动可用目录变化。', core+'integration.ts'],
 ['resolve', '解析当前可用凭据', 'active 选择当前连接；resolve 读取 key、环境值或 OAuth token，支持在临近过期时刷新并保存。', core+'integration.ts'],
])
flow('models-and-integrations', 'resolve-provider-model', '解析本轮模型与协议', '根据 Session 选择和 Location 目录取得可执行模型，并附加变体、连接和供应商请求设置。', 'SessionRunnerModel.resolve(session)', 'event', [
 ['select', '选择显式或默认模型', '显式 Session model 在 available 目录中查找；未显式选择时优先使用受支持的默认模型，再选择受支持的可用模型。', core+'session/runner/model.ts'],
 ['connect', '取得供应商活动连接', '按 provider.integrationID 或 provider ID 查找 active connection，再解析 Credential；缺失或不支持的模型产生明确错误。', core+'session/runner/model.ts'],
 ['apply-variant', '应用变体与请求默认值', '验证 variant ID，合并 headers / body，附上 baseURL、上下文与输出限制，并避免把 apiKey 留在普通 HTTP body。', core+'session/runner/model.ts'],
 ['build-route', '构造受支持的协议 route', '根据 api.package 映射到 Responses、Messages 或 compatible Chat，设置 bearer 或 x-api-key 认证并返回 executable model。', core+'session/runner/model.ts'],
])
domain('hosted-service-commerce', '托管模型服务与商业计费', 'Console 管理账户下的组织空间、API key、余额和订阅用量，Zen / Go 接口提供托管推理入口。当前实现同时包含 legacy 推理计费和已迁移 workspace / 新 key 的远端转发路径。', ['Console Workspace', 'Account', 'User', 'Key', 'Billing', 'Usage', 'Lite', 'Stripe', 'ConsoleMigration'], ['Console Workspace 是商业租户，不等同于本地 Location.workspaceID。', '新 oc_sk_ key 与迁移 workspace 请求交由新推理服务鉴权和计费，不先执行 legacy 余额校验。', 'legacy 路径按匿名、免费、BYOK、订阅或余额等来源处理费用，并实施模型、地区和用量限制。', 'Stripe webhook 验证签名及 workspace/customer 信息后更新付款与余额；Black 属于保留的历史订阅逻辑，不可将其视为正常续订新品。'], ['模型连接领域可将 OpenCode 托管服务作为供应商。', '会话请求间接消费托管推理，但本地会话持久化与商业账务归属不同边界。'])
flow('hosted-service-commerce', 'create-console-workspace', '创建商业工作空间与 API key', '为活跃账户创建 Console 租户、管理员和初始账单，再生成默认 API key。', 'Workspace.create({ name })', 'manual', [
 ['verify-account', '确认账户仍然活跃', 'Actor.assert(account) 提供当前账户身份，事务读取 AccountTable 并拒绝已删除账户。', consoleCore+'workspace.ts'],
 ['create-tenant', '建立 workspace 与管理员', '同一事务插入 WorkspaceTable 与 UserTable，将创建者设为该 workspace 的 admin。', consoleCore+'workspace.ts'],
 ['initialize-billing', '初始化零余额账单', '为 workspace 插入 BillingTable，初始 balance 为零，等待充值或订阅。', consoleCore+'workspace.ts'],
 ['issue-key', '创建默认 API key', '以该 workspace 的 system Actor 调用 Key.create；key 关联 workspace 与 user。列出 key 时其他用户的完整值不会返回。', consoleCore+'key.ts'],
])
flow('hosted-service-commerce', 'serve-hosted-inference', '路由并计量 Zen / Go 推理', '托管接口先判断迁移边界；迁移请求直接转发，未迁移请求继续走本仓库的模型检查、供应商路由和计费。后续 legacy 步骤仅适用于未转发分支。', 'POST /zen/v1/chat/completions、/zen/v1/responses、/zen/v1/messages 及 Go 对应接口', 'http', [
 ['parse', '提取模型与请求流', 'handler 准备可重放的请求 body，解析模型、API key 与请求格式，为迁移分流和后续 streaming 保留 body。', consoleApp+'routes/zen/util/handler.ts'],
 ['migration-route', '识别迁移流量并转发', 'proxyInference 将新 oc_sk_ key 或已迁移 workspace 路由到 ConsoleMigration.inferenceUrl；BYOK 使用工作空间/供应商连接 ID 与原生模型映射。成功转发即返回，由目标服务负责认证和计费。', consoleApp+'lib/inference-proxy.ts'],
 ['validate-legacy', '验证 legacy 模型与消费资格', '未迁移分支验证模型、地区、速率、key、训练授权与订阅/余额；超出配额或消费上限时返回对应错误。', consoleApp+'routes/zen/util/handler.ts'],
 ['select-provider', '选择 legacy 上游', '结合 trial、sticky provider、TPM/TPS 限制和预算选择可用供应商，设置 BYOK 或平台凭据并保留对应协议格式。', consoleApp+'routes/zen/util/handler.ts'],
 ['stream-response', '转发请求并解析 usage', '发送上游请求并流式返回内容，利用 provider adapter 抽取 token 与缓存等 usage 信息以计算费用。', consoleApp+'routes/zen/util/handler.ts'],
 ['account', '记录 legacy 消费与余额', 'trackUsage 写入 Usage 并更新订阅窗口或余额/月用量，部分高频 workspace 经 Redis 合并；余额模式符合条件时尝试自动充值。', consoleApp+'routes/zen/util/handler.ts'],
])
flow('hosted-service-commerce', 'fund-console-billing', '充值并同步 Stripe 付款结果', '创建充值 Checkout，接收经签名验证的付款通知并更新余额及支付记录；余额消费后可触发自动补充。', 'Billing.generateCheckoutUrl；POST /stripe/webhook', 'http', [
 ['checkout', '创建充值 Checkout', '根据输入金额或 reloadAmount 计算充值金额和处理费，创建带 workspace 元信息的 Stripe payment Checkout。', consoleCore+'billing.ts'],
 ['verify-webhook', '验证 Stripe 通知', 'webhooks.constructEventAsync 校验原始 body 与 stripe-signature；处理 checkout.session.completed 时核对 workspace、customer、payment 与 invoice 信息。', consoleApp+'routes/stripe/webhook.ts'],
 ['credit', '入账并保存支付方式', '在事务内增加 Billing.balance，更新 customer 与 payment method，再插入 PaymentTable 付款记录。', consoleApp+'routes/stripe/webhook.ts'],
 ['reload', '按配置自动补充余额', '消费路径检查 reload 开关、阈值与锁定窗口后调用 Billing.reload 创建并支付 invoice；失败时记录 reloadError 并关闭自动充值。', consoleCore+'billing.ts'],
])
domain('session-sharing', '会话发布与分享', '把 legacy 会话的消息、parts、模型信息和 diff 发布为可阅读的分享快照。分享 ID 用于访问，secret 用于同步与删除；此链路仍属于 legacy SessionShare / ShareNext 与 enterprise 服务。', ['SessionShare', 'ShareNext', 'Share.Info', 'Share.Data', 'share_snapshot'], ['配置 share:disabled 禁止分享；自动分享只针对适用的顶层会话。', '同步与删除必须匹配 share secret；共享读取使用 share ID。', 'ShareNext 订阅 legacy 消息事件；当前 V2 server.session 不能被假定已经具有等价分享 API。'], ['消费 legacy 会话消息、模型资料和变更 diff。', 'enterprise 服务保存并提供可公开读取的分享快照。'])
flow('session-sharing', 'publish-session-share', '发布并持续同步会话', '创建分享身份，发送现有历史，并将后续 legacy 会话变更合并进服务端快照。', 'SessionShare.share(sessionID)；POST /api/share', 'manual', [
 ['check-config', '检查分享配置', 'SessionShare.share 读取配置，disabled 时拒绝；允许时调用 ShareNext.create，随后把分享 URL 写入本地 Session。', 'packages/opencode/src/share/session.ts'],
 ['create-identity', '建立分享 ID 与 secret', 'enterprise Share.create 从 Session ID 派生短 share ID，创建随机 secret 并初始化快照；既有 ID 会报告 AlreadyExists。', 'packages/enterprise/src/core/share.ts'],
 ['sync-history', '发送历史并订阅后续事件', 'ShareNext 保存返回的分享身份，full sync 发送已有数据，监听 session、message、part、diff 更新并排队发送。', 'packages/opencode/src/share/share-next.ts'],
 ['merge-snapshot', '验证 secret 并合并快照', 'Share.sync 校验身份，以 session / message / part 等稳定键合并最新数据，Share.data 提供快照读取并兼容旧存储。', 'packages/enterprise/src/core/share.ts'],
])
flow('session-sharing', 'revoke-session-share', '撤销已发布的分享', '删除服务端分享及快照，并清除本地分享状态。', 'SessionShare.unshare(sessionID)；DELETE /api/share/:shareID', 'manual', [
 ['request-delete', '使用保存的 secret 请求删除', 'ShareNext.remove 查找本地分享记录，向远端 share endpoint 发送带 secret 的 DELETE。', 'packages/opencode/src/share/share-next.ts'],
 ['remove-storage', '删除分享身份及关联数据', 'Share.remove 检查 secret，移除 share 记录以及 snapshot、compaction、event 和旧 data 存储。', 'packages/enterprise/src/core/share.ts'],
 ['clear-local', '清除本地 Session 分享状态', '远端删除完成后，SessionShare.unshare 将本地 share 信息设为空。', 'packages/opencode/src/share/session.ts'],
])
for (const [source, target, description] of [
 ['agent-sessions', 'models-and-integrations', '每轮执行从当前 Location 目录解析所选模型、变体与供应商连接。'],
 ['agent-sessions', 'tools-and-approvals', '本地 tool-call 经 canonical registry、叶子授权和输出结算后回写持久会话。'],
 ['agent-sessions', 'projects-and-changes', '会话绑定项目 Location，runner 使用该位置服务和快照；回退依赖消息边界。'],
 ['tools-and-approvals', 'projects-and-changes', '文件路径、副作用和已记住的授权分别受 Location 与 Project 约束。'],
 ['models-and-integrations', 'hosted-service-commerce', 'OpenCode 供应商连接可以消费 Zen / Go 的托管推理接口，其他供应商连接独立存在。'],
 ['agent-sessions', 'session-sharing', 'legacy SessionShare / ShareNext 发布会话事件与 diff；不表示 V2 运行链路已具备分享接口。'],
]) graph.edges.push({ source: `domain:${source}`, target: `domain:${target}`, type: 'cross_domain', direction: 'forward', description, weight: 0.6 })
const ids = new Set(graph.nodes.map(n => n.id))
if (ids.size !== graph.nodes.length) throw Error('Duplicate IDs')
for (const edge of graph.edges) if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target || edge.weight < 0 || edge.weight > 1) throw Error('Invalid edge')
fs.writeFileSync('.understand-anything/intermediate/domain-analysis.json', JSON.stringify(graph, null, 2) + '\n')
console.log(JSON.stringify({ domains: graph.nodes.filter(n => n.type === 'domain').length, flows: graph.nodes.filter(n => n.type === 'flow').length, steps: graph.nodes.filter(n => n.type === 'step').length }))
