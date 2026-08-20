/**
 * wiki-lib.js — wiki plugin 共用函式库
 *
 * 所有脚本共用：专案根解析、设定档读取、frontmatter 解析、索引表解析、stdin 读取。
 * 路径规则：本 plugin 不写死任何专案路径——专案侧设定在 <project>/.claude/wiki.config.json。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/** 解析专案根：优先 CLAUDE_PROJECT_DIR，退回 git rev-parse，再退回 cwd */
function projectRoot() {
  const env = process.env.CLAUDE_PROJECT_DIR;
  if (env && fs.existsSync(env)) return env;
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (out) return out;
  } catch (_) {}
  return process.cwd();
}

const DEFAULT_CONFIG = {
  // 知识库根目录（OKF bundle 根），相对专案根
  knowledgeRoot: "docs",
  // 进度/待办目录，相对专案根
  stateDir: ".claude/state",
  // lint 排除清单（相对 knowledgeRoot；目录以 / 结尾表示整棵排除）
  excludeFromLint: ["ASSET_INDEX.md", "GAME_LIST.md", "wip/", "_archive/"],
  // 写入政策：require_approval = 知识页写入前须提案并经用户同意
  writePolicy: "require_approval",
};

/** 读专案侧设定（.claude/wiki.config.json），缺档或坏档一律回预设（fail-safe） */
function loadConfig(root) {
  const p = path.join(root, ".claude", "wiki.config.json");
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return Object.assign({}, DEFAULT_CONFIG, raw && typeof raw === "object" ? raw : {});
  } catch (_) {
    return Object.assign({}, DEFAULT_CONFIG);
  }
}

/**
 * 解析 YAML frontmatter（宽容的子集解析，不引第三方库）。
 * 支持：key: value、key: [a, b]、块列表（- item）。回 null 表示没有 frontmatter。
 */
function parseFrontmatter(text) {
  const t = text.replace(/^﻿/, "");
  if (!t.startsWith("---")) return null;
  const end = t.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = t.slice(3, end);
  const data = {};
  let currentKey = null;
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const v = kv[2].trim();
      if (v === "") {
        data[currentKey] = [];
      } else if (v.startsWith("[") && v.endsWith("]")) {
        data[currentKey] = v
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      } else {
        data[currentKey] = v.replace(/^['"]|['"]$/g, "");
      }
    } else if (/^\s+-\s+/.test(line) && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(line.replace(/^\s+-\s+/, "").trim().replace(/^['"]|['"]$/g, ""));
    }
  }
  return data;
}

/**
 * 解析 index.md 的主题表。
 * 表格式：| 主题 | 页数 | 子索引 | 关键字 |，表头以 |---| 分隔列判定（语言无关）。
 *
 * index.md 里可能有多个表（如 type 说明表）——先把连续的 | 行切成一个个表，
 * 只取「至少一列的子索引栏含 index-*.md 连结」的那些表的资料列，
 * 避免把说明表误当主题表。
 *
 * 回 [{ theme, count, link, keywords }]
 */
function parseIndexTable(text) {
  // 1. 切表：连续的 | 开头行为一个表
  const tables = [];
  let current = null;
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (s.startsWith("|")) {
      if (!current) {
        current = [];
        tables.push(current);
      }
      current.push(s);
    } else {
      current = null;
    }
  }

  // 2. 每个表独立解析（跳过表头与 |---| 分隔列）
  const rows = [];
  for (const table of tables) {
    const tableRows = [];
    let seenSep = false;
    for (const s of table) {
      if (!seenSep) {
        if (/^[|\-: ]+$/.test(s)) seenSep = true;
        continue;
      }
      const cells = s
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      if (cells.length < 3) continue;
      tableRows.push({
        theme: cells[0],
        count: cells[1],
        link: cells[2],
        keywords: cells[3] || "",
      });
    }
    // 3. 只收「像主题表」的表：至少一列的子索引栏含 index-*.md
    if (tableRows.some((r) => /index-[a-z0-9-]+\.md/.test(r.link))) {
      rows.push(...tableRows);
    }
  }
  return rows;
}

/**
 * 读 stdin 全文（hook 输入是一段 JSON），回 Promise。
 *
 * 不用 fs.readFileSync(0)——Windows 管道下同步读 fd 0 会失败（实测回 null）。
 * 改事件式累积；stdin 若迟迟不结束（不该发生），2 秒保险后按已收内容解析。
 */
function readStdinJson() {
  return new Promise((resolve) => {
    let raw = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        const data = JSON.parse(raw);
        resolve(data && typeof data === "object" ? data : null);
      } catch (_) {
        resolve(null);
      }
    };
    try {
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => {
        raw += c;
      });
      process.stdin.on("end", finish);
      process.stdin.on("error", finish);
      const t = setTimeout(finish, 2000);
      if (t.unref) t.unref();
    } catch (_) {
      finish();
    }
  });
}

/** 路径正规化：反斜线转正斜线、连续斜线压一、小写（Windows 大小写不敏感） */
function normPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

module.exports = {
  projectRoot,
  loadConfig,
  parseFrontmatter,
  parseIndexTable,
  readStdinJson,
  normPath,
  DEFAULT_CONFIG,
};
