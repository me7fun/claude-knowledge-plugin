#!/usr/bin/env node
/**
 * wiki-setup.js — 专案接线：把 plugin 的 templates 接进目标专案，并记下接线方式
 *
 * 用法：
 *   node wiki-setup.js --mode shared          # 预览（dry-run）：列出预计新增/追加的内容，不动任何档案
 *   node wiki-setup.js --mode shared --yes    # 真正执行
 *   node wiki-setup.js --mode local  --yes
 *   node wiki-setup.js --root <专案根> ...    # 指定专案根（预设：CLAUDE_PROJECT_DIR → git 根 → cwd）
 *
 * --mode 二选一（判准：wiki 的知识要不要给 clone 这个 repo 的人看？）：
 *   shared  要。接线档与知识库进 git：常驻规则段写 CLAUDE.md，忽略规则写 .gitignore
 *   local   不要。只留在本机：常驻规则段写 CLAUDE.local.md，忽略规则写 .git/info/exclude
 *           （连同 CLAUDE.local.md、.claude/wiki.config.json、<knowledgeRoot>/ 一起排除）
 *
 * 会做：
 *   - 建 .claude/wiki.config.json（含 "wiring": "<mode>"——移除脚本据此决定清哪边）
 *   - 复制 templates 的知识库索引、state 示例档、wip 说明档（已存在的档案一律跳过，不覆盖）
 *   - 把 CLAUDE-section.md 的段落（含 <!-- wiki-plugin:start/end --> 标记）追加到 CLAUDE.md 或 CLAUDE.local.md
 *   - 把忽略规则追加到 .gitignore 或 .git/info/exclude（已有的行跳过）
 *   - shared 模式下若 .git/info/exclude 还留着 local 接线的 <knowledgeRoot>/、wiki.config.json 行 → 一并拿掉
 *     （否则知识库会被静默排除、永远进不了 git）
 * 两种模式互斥：config 已记另一种 wiring、或另一边的 CLAUDE 档已有规则段 → 直接中止，提示先跑 wiki-uninstall.js。
 * 不会做：安装 plugin 本体（claude plugin install）——脚本结尾提示。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { projectRoot } = require("./wiki-lib");

const START_MARK = "<!-- wiki-plugin:start -->";
const END_MARK = "<!-- wiki-plugin:end -->";
const SECTION_HEADING_RE = /^##\s+知[识識]体系入口/;
const TEMPLATES = path.join(__dirname, "..", "templates");
const IGNORE_HEADER = { shared: "# wiki plugin", local: "# wiki plugin（私有接线）" };

// ---------- 参数 ----------
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  const header = fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^#!.*\n/, "");
  console.log(header.replace(/^\/\*\*?\s?|^ \*\s?/gm, ""));
  process.exit(0);
}
const YES = argv.includes("--yes") || argv.includes("-y");
const modeIdx = argv.indexOf("--mode");
const mode = modeIdx !== -1 ? argv[modeIdx + 1] : "";
if (mode !== "shared" && mode !== "local") {
  console.error("请指定 --mode shared 或 --mode local：");
  console.error("  shared  wiki 知识要给 clone 这个 repo 的人看 → 写 CLAUDE.md + .gitignore，接线档与知识库进 git");
  console.error("  local   只留在本机 → 写 CLAUDE.local.md + .git/info/exclude，不进 git");
  process.exit(2);
}
const rootArgIdx = argv.indexOf("--root");
const root = rootArgIdx !== -1 && argv[rootArgIdx + 1] ? path.resolve(argv[rootArgIdx + 1]) : projectRoot();

if (!fs.existsSync(path.join(TEMPLATES, "CLAUDE-section.md"))) {
  console.error(`找不到 templates（${TEMPLATES}）。这份 plugin 快取版本太旧，请先更新：`);
  console.error("  claude plugin marketplace update claude-knowledge-plugin");
  console.error("  claude plugin update wiki@claude-knowledge-plugin --scope local");
  process.exit(2);
}

// ---------- 工具 ----------
const rel = (p) => path.relative(root, p).replace(/\\/g, "/");
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}
function readLines(p) {
  const raw = fs.readFileSync(p, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  return { raw, lines: raw.split(/\r?\n/), eol };
}
/** 档案目前有几「行」（结尾换行不算多一行） */
function lineCount(p) {
  if (!isFile(p)) return 0;
  const { lines } = readLines(p);
  return lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}
