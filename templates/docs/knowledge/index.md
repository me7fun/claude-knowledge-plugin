# 知识库索引

本目录是专案知识库（OKF 格式：markdown + frontmatter）。两层索引：**本档只列主题**；查某主题下有哪些页，读对应的 `index-<slug>.md`。

维护规则、frontmatter 规格、写入政策见 wiki plugin 手册（`plugins/wiki/skills/review/reference.md`）；页面历史用 `git log` 查，无变更日志档。

## type 分类（每页 frontmatter 的 `type` 字段）

`type` 回答「这是什么**种类**的文件」；`tags` 回答「关于什么**主题**」——两个轴不可混用。

| type | 主述长什么样 | 例 |
|---|---|---|
| `Pitfall` | 「做 X 会踩到 Y」 | 坑与根因 |
| `Guide` | 「怎么做 X」步骤式 | SOP、流程 |
| `Reference` | 「X 是怎么运作的 / 在哪里」 | 系统说明、工具位置 |
| `Decision` | 「为什么这样做、为什么不用 Y」 | 设计决策纪录 |

## 主题

<!-- 预置 4 个通用主题，可直接开工；按专案需要改名/增删（步骤见手册 §六）。 -->

| 主题 | 页数 | 子索引 | 关键字 |
|---|---|---|---|
| 架构 | 0 | [index-architecture.md](index-architecture.md) | 架构, architecture, 分层, 模块, 依赖, 初始化, 启动 |
| 对接与整合 | 0 | [index-integrations.md](index-integrations.md) | api, server, 对接, 第三方, sdk, 协议, 栏位 |
| 坑与排错 | 0 | [index-pitfalls.md](index-pitfalls.md) | 坑, pitfall, bug, 根因, 排错, debug, 陷阱 |
| 决策 | 0 | [index-decisions.md](index-decisions.md) | 决策, decision, 为什么, 取舍, 方案, 弃用 |
