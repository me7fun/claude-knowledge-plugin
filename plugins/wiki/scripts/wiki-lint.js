/**
 * wiki-lint.js — 知识库结构稽核（确定性检查，不靠自觉）
 *
 * 检查项（对应计划 §4.4）：
 *   1. 每个知识页有可解析 frontmatter 且 type 非空（OKF 一致性）
 *   2. status 若存在须 ∈ {draft, stable, deprecated}
 *   3. stale_after 已过期 → 警告
 *   4. index.md 主题表的页数与 index-<slug>.md 实际条目数一致
 *   5. 索引指到的档案存在；无孤儿页；无跨主题重复列
 *   6. 页内 .md 连结不断链（相对路径与 bundle 绝对路径 /x.md 两种）
 *   7. 跨系统：memory 目录不应再长出 feedback 以外的档案（Q1 方案 A）
 *
 * 用法：
 *   node wiki-lint.js            # CLI：印出问题、有问题 exit 1
 *   require(...).lintWiki(root)  # 被 session-start 调用，回问题阵列
 *
 * 注意：OKF 规定消费端不得因断链拒收 bundle——本 lint 是维护工具，
 * 输出的是「要修」的警告，不是一致性否决。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { projectRoot, loadConfig, parseFrontmatter, parseIndexTable } = require("./wiki-lib");

const VALID_STATUS = new Set(["draft", "stable", "deprecated"]);
const RESERVED = /^(index([.-].*)?\.md|readme\.md|log\.md)$/i;

/** 列出知识库内全部 .md（递回），回相对 knowledgeRoot 的 / 分隔路径 */
function listMarkdown(rootDir) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(full);
    }
  }
  walk(rootDir);
  return out.map((f) => path.relative(rootDir, f).replace(/\\/g, "/"));
}

function isExcluded(rel, excludes) {
  for (const ex of excludes) {
    if (ex.endsWith("/")) {
      if (rel === ex.slice(0, -1) || rel.startsWith(ex)) return true;
    } else if (rel === ex) {
      return true;
    }
  }
  return false;
}

