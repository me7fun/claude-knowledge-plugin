#!/usr/bin/env node
/**
 * wiki-uninstall.js — 反接线：移除 plugin 放进专案的「设定」，不碰使用者产出的内容
 *
 * 用法：
 *   node wiki-uninstall.js                  # 预览（dry-run）：只列出预计删除/修改的内容，不动任何档案
 *   node wiki-uninstall.js --yes            # 真正执行
 *   node wiki-uninstall.js --root <专案根>  # 指定专案根（预设：CLAUDE_PROJECT_DIR → git 根 → cwd）
 *
 * 依 wiki.config.json 的 "wiring"（wiki-setup.js 写入）决定清哪边：
 *   shared → CLAUDE.md + .gitignore；local → CLAUDE.local.md + .git/info/exclude；
 *   没记录（旧手动接线）→ 两边都查。
 *
 * 会处理（只限 plugin 接线时放进去的东西）：
 *   - .claude/wiki.config.json                        整档删除
 *   - CLAUDE.md / CLAUDE.local.md 的「知识体系入口」段 只删该段（<!-- wiki-plugin:start/end --> 标记优先，
 *                                                     无标记则以标题比对到下一个同级标题为止），列行号
 *                                                     （local 模式下删完若整档已空 → 整档删除）
 *   - .gitignore / .git/info/exclude 的 `.claude/state/`、`docs/wip/`、`.claude/wiki.config.json` 行
 *                                                     只删这几行＋setup 写的「# wiki plugin」注解行，列行号。
 *                                                     盖住「仍会留下的内容」的行不删：state/wip 目录仍有使用者
 *                                                     档案时保留其行；local 模式下 CLAUDE.local.md、<knowledgeRoot>/
 *                                                     两行只在对应内容也被清空时才删
 *   - <stateDir>/_onboarding-demo.md                  整档删除（templates 示例档）
 *   - docs/wip/_about-wip.md                          整档删除（templates 说明档）
 *   - CLAUDE-section.md（接线后忘了删的 templates 档）整档删除
 *   - <knowledgeRoot>/index.md 与 index-*.md          只在「从没列过任何页、目录下也没有知识页」时删除
 *
 * 永远不碰：知识页本身、使用者自己的 state 档、wip 草稿、任何非上列档案。
 * plugin 本体（settings.local.json 的 enabledPlugins、快取）由 `claude plugin uninstall` 处理，脚本结尾提示。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { projectRoot, loadConfig, parseIndexTable } = require("./wiki-lib");

const START_MARK = "<!-- wiki-plugin:start -->";
const END_MARK = "<!-- wiki-plugin:end -->";
const SECTION_HEADING_RE = /^##\s+知[识識]体系入口/;
const GITIGNORE_TARGETS = [".claude/state", "docs/wip", ".claude/wiki.config.json"];

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const YES = argv.includes("--yes") || argv.includes("-y");
if (argv.includes("--help") || argv.includes("-h")) {
  const header = fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^#!.*\n/, "");
  console.log(header.replace(/^\/\*\*?\s?|^ \*\s?/gm, ""));
  process.exit(0);
}
const rootArgIdx = argv.indexOf("--root");
const root = rootArgIdx !== -1 && argv[rootArgIdx + 1] ? path.resolve(argv[rootArgIdx + 1]) : projectRoot();
const cfg = loadConfig(root);
// 接线方式（wiki-setup.js 写进 config 的 "wiring"）：shared → 只清 CLAUDE.md/.gitignore；
// local → 只清 CLAUDE.local.md/.git/info/exclude；没记录（旧接线）→ 两边都找
const wiring = cfg.wiring === "shared" || cfg.wiring === "local" ? cfg.wiring : null;

// ---------- 工具 ----------
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");
function exists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}
function readLines(p) {
  const raw = fs.readFileSync(p, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  return { lines: raw.split(/\r?\n/), eol };
}

/** 计划项：{ kind: "delete", file, why } 或 { kind: "edit", file, ranges: [{ start, end, lines }], why } */
const plan = [];
/** 检查过但决定不动的说明 */
const notes = [];

function addDelete(file, why) {
  if (exists(file) && !plan.some((p) => p.file === file)) plan.push({ kind: "delete", file, why });
}

// ---------- 1. wiki.config.json ----------
addDelete(path.join(root, ".claude", "wiki.config.json"), "plugin 的专案侧设定");

