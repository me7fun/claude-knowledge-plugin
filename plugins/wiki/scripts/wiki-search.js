/**
 * wiki-search.js — 知识页搜索（tag / 全文）
 *
 * 用法：
 *   node wiki-search.js <关键字...>            # 全文（固定字串、不分大小写）
 *   node wiki-search.js -t <tag>               # tag 过滤
 *   node wiki-search.js -t <tag> <关键字...>   # tag + 全文
 *   node wiki-search.js --outline [-t <tag>]   # 不搜索：列出每页的小节标题（行号＋行数）
 *
 * 多个关键字＝任一命中即算（OR）；要比对含空白的整句，用引号包成一个参数。
 * 命中越多关键字的页排越前——提案前查重时把同义词/别名一起丢进来。
 *
 * 永远排除：index*.md 与设定档 excludeFromLint 清单。
 * 输出：相对路径 + title + tags + 各命中行（按所属小节标题分组，带行号）。
 * --outline 是即时从页面算出来的小节地图，不需维护——/wiki:audit 重复盘点用它定位。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { projectRoot, loadConfig, parseFrontmatter } = require("./wiki-lib");

function listMarkdown(rootDir) {
  const out = [];
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
      else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(full);
    }
  })(rootDir);
  return out;
}

const MAX_LINES_PER_PAGE = 12;
const MAX_LINE_CHARS = 160;
const HEADING_RE = /^#{1,6}[ \t]+\S/;
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;

/** 逐行找命中，记下每行所属的小节标题（code fence 内的 # 不算标题） */
function findHits(text, terms) {
  const hits = [];
  let section = "";
  let inFence = false;
  let lineNo = 0;
  for (const line of text.split("\n")) {
    lineNo++;
    if (FENCE_RE.test(line)) inFence = !inFence;
    else if (!inFence && HEADING_RE.test(line)) section = line.trim();
    const lower = line.toLowerCase();
    const matched = terms.filter((t) => lower.includes(t));
    if (matched.length) hits.push({ lineNo, section, text: line.trim(), matched });
  }
  return hits;
}

/** 列出页内所有标题：行号＋该小节到下一个标题前的行数（code fence 内的 # 不算） */
function outlineOf(text) {
  const lines = text.split("\n");
  const heads = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE_RE.test(line)) inFence = !inFence;
    else if (!inFence && HEADING_RE.test(line)) heads.push({ lineNo: i + 1, text: line.trim() });
  });
  heads.forEach((h, i) => {
    h.size = (i + 1 < heads.length ? heads[i + 1].lineNo : lines.length + 1) - h.lineNo;
  });
  return heads;
}

function main() {
  const args = process.argv.slice(2);
  let tag = "";
  let outline = false;
  const queryParts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-t" || args[i] === "--tag") {
      tag = args[++i] || "";
    } else if (args[i] === "--outline") {
      outline = true;
    } else {
      queryParts.push(args[i]);
    }
  }
  const terms = [...new Set(queryParts.map((q) => q.toLowerCase().trim()).filter(Boolean))];
  if (!tag && !terms.length && !outline) {
    console.log("用法：wiki-search.js [-t tag] [关键字...] | --outline [-t tag]");
    process.exit(1);
  }

  const root = projectRoot();
  const cfg = loadConfig(root);
  const wikiDir = path.join(root, cfg.knowledgeRoot);
  if (!fs.existsSync(wikiDir)) {
    console.error(`知识库目录不存在：${wikiDir}`);
    process.exit(1);
  }

  const excludes = cfg.excludeFromLint || [];
  const files = listMarkdown(wikiDir).filter((f) => {
    const rel = path.relative(wikiDir, f).replace(/\\/g, "/");
    if (/^index([.-].*)?\.md$/i.test(rel)) return false;
    for (const ex of excludes) {
      if (ex.endsWith("/")) {
        if (rel.startsWith(ex)) return false;
      } else if (rel === ex) return false;
    }
    return true;
  });

  if (outline) {
    let pages = 0;
    let sections = 0;
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      const front = parseFrontmatter(text) || {};
      const tags = Array.isArray(front.tags) ? front.tags : [];
      if (tag && !tags.map((t) => String(t).toLowerCase()).includes(tag.toLowerCase())) continue;
      const heads = outlineOf(text);
      pages++;
      sections += heads.length;
      const meta = [front.type, front.title].filter(Boolean).join("｜");
      console.log(path.relative(root, f).replace(/\\/g, "/") + (meta ? `  （${meta}）` : ""));
      for (const h of heads) console.log(`  ${h.lineNo}: ${h.text}  [${h.size} 行]`);
      console.log("");
    }
    console.log(pages ? `共 ${pages} 页、${sections} 个小节` : tag ? `没有页面带 tag: ${tag}` : "知识库没有页面");
    return;
  }

  const results = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const front = parseFrontmatter(text) || {};
    const tags = Array.isArray(front.tags) ? front.tags : [];

    if (tag && !tags.map((t) => String(t).toLowerCase()).includes(tag.toLowerCase())) continue;

    const hits = terms.length ? findHits(text, terms) : [];
    if (terms.length && !hits.length) continue;

    const matchedTerms = terms.filter((t) => hits.some((h) => h.matched.includes(t)));
    results.push({ rel: path.relative(root, f).replace(/\\/g, "/"), front, tags, hits, matchedTerms });
  }

  // 命中越多关键字的页排越前，其次看命中行数
  results.sort(
    (a, b) => b.matchedTerms.length - a.matchedTerms.length || b.hits.length - a.hits.length || a.rel.localeCompare(b.rel)
  );

  for (const r of results) {
    const coverage = terms.length > 1 ? `  （命中 ${r.matchedTerms.length}/${terms.length}：${r.matchedTerms.join(", ")}）` : "";
    console.log(r.rel + coverage);
    if (r.front.title) console.log(`  title: ${r.front.title}`);
    if (r.tags.length) console.log(`  tags: [${r.tags.join(", ")}]`);
    let section = null;
    for (const h of r.hits.slice(0, MAX_LINES_PER_PAGE)) {
      if (h.section !== section) {
        section = h.section;
        console.log(`  § ${section || "（首个标题之前）"}`);
      }
      const shown = h.text.length > MAX_LINE_CHARS ? h.text.slice(0, MAX_LINE_CHARS) + "…" : h.text;
      console.log(`    ${h.lineNo}: ${shown}`);
    }
    if (r.hits.length > MAX_LINES_PER_PAGE) console.log(`    …另有 ${r.hits.length - MAX_LINES_PER_PAGE} 行命中`);
    console.log("");
  }
  if (!results.length) console.log(tag && !terms.length ? `没有页面带 tag: ${tag}` : "没有命中");
}

main();
