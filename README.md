# claude-knowledge-plugin

Claude Code plugin：项目知识库机制（wiki）——让「记录知识」成为 AI 工作流的一部分，而不是另一个没人维护的文档目录。

知识正本放在各项目的 repo 里（git 追踪、可 review、可回溯），本 plugin 只提供机制：开场把索引注入 context、commit 后强制评估本轮有没有值得记的知识、结构 lint 稽核、写入须经人批准。一份 plugin 可服务多个项目，各项目用自己的 `.claude/wiki.config.json` 指定知识库位置。知识页格式为 markdown＋YAML frontmatter（Google [OKF v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog) 子集）。

## 它给你什么

- **开场即知**：`SessionStart` hook 把知识库的主题索引摘要（含关键字、查找步骤、写入政策）注入每个新对话，agent 不用被提醒就知道去哪查。
- **commit 闸门**：`PostToolUse` hook 侦测真实执行过的 `git commit`，`Stop` hook 在收尾时强制 agent 评估「本轮有没有值得记的知识」——回复必须带 `Wiki 建议:` 提案或 `无需 wiki 更新: <理由>` 标记，否则挡下重答（防漏记，也防敷衍：只在真的 commit 过才触发）。
- **写入审批**：预设 `require_approval`——agent 只能提案，人批准了才动笔。未经 review 的 AI 记忆只是把错误存得更自信而已。
- **结构 lint**：frontmatter 完整性、两层索引页数一致、无孤儿页/断链/过期页，SessionStart 自动跑、也可手动跑。
- **memory 闸门**：`PreToolUse` hook 拦截写入 Claude 内建 memory 的行为，强制知识只有一份正本（在 repo 里，而不是散在个人机器的 memory 中）。
- **两层索引**：`index.md` 只列主题（含关键字供语义匹配），`index-<slug>.md` 才列该主题的页清单——索引常驻 context 的成本固定，不随知识库长大而膨胀。
- **`/wiki:review` skill**：手动盘点本轮对话，产出「Wiki 建议」提案清单。
- **搜索脚本**：tag 与全文搜索知识页，agent 与人都能用。

## 为什么不直接用 Claude 内建 memory

Claude Code 内建 memory（`~/.claude/projects/<项目>/memory/`）能记事，但拿来当项目知识库会越用越乱：四类记忆混在一个目录靠命名自律、索引每次开场全量载入、只存在自己机器上、agent 想写就写没人把关。本 plugin 用 `PreToolUse` 闸门把它关掉（只留与用户合作规则的 feedback 类），把「记忆」搬回 repo：

| | 内建 memory | 本 plugin 知识库 |
|---|---|---|
| 存在哪 | 个人机器的 `~/.claude/…`，不进 git，换机器就没了 | 项目 repo（`docs/knowledge/`），clone 即得 |
| 谁看得到 | 只有自己 | 全团队；PR 可 review、`git log` 可回溯 |
| 谁能写 | agent 自主写，没人把关 | 预设 `require_approval`，每一条都经人批准 |
| 开场 token 成本 | `MEMORY.md` 索引每次全量载入，随条目数线性膨胀 | 只注入主题层摘要（几行），页面用到才读，成本固定 |
| 结构 | user/feedback/project/reference 四类混放，靠命名自律 | 两层索引＋OKF frontmatter（type/tags/sources/verified），lint 机械稽核 |
| 时效 | 没有过期概念，旧记忆永远载入 | `stale_after`＋`status: deprecated`，lint 到期警告 |
| 进度类内容 | 和知识混在一起，任务结束也留着 | 分到 `.claude/state/`，任务完结即删 |
| 搜索 | 靠 agent 自己翻 | tag／全文搜索脚本，人与 agent 共用 |

其他刻意的取舍：

- **闸门跨项目生效**：从 A 项目的对话写 B 项目的 memory 同样会被挡——知识只有一份正本，没有例外。
- **fail-soft**：任何 hook 出错都静默放行（输出 `{}`），config 缺失时全部回落预设值——plugin 自己坏了也不会挡住你的 session。
- **秘密值永不落地**：凭证、token、内部 URL、连线字串一律只写路径或占位符，是写入判准的硬规则，优先于其他一切。
- **提案先讲人话**：预设 `proposalStyle: plain`，每条「Wiki 建议」先给一句白话（这是什么、为何值得记、不记会怎样）——非该领域专家、或在手机上批提案也能判断。
- **零依赖、零服务**：纯 Node 脚本，没有第三方套件、向量库、后台服务；一份 plugin 服务多个项目，各项目只多一个 `wiki.config.json`。