// ---------- 2. CLAUDE.md / CLAUDE.local.md 的知识体系入口段 ----------
// 团队共享接线放 CLAUDE.md；个人/私有接线放 CLAUDE.local.md——有 wiring 记录就只查对应的一边
const CLAUDE_FILES = wiring === "shared" ? ["CLAUDE.md"] : wiring === "local" ? ["CLAUDE.local.md"] : ["CLAUDE.md", "CLAUDE.local.md"];
for (const name of CLAUDE_FILES) planClaudeMd(name);
function planClaudeMd(name) {
  const file = path.join(root, name);
  if (!exists(file)) return;
  const { lines } = readLines(file);
  let start = -1;
  let end = -1; // 含

  const si = lines.findIndex((l) => l.trim() === START_MARK);
  const ei = lines.findIndex((l) => l.trim() === END_MARK);
  if (si !== -1 && ei !== -1 && ei > si) {
    start = si;
    end = ei;
  } else {
    const hi = lines.findIndex((l) => SECTION_HEADING_RE.test(l.trim()));
    if (hi === -1) {
      if (si !== -1 || ei !== -1) notes.push(`${name}：只找到单边的 wiki-plugin 标记，无法安全定位段落，跳过`);
      return;
    }
    start = hi;
    end = lines.length - 1;
    for (let i = hi + 1; i < lines.length; i++) {
      if (/^#{1,2}\s/.test(lines[i])) {
        end = i - 1;
        break;
      }
    }
  }
  // 吃掉段落后的连续空行（避免留下双空行）；若段落已在档尾，改吃前面的空行
  while (end + 1 < lines.length && lines[end + 1].trim() === "") end++;
  if (end + 1 >= lines.length) while (start > 0 && lines[start - 1].trim() === "") start--;
  plan.push({
    kind: "edit",
    file,
    why: "plugin 接线时并入的常驻规则段",
    ranges: [{ start, end, lines: lines.slice(start, end + 1) }],
  });
}

// ---------- 3. .gitignore / .git/info/exclude 的忽略行 ----------
// 团队共享接线写 .gitignore；个人/私有接线写 .git/info/exclude——两个都查。
// 只删「plugin 设定类」的行（state、wip、wiki.config.json）；docs/knowledge/、CLAUDE.local.md
// 这类盖住「会留下来的内容」的行不动，否则移除后知识页会突然冒进 git status。
const EXCLUDE_FILE = path.join(".git", "info", "exclude");
const IGNORE_FILES = wiring === "shared" ? [".gitignore"] : wiring === "local" ? [EXCLUDE_FILE] : [".gitignore", EXCLUDE_FILE];
for (const name of IGNORE_FILES) planIgnoreFile(name);
function planIgnoreFile(name) {
  const file = path.join(root, name);
  if (!exists(file)) return;
  const { lines } = readLines(file);
  const norm = (s) => s.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "").replace(/\/+$/, "");
  const targets = new Set(GITIGNORE_TARGETS.map(norm));
  targets.add(norm(String(cfg.stateDir)));
  // state / wip 目录若在删掉示例档后仍有使用者自己的档案 → 对应忽略行保留，
  // 否则移除后那些私人档会突然冒进 git status
  const keepDirs = new Set();
  for (const [dir, demo] of [
    [String(cfg.stateDir), "_onboarding-demo.md"],
    ["docs/wip", "_about-wip.md"],
  ]) {
    let others = [];
    try {
      others = fs.readdirSync(path.join(root, dir)).filter((f) => f !== demo);
    } catch (_) {}
    if (others.length) keepDirs.add(norm(dir));
  }
  const hits = [];
  lines.forEach((l, i) => {
    const n = norm(l);
    if (keepDirs.has(n)) {
      notes.push(`${rel(file)}：${l.trim()} 保留（该目录仍有使用者自己的档案）`);
      return;
    }
    if (targets.has(n)) hits.push(i);
    // setup 写的「# wiki plugin」标头行在第 7 步统一处理（同组还有行保留时标头也保留）
  });
  if (!hits.length) return;
  plan.push({
    kind: "edit",
    file,
    why: "plugin 接线时加入的忽略规则",
    ranges: hits.map((i) => ({ start: i, end: i, lines: [lines[i]] })),
  });
}

// ---------- 4. templates 示例/说明档 ----------
addDelete(path.join(root, cfg.stateDir, "_onboarding-demo.md"), "templates 的进度目录示例档");
addDelete(path.join(root, "CLAUDE-section.md"), "templates 的接线段落档（并入 CLAUDE.md 后本应删除）");
for (const p of [
  path.join(root, "docs", "wip", "_about-wip.md"),
  path.join(root, cfg.knowledgeRoot, "..", "wip", "_about-wip.md"),
  path.join(root, cfg.knowledgeRoot, "wip", "_about-wip.md"),
]) {
  addDelete(path.normalize(p), "templates 的草稿区说明档");
}

