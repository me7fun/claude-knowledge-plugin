# 知识库运作手册（wiki plugin 正本）

> 这份是**机制手册**（B 类，随 plugin 走、专案无关）。
> 专案特定的东西——type 清单的实际用法示例、主题分类、各主题涵盖范围——写在
> 各专案知识库根的 `index.md` 说明段，不在这份。
>
> 机制来源：llm-project-wiki（github.com/k79k06k02k/llm-project-wiki，MIT）的机制
> ＋ Google OKF v0.2（GoogleCloudPlatform/knowledge-catalog）的格式。

---

## 一、设计原则：一份正本＋其他当入口

同一件知识只有一份正本，放在专案的知识库（git 追踪、同事看得到、有历史）。
其他地方（CLAUDE.md、skill、memory）只放**指标**，不放内容——内容复制两份，
必有一份烂掉没人发现。

| 东西 | 家 |
|---|---|
| 专案知识（坑、流程、决策、参考） | 知识库（`wiki.config.json` 的 `knowledgeRoot`，预设 `docs/`） |
| 任务进度/待办（任务完结即过期） | state 目录（`stateDir`，预设 `.claude/state/`，不进 git、不长期保留） |
| 与用户的合作规则（feedback 类） | Claude memory（仅此一类；其余 memory 停用，PreToolUse 闸门会挡） |
| 机制规则（本手册） | plugin 内，随 plugin 版本走 |

## 二、页格式（OKF 子集）

每个知识页开头带 YAML frontmatter。**`type` 是唯一必填**（OKF 一致性要求），
其余按需：

```yaml
---
type: Pitfall            # 必填。此页是什么种类（种类清单见专案 index.md）
title: 页标题
description: 一句话摘要（子索引与搜索用）
tags: [cocos, ext-module]   # 主题标签；个案条目额外标游戏代号（如 bscq）
status: stable           # draft / stable / deprecated，预设 stable
stale_after: 2026-12-31  # 选填。过期日——lint 到期会警告；进度类、时效类才需要
sources:
  - .claude/errors.md    # 这条知识从哪来（档案、对话、实测）
verified:                # 选填。谁验证过——只记真实发生的验证事件，不自评
  - by: human:mickey
    at: 2026-08-19
---
```

- `type` 与 `tags` 是**两个轴**：type 回答「这是什么种类的文件」（Pitfall/Guide/
  Reference/Decision…），tags 回答「关于什么主题」。不可混用。
- `verified` 与「自评信心」不同：只记真实验证事件（谁、何时）。没验过就不写，
  宁缺勿假。`human:` 前缀 = 人验过（最高信任层）。
- 连结用标准 markdown 连结。跨页连结建议用 bundle 绝对路径（`/xxx.md`，
  相对知识库根），搬目录不易断。

## 三、写什么／不写什么

**安全红线（硬规则，优先于以下一切）**：任何从代码、log、环境变数、设定档、
指令输出读到的秘密值——凭证、token、API key、私钥、内部 URL/IP、个资、DB 连线
字串——**永不写进知识库**。要引用时只写档案路径或占位符，绝不重现值本身。

**代码能告诉你的，不要写。** 知识库的价值在代码说不出的东西；复述代码只会随
时间漂移成骗人的文件。

- 读单一档就能知道的（方法做什么、栏位存在、流程步骤）→ 不写
- 能直接从代码推导的结构（类关系、呼叫链、prefab 阶层）→ 不写
- `git log` 能回答的（何时改、谁改、改了什么）→ 不写

**测试**：「读代码找得到这个吗？」找得到 → 不写。只写代码**说不出**的：
**为什么**这样设计、跨多档且无编译期讯号的隐性耦合、会被反复踩的坑。

**主述句写成通用陈述**：「所有呼到 X 的代码都会 Y」，不写「A 游戏跟 B 游戏会 Y」
——case 列表在新对话 fresh 读时会被误判成个案而跳过套用。

**🔴 先分辨「个案」还是「架构」——记错层级 = 记了没用的东西。** 提案前先问：
「换一个专案/游戏，这条还成立吗？」
- **成立（架构/通用不变量）→ 记**：抽到不变量那一层再写。
  心智模型：**「武器一律用手拿」是不变量（值得记）；「拿剑闪红光、拿刀闪蓝光」是个案配置（不值得记）。**
  例：「凡 template 复制来的 `languageConfigs` 都是空壳、不填会把 base 图洗成 null」——换任何款都成立 → 记。