## 运作流程

1. 开新对话 → 主题索引摘要自动进 context。
2. agent 动工前按关键字命中主题 → 读该主题子索引与相关页，带着既有知识开工。
3. 工作中发现值得记的知识 → 以「Wiki 建议」格式提案（目标页、要记什么、来源）。
4. 执行过 `git commit` → 收尾时 Stop 闸门强制评估：提案，或明确说明为何无需更新。
5. 用户批准 → agent 写入知识页并同步两层索引；lint 兜底抓漏。
6. 页面历史交给 git（`git log <page>.md`），不维护变更日志档。

## 目录结构

```
claude-knowledge-plugin/
├── .claude-plugin/marketplace.json      # 本机 marketplace 定义
├── update.js                            # 一键发布脚本（见「更新」）
├── templates/                           # 新项目接线骨架：镜像项目根目录，整包复制即用
│   ├── CLAUDE-section.md                #   给 AI 的常驻规则段 → 并入专案 CLAUDE.md 后删除
│   ├── .claude/
│   │   ├── wiki.config.json             #   plugin 的项目侧设定
│   │   └── state/_onboarding-demo.md    #   进度目录示例（AI 读完无进度可接手，即会删除）
│   └── docs/
│       ├── knowledge/                   #   知识库：index.md 主题表（预置 4 个通用主题）＋4 个子索引
│       └── wip/_about-wip.md            #   草稿区惯例说明（可留可删）
└── plugins/wiki/
    ├── .claude-plugin/plugin.json       # plugin manifest（name: wiki, version）
    ├── hooks/hooks.json                 # 4 个 hook 的注册
    ├── scripts/                         # Node 脚本（无第三方依赖）
    │   ├── wiki-lib.js                  #   共用库：读 config / 解析 frontmatter 与索引表
    │   ├── wiki-session-start.js        #   SessionStart：注入主题索引摘要＋进度目录＋lint 警告
    │   ├── wiki-stop.js                 #   commit 闸门：侦测 git commit → Stop 时要求评估标记
    │   ├── wiki-memory-gate.js          #   PreToolUse：拦截写入 Claude memory（memory 已停用）
    │   ├── wiki-lint.js                 #   结构稽核（frontmatter/两层索引一致/断链/过期）
    │   └── wiki-search.js               #   知识页搜索（-t tag 或全文）
    └── skills/review/
        ├── SKILL.md                     # /wiki:review 盘点流程
        └── reference.md                 # 📖 手册正本：写什么/格式/写入政策/索引维护/新项目接线
```

## 安装

前提：Claude Code CLI 已安装。

```bash
# 1. 取得本 repo（clone 或复制到本机任意位置）
git clone <repo-url> <本机路径>/claude-knowledge-plugin

# 2. 注册为本机 marketplace（写入 ~/.claude/settings.json，一台机器做一次）
claude plugin marketplace add <本机路径>/claude-knowledge-plugin

# 3. 在目标项目根目录下安装（--scope local：写入该项目
#    .claude/settings.local.json，不进 git，每人自装）
claude plugin install wiki@claude-knowledge-plugin --scope local
```

> 安装只做一次，之后每次启动自动载入。本质是「复制一份到版本化快取」（`~/.claude/plugins/cache/claude-knowledge-plugin/wiki/<version>/`）——**改本 repo 原始档或 pull 到新版都不会自动生效**，要走下方更新流程。

## 项目接线（每个新项目一次）

完整步骤见手册 `plugins/wiki/skills/review/reference.md` §九，摘要：

1. 把 `templates/` 底下的内容整包复制到项目根目录（`.claude/` 与 `docs/` 就位）——**复制即用，不需要改任何内容**（知识库预置 4 个通用主题，之后按专案需要改名/增删；state 与 wip 各带一个示例/说明档）。
2. 把 `CLAUDE-section.md` 的段落并入专案 CLAUDE.md 后删除该档——这是给 AI 的**常驻**规则（知识库/进度/草稿各放哪、规则手册在哪）；templates 的示例档读完会删，常驻规则必须住在 CLAUDE.md。
3. `.gitignore` 加 `.claude/state/` 与 `docs/wip/`。
4. 重启 session → 开场看到「主题索引」注入即生效。

### wiki.config.json 字段说明