/** 主检查。回 string[]（每条一个问题） */
function lintWiki(root) {
  const cfg = loadConfig(root);
  const wikiDir = path.join(root, cfg.knowledgeRoot);
  const problems = [];

  const indexPath = path.join(wikiDir, "index.md");
  if (!fs.existsSync(indexPath)) {
    return [cfg.knowledgeRoot + "/index.md 不存在"];
  }

  const allMd = listMarkdown(wikiDir).filter((rel) => !isExcluded(rel, cfg.excludeFromLint));
  const pages = allMd.filter((rel) => !RESERVED.test(path.basename(rel)) || rel.includes("/"))
    // 子目录内的 index 类档名不视为保留档，只有 bundle 根的才是
    .filter((rel) => !(RESERVED.test(rel)));

  // ---- 索引层 ----
  const indexText = fs.readFileSync(indexPath, "utf8");
  const rows = parseIndexTable(indexText);
  const declared = {}; // slugFile -> count(int|null)
  for (const row of rows) {
    const m = row.link.match(/\((index-[a-z0-9-]+\.md)\)/) || row.link.match(/^(index-[a-z0-9-]+\.md)$/);
    if (!m) {
      problems.push(`index.md 主题「${row.theme}」的子索引栏没有 index-<slug>.md 连结`);
      continue;
    }
    const n = parseInt(row.count, 10);
    declared[m[1]] = Number.isFinite(n) ? n : null;
    if (!Number.isFinite(n)) problems.push(`index.md 主题「${row.theme}」页数不是数字：${row.count}`);
  }

  // ---- 子索引层：条目 vs 宣告数 vs 实档 ----
  const owners = {}; // page rel -> [slugFile...]
  for (const [slugFile, count] of Object.entries(declared)) {
    const slugPath = path.join(wikiDir, slugFile);
    if (!fs.existsSync(slugPath)) {
      problems.push(`index.md 列了 ${slugFile}，但档案不存在`);
      continue;
    }
    const entries = [];
    const entryRe = /^-\s+\[[^\]]+\]\(([^)]+\.md)\)/gm;
    const slugText = fs.readFileSync(slugPath, "utf8");
    let m;
    while ((m = entryRe.exec(slugText)) !== null) entries.push(m[1].replace(/^\//, ""));
    if (count !== null && entries.length !== count) {
      problems.push(`index.md 记 ${slugFile} 有 ${count} 页，实际列了 ${entries.length} 页`);
    }
    for (const ent of entries) {
      (owners[ent] = owners[ent] || []).push(slugFile);
    }
  }

  for (const [page, ownerList] of Object.entries(owners)) {
    if (!fs.existsSync(path.join(wikiDir, page))) {
      problems.push(`${ownerList[0]} 列了不存在的页：${page}`);
    }
    if (ownerList.length > 1) {
      problems.push(`${page} 被多个子索引重复列出：${ownerList.join(", ")}`);
    }
  }

  for (const page of pages) {
    if (!owners[page]) problems.push(`${page} 是孤儿页：没有任何 index-<slug>.md 列出它`);
  }

  // ---- 页层：frontmatter ----
  const today = new Date().toISOString().slice(0, 10);
  for (const page of pages) {
    const text = fs.readFileSync(path.join(wikiDir, page), "utf8");
    const front = parseFrontmatter(text);
    if (!front) {
      problems.push(`${page} 缺 frontmatter`);
      continue;
    }
    if (!front.type || (typeof front.type === "string" && !front.type.trim())) {
      problems.push(`${page} 的 frontmatter 缺 type（OKF 唯一必填字段）`);
    }
    if (front.status && !VALID_STATUS.has(String(front.status))) {
      problems.push(`${page} 的 status 非法：${front.status}（须 draft/stable/deprecated）`);
    }
    if (front.stale_after && /^\d{4}-\d{2}-\d{2}$/.test(String(front.stale_after))) {
      if (String(front.stale_after) < today) {
        problems.push(`${page} 已过 stale_after（${front.stale_after}）——内容过期，该更新或降级`);
      }
    }
    // 页内连结检查（排除外部 URL 与锚点）
    const linkRe = /\]\((?!https?:|mailto:|#)([^)#\s]+\.md)(#[^)]*)?\)/g;
    let lm;
    while ((lm = linkRe.exec(text)) !== null) {
      let target = lm[1];
      let resolved;
      if (target.startsWith("/")) {
        resolved = path.join(wikiDir, target.slice(1)); // bundle 绝对路径
      } else {
        resolved = path.join(wikiDir, path.dirname(page), target); // 相对路径
      }
      if (!fs.existsSync(resolved)) {
        problems.push(`${page} 有断链：${target}`);
      }
    }
  }

  // ---- 跨系统：memory 不应再长知识（Q1 方案 A）----
  try {
    const memDir = findMemoryDir(root);
    if (memDir && fs.existsSync(memDir)) {
      const files = fs.readdirSync(memDir).filter((f) => f.endsWith(".md"));
      for (const f of files) {
        if (f === "MEMORY.md" || f.startsWith("feedback_")) continue;
        problems.push(`memory 出现非 feedback 档案：${f}（知识应写 ${cfg.knowledgeRoot}/、进度应写 ${cfg.stateDir}/）`);
      }
    }
  } catch (_) {}

  return problems;
}

/** 从专案路径推导 Claude memory 目录（<home>/.claude/projects/<encoded>/memory） */
function findMemoryDir(root) {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return null;
  const projectsDir = path.join(home, ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return null;
  // 编码规则可能随版本变，稳健做法：扫 projects/ 下所有含 memory/ 的目录，
  // 比对目录名是否对应本专案路径（宽松比对：路径去符号后包含专案资料夹名）。
  const base = path.basename(root).toLowerCase();
  let entries;
  try {
    entries = fs.readdirSync(projectsDir);
  } catch (_) {
    return null;
  }
  // 先做精确比对（专案完整路径的编码名：: 与斜线各替换成 -），
  // 避免宽松比对在 monorepo 下误中「目录名也包含本专案名」的 submodule 专案目录。
  const expected = root.replace(/[:\\/]/g, "-").toLowerCase();
  for (const e of entries) {
    if (e.toLowerCase() === expected) {
      const mem = path.join(projectsDir, e, "memory");
      if (fs.existsSync(mem)) return mem;
    }
  }
  // 精确没中才退回宽松包含比对（编码规则可能随版本变），取「目录名最短」的命中
  // （主专案的编码名必短于其 submodule 的编码名）。
  const loose = entries
    .filter((e) => e.toLowerCase().includes(base))
    .sort((a, b) => a.length - b.length);
  for (const e of loose) {
    const mem = path.join(projectsDir, e, "memory");
    if (fs.existsSync(mem)) return mem;
  }
  return null;
}

if (require.main === module) {
  const root = process.argv[2] || projectRoot();
  const problems = lintWiki(root);
  for (const p of problems) console.log(p);
  if (problems.length) process.exit(1);
  console.log("wiki lint: OK");
}

module.exports = { lintWiki, findMemoryDir };