// ---------- 5. 空索引（从没列过任何页）----------
(function planEmptyIndex() {
  const kroot = path.join(root, cfg.knowledgeRoot);
  const indexFile = path.join(kroot, "index.md");
  if (!exists(indexFile)) return;

  // 目录下若有任何非 index 的 .md（知识页）→ 一律不动索引
  const pages = [];
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.toLowerCase().endsWith(".md") && !/^index([.-].*)?\.md$/i.test(e.name)) pages.push(full);
    }
  })(kroot);
  if (pages.length) {
    notes.push(`${rel(kroot)}/：有 ${pages.length} 个知识页，索引档（index.md 与 index-*.md）保留`);
    return;
  }

  const rows = parseIndexTable(fs.readFileSync(indexFile, "utf8"));
  const subFiles = [];
  for (const r of rows) {
    if (String(r.count).trim() !== "0") {
      notes.push(`${rel(indexFile)}：主题「${r.theme}」页数不为 0，索引档保留`);
      return;
    }
    const m = r.link.match(/\(([^)]+)\)/);
    const sub = path.join(kroot, m ? m[1] : r.link);
    if (exists(sub)) {
      if (/\]\([^)]+\.md\)/.test(fs.readFileSync(sub, "utf8"))) {
        notes.push(`${rel(sub)}：已列有页面连结，索引档保留`);
        return;
      }
      subFiles.push(sub);
    }
  }
  plan.push({ kind: "delete", file: indexFile, why: "空索引：从没列过任何页、目录下也没有知识页" });
  for (const s of subFiles) plan.push({ kind: "delete", file: s, why: "空子索引" });
})();

// ---------- 6. 私有接线的收尾：整套都留在本机，能清干净的就清干净 ----------
// (a) CLAUDE.local.md 删掉段落后若空无一物 → 改成整档删除，并一并拿掉 exclude 里的 CLAUDE.local.md 行
// (b) 知识库若整个会被清空（空索引全删）→ 一并拿掉 exclude 里的 <knowledgeRoot>/ 行
(function finalizeLocalWiring() {
  if (wiring !== "local") return;
  const excludePath = path.join(root, EXCLUDE_FILE);
  const extraExcludeTargets = [];

  const localMd = path.join(root, "CLAUDE.local.md");
  const editIdx = plan.findIndex((p) => p.kind === "edit" && p.file === localMd);
  if (editIdx !== -1) {
    const { lines } = readLines(localMd);
    const drop = new Set();
    for (const r of plan[editIdx].ranges) for (let i = r.start; i <= r.end; i++) drop.add(i);
    const leftover = lines.filter((l, i) => !drop.has(i) && l.trim() !== "");
    if (!leftover.length) {
      plan[editIdx] = { kind: "delete", file: localMd, why: "私有接线的常驻规则档，删掉段落后已无内容" };
      extraExcludeTargets.push("CLAUDE.local.md");
    }
  }

  const kroot = path.join(root, cfg.knowledgeRoot);
  if (plan.some((p) => p.kind === "delete" && p.file === path.join(kroot, "index.md"))) {
    extraExcludeTargets.push(String(cfg.knowledgeRoot));
  }

  if (!extraExcludeTargets.length || !exists(excludePath)) return;
  const { lines } = readLines(excludePath);
  const norm = (s) => s.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "").replace(/\/+$/, "");
  const targets = new Set(extraExcludeTargets.map(norm));
  let item = plan.find((p) => p.kind === "edit" && p.file === excludePath);
  const already = new Set(item ? item.ranges.map((r) => r.start) : []);
  const hits = [];
  lines.forEach((l, i) => {
    if (targets.has(norm(l)) && !already.has(i)) hits.push(i);
  });
  if (!hits.length) return;
  if (!item) {
    item = { kind: "edit", file: excludePath, why: "plugin 接线时加入的忽略规则", ranges: [] };
    plan.push(item);
  }
  item.ranges.push(...hits.map((i) => ({ start: i, end: i, lines: [lines[i]] })));
  item.ranges.sort((a, b) => a.start - b.start);
})();

