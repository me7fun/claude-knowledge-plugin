/**
 * wiki-session-start.js — SessionStart hook
 *
 * 每次开对话注入：
 *   1. 知识库主题索引摘要（只列分类层，细节 lazy-load——不注入全文）
 *   2. 查找步骤（主题匹配 → 读子索引 → 搜索脚本 → rg）
 *   3. 写入政策（require_approval：先查重、提案后等用户同意才写）
 *   4. 进度目录摘要（.claude/state/ 内每档第一行）
 *   5. lint 警告（有结构问题才出现；fail-soft，坏了不挡开场）
 *
 * 全程 fail-soft：任何一步坏掉都输出 "{}"，绝不挡 session。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { projectRoot, loadConfig, parseIndexTable } = require("./wiki-lib");

function emit(text) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: text,
      },
    })
  );
}

function main() {
  let root, cfg;
  try {
    root = projectRoot();
    cfg = loadConfig(root);
  } catch (_) {
    process.stdout.write("{}");
    return;
  }

  const indexPath = path.join(root, cfg.knowledgeRoot, "index.md");
  if (!fs.existsSync(indexPath)) {
    // 专案没有知识库（plugin 装了但还没建 index）——不注入任何东西
    process.stdout.write("{}");
    return;
  }

  const parts = [];
  // 给出可直接执行的搜索指令——只写「plugin scripts/…」agent 不知道 plugin 装在哪
  const searchCmd = `node "${path.join(__dirname, "wiki-search.js")}" <关键字...>`;
  // 完整指令只出现一次：查找步骤印过了，写入政策就只引用它
  let searchRef = `跑 ${searchCmd}`;

  // ---- 1. 主题索引摘要 ----
  try {
    const rows = parseIndexTable(fs.readFileSync(indexPath, "utf8"));
    if (rows.length) {
      const lines = rows.map((r) => {
        const head = `- ${r.theme}（${r.count} 页）→ ${cfg.knowledgeRoot}/${stripLink(r.link)}`;
        return r.keywords ? `${head}\n  关键字: ${r.keywords}` : head;
      });
      parts.push(
        "本专案知识库主题索引（顶层，细节按需读取）：\n\n" +
          lines.join("\n") +
          "\n\n查找步骤：\n" +
          "1. 先用上表关键字做语义匹配（用户用词常是别名，别只比对主题名）。\n" +
          `2. 命中主题 → 读 ${cfg.knowledgeRoot}/index-<slug>.md 取该主题完整页清单。\n` +
          `3. 没命中 → 用搜索脚本：${searchCmd}（多个关键字任一命中即列出，附所属小节；-t <tag> 按标签）。\n` +
          `4. 最后手段 → rg "<关键字>" ${cfg.knowledgeRoot}/ -g '!index*.md'\n` +
          `不要整份读 ${cfg.knowledgeRoot}/index.md（本摘要已涵盖分类层）。页面历史用 git log 查。`
      );
      searchRef = "跑查找步骤 3 的搜索脚本";
    }
  } catch (_) {}

  // ---- 2. 写入政策 ----
  if (cfg.writePolicy === "open") {
    parts.push(
      "知识库写入政策：open——可直接写，但仍须同步维护两层索引并输出评估标记。" +
        `**写之前先查重**：${searchRef}并读命中的小节，已有页/小节涵盖 → 扩写该处，不另开新页。`
    );
  } else {
    parts.push(
      "知识库写入政策：require_approval——发现值得记的知识时，**当下就先查重**" +
        `（${searchRef}并读命中的小节——索引只列到页，页内小节要搜才看得到；别拖到收工才凭记忆列）。` +
        "已有页/小节涵盖 → 改提「扩写该页该节」；完全涵盖 → 不提。" +
        "然后以「Wiki 建议」格式提案（目标页、要记什么、来源、查重：搜了什么→命中哪页哪节→结论），" +
        "等用户明确同意后才写入。" +
        `进度/待办不进知识库，写 ${cfg.stateDir}/。memory 已停用（只留 feedback 类），不要往 memory 写任何东西。`
    );
  }
  if (cfg.proposalStyle !== "terse") {
    parts.push(
      "Wiki 提案措辞：**每条提案先给一句白话**（这是什么、为何值得记、不记会怎样），" +
        "用户不一定是该领域专家、也可能在手机上——别只丢术语/代码/档名让人猜。" +
        "（专家想关掉白话：wiki.config.json 设 proposalStyle: terse。）"
    );
  }

  // ---- 3. 进度目录摘要 ----
  try {
    const stateDir = path.join(root, cfg.stateDir);
    if (fs.existsSync(stateDir)) {
      const files = fs.readdirSync(stateDir).filter((f) => f.endsWith(".md"));
      if (files.length) {
        const lines = files.map((f) => {
          const first = firstHeading(path.join(stateDir, f));
          return `- ${f}${first ? `：${first}` : ""}`;
        });
        parts.push(`进行中任务（${cfg.stateDir}/，任务完结即删）：\n` + lines.join("\n"));
      }
    }
  } catch (_) {}

  // ---- 4. lint 警告（fail-soft）----
  try {
    const { lintWiki } = require("./wiki-lint");
    const problems = lintWiki(root);
    if (problems.length) {
      const shown = problems.slice(0, 10).map((p) => `  - ${p}`);
      const more = problems.length > 10 ? `\n  …共 ${problems.length} 个问题` : "";
      parts.push("⚠ wiki lint 发现结构问题（本 session 若碰知识库，先修这些）：\n" + shown.join("\n") + more);
    }
  } catch (_) {}

  if (!parts.length) {
    process.stdout.write("{}");
    return;
  }
  emit(parts.join("\n\n"));
}

function stripLink(cell) {
  const m = cell.match(/\(([^)]+)\)/);
  return m ? m[1] : cell;
}

/** 取档案第一个标题或第一行非空文字（截 60 字） */
function firstHeading(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s || s.startsWith("---")) continue;
      return s.replace(/^#+\s*/, "").slice(0, 60);
    }
  } catch (_) {}
  return "";
}

try {
  main();
} catch (_) {
  process.stdout.write("{}");
}
