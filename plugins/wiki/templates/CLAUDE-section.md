# 知识体系入口段（wiki-setup.js 的复制来源；手动接线时并入 CLAUDE.md 或 CLAUDE.local.md 后删除本档）

templates 的示例/说明档读完会删，AI 的**常驻**规则必须住在专案 CLAUDE.md——把下方
分隔线后的段落**连同 `<!-- wiki-plugin:start/end -->` 两行标记**贴进专案 CLAUDE.md（团队共享）或 CLAUDE.local.md（只留本机）——正常情况由 `wiki-setup.js --mode shared|local` 代劳，不必手动——路径与专案实际设定不同时按实调整，然后删除本档。标记是给移除脚本（`wiki-uninstall.js`）定位用的，别拿掉。

---

<!-- wiki-plugin:start -->
## 知识体系入口（常驻；规则细节在手册，不在本档）

- **专案知识库**＝`docs/knowledge/`（markdown＋frontmatter，两层索引）。入口：
  `docs/knowledge/index.md`（主题表）；查某主题的页读 `docs/knowledge/index-<slug>.md`。
- **记录规则手册**＝wiki plugin 的 `plugins/wiki/skills/review/reference.md`——什么该记/
  不该记、frontmatter 规格、写入政策（预设 require_approval：先提案经用户同意才写）、
  索引维护 checklist。
- **任务进度/待办**＝`.claude/state/`（不进 git、任务完结即删档）。开场先看这里知道做到哪；
  一个任务一档。
- **文件草稿**＝`docs/wip/`（不进 git、不受 lint 管）。定稿后走「Wiki 建议」提案进知识库，
  草稿即删。
- **memory 停用**：知识写 docs/knowledge/、进度写 .claude/state/，不写 memory（plugin
  闸门会挡）。
<!-- wiki-plugin:end -->