// ---------- 7. 忽略档收尾：标头行与空档 ----------
// (a) setup 写的「# wiki plugin」标头：同组 wiki 行全部会被删才一并删；有任何一行保留就留标头（不留孤儿行）
// (b) 删完若整档只剩空白 → 改成整档删除（0 byte 的 .gitignore / exclude 没有意义，反而会冒进 git status）
(function finalizeIgnoreFiles() {
  const HEADER_RE = /^#\s*wiki plugin(（私有接线）)?$/;
  const norm = (s) => s.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "").replace(/\/+$/, "");
  const wikiTargets = new Set(
    [...GITIGNORE_TARGETS, String(cfg.stateDir), "CLAUDE.local.md", String(cfg.knowledgeRoot)].map(norm)
  );
  for (const name of IGNORE_FILES) {
    const file = path.join(root, name);
    if (!exists(file)) continue;
    const { lines } = readLines(file);
    const headerIdx = [];
    lines.forEach((l, i) => {
      if (HEADER_RE.test(l.trim())) headerIdx.push(i);
    });
    let item = plan.find((p) => p.kind === "edit" && p.file === file);
    const dropped = new Set(item ? item.ranges.map((r) => r.start) : []);
    const wikiRemaining = lines.some((l, i) => wikiTargets.has(norm(l)) && !dropped.has(i));
    if (headerIdx.length && !wikiRemaining) {
      if (!item) {
        item = { kind: "edit", file, why: "plugin 接线时加入的忽略规则", ranges: [] };
        plan.push(item);
      }
      for (const i of headerIdx) {
        if (!dropped.has(i)) item.ranges.push({ start: i, end: i, lines: [lines[i]] });
        dropped.add(i);
      }
      item.ranges.sort((a, b) => a.start - b.start);
    } else if (headerIdx.length && wikiRemaining && item) {
      notes.push(`${rel(file)}：${lines[headerIdx[0]].trim()} 标头保留（同组仍有行保留）`);
    }
    if (item && lines.every((l, i) => dropped.has(i) || l.trim() === "")) {
      const idx = plan.indexOf(item);
      plan[idx] = { kind: "delete", file, why: "忽略档删完 plugin 的行后已无内容" };
    }
  }
})();

// ---------- 输出计划 ----------
console.log(`专案根：${root}`);
console.log(`接线记录：${wiring ? `${wiring}（来自 wiki.config.json 的 wiring）` : "无（旧接线，CLAUDE.md/.local.md 与 .gitignore/exclude 两边都查）"}`);
console.log(`模式：${YES ? "执行" : "预览（dry-run，不动任何档案）"}\n`);

if (!plan.length) {
  console.log("没有找到 plugin 接线痕迹，无事可做。");
} else {
  console.log("预计变更：\n");
  plan.forEach((item, idx) => {
    const n = idx + 1;
    if (item.kind === "delete") {
      console.log(`${n}. [删除整档] ${rel(item.file)}  —— ${item.why}`);
    } else {
      const spans = item.ranges
        .map((r) => (r.start === r.end ? `${r.start + 1}` : `${r.start + 1}-${r.end + 1}`))
        .join(", ");
      console.log(`${n}. [删除行] ${rel(item.file)}:${spans}  —— ${item.why}`);
      for (const r of item.ranges) {
        r.lines.forEach((l, i) => console.log(`     ${String(r.start + i + 1).padStart(4)} | ${l}`));
      }
    }
    console.log("");
  });
}
if (notes.length) {
  console.log("检查过但保留：");
  for (const s of notes) console.log(`  - ${s}`);
  console.log("");
}

if (!plan.length) process.exit(0);

if (!YES) {
  console.log("以上为预览，未动任何档案。确认后重跑并加 --yes 执行：");
  console.log(`  node "${__filename}" --yes${rootArgIdx !== -1 ? ` --root "${root}"` : ""}`);
  process.exit(0);
}

// ---------- 执行 ----------
console.log("执行中…\n");
const failed = [];
for (const item of plan) {
  try {
    if (item.kind === "delete") {
      fs.unlinkSync(item.file);
      console.log(`  已删除 ${rel(item.file)}`);
      // 顺手清掉因此变空的目录（只清这一层，不往上递回）
      const dir = path.dirname(item.file);
      try {
        if (fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
          console.log(`  已移除空目录 ${rel(dir)}/`);
        }
      } catch (_) {}
    } else {
      const { lines, eol } = readLines(item.file);
      const drop = new Set();
      for (const r of item.ranges) for (let i = r.start; i <= r.end; i++) drop.add(i);
      const kept = lines.filter((_, i) => !drop.has(i));
      if (kept.length && kept[kept.length - 1] !== "") kept.push(""); // 档尾保留换行
      fs.writeFileSync(item.file, kept.join(eol));
      console.log(`  已修改 ${rel(item.file)}（删 ${drop.size} 行）`);
    }
  } catch (e) {
    failed.push(`${rel(item.file)}：${e.message}`);
  }
}
console.log("");
if (failed.length) {
  console.log("以下项目失败：");
  for (const f of failed) console.log(`  - ${f}`);
  console.log("");
}
console.log("专案侧设定已清除。plugin 本体请另行卸载：");
console.log("  claude plugin uninstall wiki@claude-knowledge-plugin --scope local");
process.exit(failed.length ? 1 : 0);