const normIgnore = (s) => s.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "").replace(/\/+$/, "");
function hasSection(file) {
  if (!isFile(file)) return false;
  return readLines(file).lines.some((l) => l.trim() === START_MARK || SECTION_HEADING_RE.test(l.trim()));
}
function abort(msg) {
  console.error(msg);
  console.error("要换接线模式，请先跑 wiki-uninstall.js 清掉旧接线，再重跑本脚本。");
  process.exit(2);
}

/** 计划项：
 *   { kind: "create", file, from }              新建档案（从 templates 复制）
 *   { kind: "write-config", file, content, isNew }  新建或补 wiring 的 wiki.config.json
 *   { kind: "append", file, text, why }         追加文字到档尾
 *   { kind: "remove-lines", file, ranges, why } 删掉指定行（shared 模式清 exclude 残留）
 */
const plan = [];
const notes = [];

// ---------- 既有 config 与冲突检查（先做，避免写下与实况不符的 wiring）----------
const CONFIG_FILE = path.join(root, ".claude", "wiki.config.json");
const tplConfig = JSON.parse(fs.readFileSync(path.join(TEMPLATES, ".claude", "wiki.config.json"), "utf8"));
let curConfig = null;
let curConfigBroken = false;
if (isFile(CONFIG_FILE)) {
  try {
    curConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (!curConfig || typeof curConfig !== "object") throw new Error("not an object");
  } catch (_) {
    curConfigBroken = true;
    curConfig = null;
  }
}
// 只认 shared / local；其他值当作没记录（uninstall 也是这样解读），之后会被本次 mode 覆写
const curWiring = curConfig && (curConfig.wiring === "shared" || curConfig.wiring === "local") ? curConfig.wiring : null;
if (curConfig && curConfig.wiring && !curWiring) {
  notes.push(`${rel(CONFIG_FILE)}：wiring 值「${curConfig.wiring}」不合法，视为未记录，将改写为 ${mode}`);
}
if (curWiring && curWiring !== mode) {
  abort(`${rel(CONFIG_FILE)} 记录的接线方式是 ${curWiring}，与本次 --mode ${mode} 不同。`);
}
const TARGET_MD = path.join(root, mode === "shared" ? "CLAUDE.md" : "CLAUDE.local.md");
const OTHER_MD = path.join(root, mode === "shared" ? "CLAUDE.local.md" : "CLAUDE.md");
if (hasSection(OTHER_MD)) {
  abort(`${rel(OTHER_MD)} 已含「知识体系入口」段——看起来已用${mode === "shared" ? " local" : " shared"} 方式接线过。`);
}

// 之后的路径以「最终会生效的 config」为准（既有 config 优先）
const cfg = Object.assign({}, tplConfig, curConfig || {});
const knowledgeRoot = String(cfg.knowledgeRoot || "docs/knowledge").replace(/\\/g, "/").replace(/\/+$/, "");
const stateDir = String(cfg.stateDir || ".claude/state").replace(/\\/g, "/").replace(/\/+$/, "");

// ---------- 1. wiki.config.json ----------
if (curConfigBroken) {
  notes.push(`${rel(CONFIG_FILE)}：已存在但解析失败，跳过（请手动补 "wiring": "${mode}"）`);
} else if (!curConfig) {
  plan.push({ kind: "write-config", file: CONFIG_FILE, isNew: true, content: JSON.stringify(Object.assign({}, tplConfig, { wiring: mode }), null, 2) + "\n" });
} else if (curConfig.wiring === mode) {
  notes.push(`${rel(CONFIG_FILE)}：已存在且 wiring 已是 ${mode}，跳过`);
} else {
  plan.push({ kind: "write-config", file: CONFIG_FILE, isNew: false, content: JSON.stringify(Object.assign({}, curConfig, { wiring: mode }), null, 2) + "\n" });
}

// ---------- 2. templates 档案（索引、示例、说明）----------
(function planTemplateFiles() {
  const map = [];
  const tplKnowledge = path.join(TEMPLATES, "docs", "knowledge");
  for (const f of fs.readdirSync(tplKnowledge)) map.push([path.join(tplKnowledge, f), path.join(root, knowledgeRoot, f)]);
  map.push([path.join(TEMPLATES, ".claude", "state", "_onboarding-demo.md"), path.join(root, stateDir, "_onboarding-demo.md")]);
  map.push([path.join(TEMPLATES, "docs", "wip", "_about-wip.md"), path.join(root, "docs", "wip", "_about-wip.md")]);
  for (const [from, to] of map) {
    if (isFile(to)) notes.push(`${rel(to)}：已存在，跳过（不覆盖）`);
    else plan.push({ kind: "create", file: to, from });
  }
})();