- **不成立（个案，改完就不再犯、别款用不到）→ 不进知识库**：
  例：「bjntt 的 X 面板摆错位置」「dscj 某音效切错时间点」——这类是该款自己的 bug，
  修完就没了，沉降到**该游戏的 `games/slot-fe-<代号>/CLAUDE.md`**（游戏层），不占知识库。
- **判据**：一个个案背后往往藏着一条架构规则——**记那条规则，个案只当它的证据放括号里**。
  若你只能写出个案、抽不出背后的通用规则，那多半就是不值得进知识库的东西。

即使知识跨多档，若「一句话＋几个档名指标」就够（细节读代码更准），就只写那
一句指标。**少而准**：一条真正挖不出来的坑，胜过一页代码本可告诉你的解释。

## 四、写入政策

政策在专案 `wiki.config.json` 的 `writePolicy`，SessionStart 注入当前值：

- **`require_approval`（预设）**：先提案（「Wiki 建议」格式：目标页、要记什么、
  来源），等用户明确同意才写。缺档、坏档、非法值一律视为 require_approval
  （fail-closed）。
- **`open`**：可直接写，仍须同步维护索引并输出评估标记。

## 五、评估标记（commit 闸门）

本 plugin 在 PostToolUse 监看 Bash/PowerShell：真的执行了 `git commit` 才立旗标；
Stop 时若旗标在而最终回复无标记 → 挡下要求评估（一轮最多挡 2 次，防循环）。

接受的标记（独立成行、code fence 外）：

- `Wiki 建议` / `Wiki suggestion`（可带冒号接内容）—— 有东西要提案
- `无需 wiki 更新` / `無需 wiki 更新` / `No wiki updates needed` —— 评估过、没东西

commit 频率低的专案（如「未明说不 commit」纪律），闸门覆盖不到的场合靠手动
`/wiki:review` 补——纯调查、纯讨论、方案对齐这类不 commit 的工作也会产知识。

## 六、索引维护（两层索引）

```text
<knowledgeRoot>/
├── index.md              # 顶层：一主题一列（主题｜页数｜子索引连结｜关键字）
├── index-<slug>.md       # 每主题一份：该主题完整页清单
└── <page>.md             # 知识页（可有子目录）
```

- 顶层只列主题；SessionStart 只注入这层摘要，细节 lazy-load。
- 关键字栏是给语义匹配用的（用户说「bug」要能落到踩坑主题）——加主题时必填，
  不可含 `|`（会拆坏表格）。
- 子索引条目格式：`- [页名](/路径.md) — 一句话说明`，按字母序。
- 无变更日志档——历史是 git 的事（`git log <page>.md`）。

### 情境 1：新增页

0. 先查重：跑 wiki-search 与相关 `index-<slug>.md`，已有页涵盖 → 扩写该页
   （加节、更新 frontmatter），不开新页。
1. 决定所属主题；没有合适主题 → 先走情境 2。
2. 建档，frontmatter 至少含 `type`（建议补 title/description/tags/sources）。
3. 在 `index-<slug>.md` 按字母序插一行。
4. `index.md` 该主题页数 +1。

### 情境 2：新增主题

1. 定主题名与 kebab-case slug；定 6–10 个关键字。
2. 建 `index-<slug>.md`（标题＋空清单）。
3. `index.md` 加一列：`| <主题> | 0 | [index-<slug>.md](index-<slug>.md) | <关键字> |`。
4. 接着走情境 1 加第一页。

### 情境 3：删除页

1. 删档。
2. 从 `index-<slug>.md` 移除该行。
3. `index.md` 页数 -1。
4. 页数归零时，问用户是否连子索引一起删——不自动删。

### 情境 4：页换主题

1. 旧 `index-<slug>.md` 移除、新 `index-<slug>.md` 加入。
2. `index.md` 两边页数各自增减。

## 七、结构 lint

`scripts/wiki-lint.js` 是确定性检查器，SessionStart 自动跑（fail-soft，坏了不挡
开场），也可手动：`node "${CLAUDE_PLUGIN_ROOT}/scripts/wiki-lint.js" [专案根]`。

检查：① 每页 frontmatter 可解析且 `type` 非空 ② `status` 合法 ③ `stale_after`
过期警告 ④ index 页数与子索引条目数一致 ⑤ 索引指到的档存在、无孤儿页、无跨主题
重复 ⑥ 页内 .md 连结不断链 ⑦ memory 不再长出 feedback 以外的档。

