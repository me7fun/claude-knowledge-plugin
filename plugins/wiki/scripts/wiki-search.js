/**
 * wiki-search.js — 知识页搜索（tag / 全文）
 *
 * 用法：
 *   node wiki-search.js <关键字...>            # 全文（固定字串、不分大小写）
 *   node wiki-search.js -t <tag>               # tag 过滤
 *   node wiki-search.js -t <tag> <关键字...>   # tag + 全文
 *
 * 永远排除：index*.md 与设定档 excludeFromLint 清单。
 * 输出：相对路径 + title + tags + 首个命中行。
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

function main() {
  const args = process.argv.slice(2);
  let tag = "";
  const queryParts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-t" || args[i] === "--tag") {
      tag = args[++i] || "";
    } else {
      queryParts.push(args[i]);
    }
  }
  const query = queryParts.join(" ");
  if (!tag && !query) {
    console.log("用法：wiki-search.js [-t tag] [关键字...]");
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

  let hits = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const front = parseFrontmatter(text) || {};
    const tags = Array.isArray(front.tags) ? front.tags : [];

    if (tag && !tags.map((t) => String(t).toLowerCase()).includes(tag.toLowerCase())) continue;

    let matchLine = "";
    if (query) {
      const q = query.toLowerCase();
      let lineNo = 0;
      for (const line of text.split("\n")) {
        lineNo++;
        if (line.toLowerCase().includes(q)) {
          matchLine = `${lineNo}: ${line.trim()}`;
          break;
        }
      }
      if (!matchLine) continue;
    }

    hits++;
    const rel = path.relative(root, f).replace(/\\/g, "/");
    console.log(rel);
    if (front.title) console.log(`  title: ${front.title}`);
    if (tags.length) console.log(`  tags: [${tags.join(", ")}]`);
    if (matchLine) console.log(`  match: ${matchLine}`);
    console.log("");
  }
  if (!hits) console.log(tag && !query ? `没有页面带 tag: ${tag}` : "没有命中");
}

main();