// ---------- 3. CLAUDE.md / CLAUDE.local.md 的常驻规则段 ----------
(function planClaudeSection() {
  if (hasSection(TARGET_MD)) {
    notes.push(`${rel(TARGET_MD)}：已含知识体系入口段，跳过`);
    return;
  }
  const src = fs.readFileSync(path.join(TEMPLATES, "CLAUDE-section.md"), "utf8").replace(/\r\n?/g, "\n");
  const s = src.indexOf(START_MARK);
  const e = src.indexOf(END_MARK);
  if (s === -1 || e === -1) {
    notes.push("templates/CLAUDE-section.md 缺 wiki-plugin 标记，无法抽出段落，跳过");
    return;
  }
  let section = src.slice(s, e + END_MARK.length) + "\n";
  // 路径与 config 不同时按实替换（templates 写死 docs/knowledge 与 .claude/state）
  section = section.split("docs/knowledge").join(knowledgeRoot).split(".claude/state").join(stateDir);
  plan.push({
    kind: "append",
    file: TARGET_MD,
    text: (isFile(TARGET_MD) ? "\n" : "") + section,
    why: mode === "shared" ? "给 AI 的常驻规则段（进 git）" : "给 AI 的常驻规则段（只留本机）",
  });
})();

// ---------- 4. 忽略规则 ----------
const EXCLUDE_FILE = path.join(root, ".git", "info", "exclude");
(function planIgnore() {
  const wanted =
    mode === "shared" ? [`${stateDir}/`, "docs/wip/"] : ["CLAUDE.local.md", ".claude/wiki.config.json", `${knowledgeRoot}/`, `${stateDir}/`, "docs/wip/"];
  let file;
  if (mode === "shared") {
    file = path.join(root, ".gitignore");
  } else {
    const dotGit = path.join(root, ".git");
    if (isFile(dotGit)) {
      notes.push("专案根的 .git 是档案（worktree / submodule），exclude 在实际 gitdir 下——请自行把这些行加进去：" + wanted.join("、"));
      return;
    }
    if (!isDir(dotGit)) {
      notes.push("专案根没有 .git/，无法写 .git/info/exclude——请自行处理忽略规则");
      return;
    }
    file = EXCLUDE_FILE; // 目录不存在时执行阶段再建，dry-run 不动任何东西
  }
  const lines = isFile(file) ? readLines(file).lines : [];
  const existing = new Set(lines.map(normIgnore));
  const hasHeader = lines.some((l) => l.trim() === IGNORE_HEADER[mode]);
  const add = wanted.filter((w) => !existing.has(normIgnore(w)));
  const skipped = wanted.filter((w) => existing.has(normIgnore(w)));
  if (skipped.length) notes.push(`${rel(file)}：已有 ${skipped.join("、")}，跳过`);
  if (!add.length) return;
  plan.push({
    kind: "append",
    file,
    text: (hasHeader ? "" : IGNORE_HEADER[mode] + "\n") + add.join("\n") + "\n",
    why: mode === "shared" ? "忽略 state 与草稿区" : "整套 wiki 接线只留本机",
  });
})();

// ---------- 5. shared 模式：清掉 exclude 里 local 接线的残留 ----------
// local → uninstall（知识页保留，exclude 的 <knowledgeRoot>/ 行依设计留着）→ 改接 shared：
// 若不拿掉，知识库会被静默排除、永远进不了 git。
(function planExcludeLeftovers() {
  if (mode !== "shared" || !isFile(EXCLUDE_FILE)) return;
  // state / wip 两行也一并接管到 .gitignore，标头顺手清掉；CLAUDE.local.md 行留着（那档可能有使用者自己的内容）
  const targets = new Set([`${knowledgeRoot}`, ".claude/wiki.config.json", `${stateDir}`, "docs/wip"].map(normIgnore));
  const { lines } = readLines(EXCLUDE_FILE);
  const hits = [];
  lines.forEach((l, i) => {
    if (targets.has(normIgnore(l)) || l.trim() === IGNORE_HEADER.local) hits.push(i);
  });
  if (!hits.length) return;
  plan.push({
    kind: "remove-lines",
    file: EXCLUDE_FILE,
    why: "之前 local 接线留下的排除行——shared 模式下知识库与 config 要进 git",
    ranges: hits.map((i) => ({ start: i, end: i, lines: [lines[i]] })),
  });
})();