注意：OKF 规定消费端**不得**因断链拒收 bundle——lint 是自家维护工具，输出的是
「要修」清单，不是一致性否决。

## 八、搜索

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/wiki-search.js" "<关键字>"       # 全文
node "${CLAUDE_PLUGIN_ROOT}/scripts/wiki-search.js" -t <tag>          # tag 过滤
node "${CLAUDE_PLUGIN_ROOT}/scripts/wiki-search.js" -t <tag> "<关键字>"
```

永远排除 index*.md 与设定档 `excludeFromLint` 清单。最后手段用
`rg "<关键字>" <knowledgeRoot>/ -g '!index*.md'`。

## 九、专案接线（新专案启用步骤）

> 最快路径：把 plugin repo `templates/` 的内容整包复制到专案根目录（即完成下列 1–3
> 的档案部分），再做 4–6。

1. 专案根建 `.claude/wiki.config.json`：

   ```json
   {
     "knowledgeRoot": "docs/knowledge",
     "stateDir": ".claude/state",
     "excludeFromLint": [],
     "writePolicy": "require_approval"
   }
   ```

   > 建议给知识库一个专属子目录（如 `docs/knowledge/`），与目录查表、草稿等
   > 非知识文件物理分开——这样 `excludeFromLint` 可以留空，lint 范围即整棵目录。

2. 建 `<knowledgeRoot>/index.md`（主题表，可从 0 主题开始）。
3. 把 templates 的 `CLAUDE-section.md` 段落**连同 `<!-- wiki-plugin:start/end -->` 标记**并入专案 CLAUDE.md（给 AI 的常驻规则：
   知识库/进度/草稿各放哪、手册在哪——templates 示例档会删，常驻规则必须住在 CLAUDE.md）。
4. `.gitignore` 加 state 目录（与草稿区 `docs/wip/`，若采用该惯例——wip 属专案层
   惯例而非 plugin 机制，见 templates 内说明档）。
5. 注册 marketplace 并安装（个人 scope 用 `--scope local`，写进
   `settings.local.json` 不进 git）：

   ```bash
   claude plugin marketplace add <claude-knowledge-plugin 路径或 repo>
   claude plugin install wiki@claude-knowledge-plugin --scope local
   ```

6. 重启 session（或 `/reload-plugins`）→ 开场应看到主题索引注入。

> **私有接线**（知识只给自己看、不进 repo）：步骤 3 改并入 `CLAUDE.local.md`，步骤 4 改写
> `.git/info/exclude`（连同 `CLAUDE.local.md`、`.claude/wiki.config.json`、`docs/knowledge/`）。
> 判准：wiki 知识要不要给 clone 这个 repo 的人看？要 → CLAUDE.md；不要 → CLAUDE.local.md。

**移除（反接线）**：`node <plugin>/scripts/wiki-uninstall.js` 预览（dry-run）→ 确认后加 `--yes`
→ `claude plugin uninstall wiki@claude-knowledge-plugin --scope local`。脚本只清 plugin 放进去的
设定（config、CLAUDE.md 段、.gitignore 行、templates 示例档、空索引），知识页与使用者自己的
state/wip 档一律不碰。

## 十、派工时的知识传递（subagent / teammate）

各机制对派出的 agent 的作用范围不同：

- **SessionStart 注入只发生在主 session**——agent 是另起的 context，拿不到主题索引，
  也不会主动查知识库；专案 CLAUDE.md 的入口只是后备线索，不能指望 agent 自己循线。
- **机械闸门对 agent 仍有效**：PreToolUse / PostToolUse 拦的是工具执行层，agent 的
  Write/Edit 与 git commit 一样被拦截/侦测；Stop 闸门拦的是主回路——agent 跑过
  commit，**收尾评估的责任落在派工者身上**。

**规则：派工 brief 固定附一句——**

> 「动工前先读 `<knowledgeRoot>/index.md`（主题目录），按你的任务用关键字找到对应主题，
> 再读该主题的 `index-<slug>.md` 与相关页。」

派工者已知高相关页可**额外点名**（省 agent 找的时间，选配）；但**目录必读是保底**——
只指定单页依赖派工者猜对主题，跨主题问题（表面在 A 层、根因在 B 层）会漏。