| 字段 | 作用 | 预设 |
|---|---|---|
| `knowledgeRoot` | 知识库根目录（index.md 所在处；SessionStart 注入、lint、search 都以此为根）。建议用专属子目录，与非知识文件物理分开 | `docs` |
| `stateDir` | 任务进度/待办目录（不进 git、任务完结即删；SessionStart 会注入其档案清单摘要） | `.claude/state` |
| `excludeFromLint` | lint 跳过的路径前缀（相对 `knowledgeRoot`）。知识库独占一个目录时留空即可 | `[]` |
| `writePolicy` | 知识写入政策。目前实作 `require_approval`（所有写入先提案、经用户同意才动笔） | `require_approval` |
| `proposalStyle` | 提案措辞风格。`plain`＝每条「Wiki 建议」先给一句白话（这是什么、为何值得记、不记会怎样），方便非该领域专家或在手机上的用户判断；`terse`＝只给术语/精简（专家想关掉白话时用） | `plain` |

档案缺失或解析失败时全部字段回落预设值（fail-safe，不会挡 session）。

## 日常使用

| 时机 | 会发生什么 |
|---|---|
| 每次新对话开场 | 自动注入：主题索引摘要＋进行中任务目录＋lint 警告（若有） |
| 执行过 `git commit` 后 | Stop 闸门要求本轮回复附评估标记（`Wiki 建议: …` 提案，或 `无需 wiki 更新: <理由>`） |
| 手动 `/wiki:review` | 盘点本轮对话有没有值得记的知识，输出提案清单 |
| 任何写入 Claude memory 的尝试 | PreToolUse 直接 deny 并指引改写到知识库/state |
| 手动稽核 | `node plugins/wiki/scripts/wiki-lint.js`（SessionStart 也会自动跑） |
| 找知识 | `node plugins/wiki/scripts/wiki-search.js "<关键字>"`（`-t <tag>` 按标签） |

## 什么值得记

一句话判准：**代码能告诉你的，不要写**——知识库的价值在代码说不出的东西：设计的「为什么」、跨档且无编译期信号的隐性耦合、会被反复踩的坑根因。宁少而准，一条有凭有据胜过五条空泛。

**记录前先分辨个案还是架构**：换一个项目/场景这条还成立吗？成立（通用不变量）才记，抽到不变量那层再写；只对当前个案成立、改完就不再犯的（某款某处摆错），沉降到该对象自己的文档、不占知识库。心智模型：「武器一律用手拿」是不变量（记），「拿剑闪红光」是个案配置（不记）。

完整判准、个案/架构过滤与页格式规格见手册 `plugins/wiki/skills/review/reference.md` §二、§三。

## 更新（pull 到新版或改了 plugin 内容之后）

一键脚本（自动 bump patch 版本＋刷新 marketplace＋逐项目 update）：

```bash
node update.js   # 要更新的项目列表写在 projects.local.txt（一行一个，不进 git）
```

等效的手动步骤：

```bash
# 1. bump plugins/wiki/.claude-plugin/plugin.json 的 version
# 2. 刷新 marketplace 元数据
claude plugin marketplace update claude-knowledge-plugin
# 3. 在目标项目下更新（装在 local scope 就必带 --scope local，
#    否则报 "not installed at scope user"）
claude plugin update wiki@claude-knowledge-plugin --scope local
# 4. 重启 session 或 /reload-plugins
```

开发期密集迭代可改用 `claude --plugin-dir <本 repo>/plugins/wiki` 直读原位，免 bump 免 update。

## 验证

```bash
claude plugin validate <本机路径>/claude-knowledge-plugin              # marketplace
claude plugin validate <本机路径>/claude-knowledge-plugin/plugins/wiki # plugin
```

## 设计笔记

刻意只用 markdown、git、hooks 三样朴素的东西：没有向量库、没有仪表板、没有「agent 记忆平台」。知识正本躺在 repo 里，能 diff、能 review、能 `git log`——朴素的版本够用之前，不引入更重的东西。

机制上的关键取舍：

- **闸门在工具层，不在嘴上**。commit 侦测看的是真实执行过的命令，评估标记由 Stop hook 机械检查——靠提示词自觉的规则，忙起来第一个被牺牲。
- **索引常驻、内容按需**。context 里只放主题层摘要，知识页在用到时才读，知识库长到几十页也不吃 context 预算。
- **人是最后一道闸**。`require_approval` 下 agent 永远只能提案；知识库的可信度来自每一条都被人看过。

## License

MIT