// ---------- 输出计划 ----------
console.log(`专案根：${root}`);
console.log(`接线模式：${mode}（${mode === "shared" ? "进 git，团队共享" : "只留本机，不进 git"}）`);
console.log(`模式：${YES ? "执行" : "预览（dry-run，不动任何档案）"}\n`);

if (!plan.length) {
  console.log("没有需要新增的东西（看起来已接线）。");
} else {
  console.log("预计变更：\n");
  plan.forEach((item, idx) => {
    const n = idx + 1;
    if (item.kind === "create") {
      console.log(`${n}. [新增档案] ${rel(item.file)}  —— 复制自 templates/${path.relative(TEMPLATES, item.from).replace(/\\/g, "/")}`);
    } else if (item.kind === "write-config") {
      if (item.isNew) {
        console.log(`${n}. [新增档案] ${rel(item.file)}  —— plugin 专案侧设定（wiring: ${mode}）`);
        item.content.trimEnd().split("\n").forEach((l) => console.log(`        | ${l}`));
      } else {
        console.log(`${n}. [修改档案] ${rel(item.file)}  —— 补 "wiring": "${mode}"（其余字段不动）`);
      }
    } else if (item.kind === "append") {
      const body = item.text.replace(/^\n/, "").trimEnd().split("\n");
      const startLine = lineCount(item.file) + (item.text.startsWith("\n") ? 2 : 1);
      console.log(`${n}. [追加到档尾] ${rel(item.file)}:${startLine}-${startLine + body.length - 1}  —— ${item.why}`);
      body.forEach((l, i) => console.log(`     ${String(startLine + i).padStart(4)} | ${l}`));
    } else {
      const spans = item.ranges.map((r) => `${r.start + 1}`).join(", ");
      console.log(`${n}. [删除行] ${rel(item.file)}:${spans}  —— ${item.why}`);
      for (const r of item.ranges) r.lines.forEach((l, i) => console.log(`     ${String(r.start + i + 1).padStart(4)} | ${l}`));
    }
    console.log("");
  });
}
if (notes.length) {
  console.log("检查过但跳过：");
  for (const s of notes) console.log(`  - ${s}`);
  console.log("");
}

if (!plan.length) process.exit(0);

if (!YES) {
  console.log("以上为预览，未动任何档案。确认后重跑并加 --yes 执行：");
  console.log(`  node "${__filename}" --mode ${mode} --yes${rootArgIdx !== -1 ? ` --root "${root}"` : ""}`);
  process.exit(0);
}

// ---------- 执行 ----------
console.log("执行中…\n");
const failed = [];
for (const item of plan) {
  try {
    fs.mkdirSync(path.dirname(item.file), { recursive: true });
    if (item.kind === "create") {
      fs.copyFileSync(item.from, item.file);
      console.log(`  已新增 ${rel(item.file)}`);
    } else if (item.kind === "write-config") {
      fs.writeFileSync(item.file, item.content);
      console.log(`  已${item.isNew ? "新增" : "修改"} ${rel(item.file)}`);
    } else if (item.kind === "append") {
      if (!isFile(item.file)) {
        fs.writeFileSync(item.file, item.text.replace(/^\n/, ""));
      } else {
        const { raw, eol } = readLines(item.file);
        const body = item.text.replace(/\r?\n/g, eol);
        const prefix = raw.length && !raw.endsWith("\n") ? eol : "";
        fs.writeFileSync(item.file, raw + prefix + body);
      }
      console.log(`  已追加 ${rel(item.file)}`);
    } else {
      const { lines, eol } = readLines(item.file);
      const drop = new Set(item.ranges.map((r) => r.start));
      const kept = lines.filter((_, i) => !drop.has(i));
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
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
console.log("接线完成。若尚未安装 plugin 本体，在专案根执行：");
console.log("  claude plugin install wiki@claude-knowledge-plugin --scope local");
console.log("然后重启 session（或 /reload-plugins），开场应看到「主题索引」注入。");
process.exit(failed.length ? 1 : 0);
