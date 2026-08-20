/**
 * wiki-memory-gate.js — PreToolUse 闸门：拦截写入 Claude memory 的 Write/Edit
 *
 * 背景（计划 Q1 方案 A）：本专案的知识只有一份正本（repo 的知识库），
 * 进度写 .claude/state/，Claude memory 已停用（既存 feedback 类除外）。
 * 系统预设仍会指示 agent 写 memory，所以规则之外要有这道闸门。
 *
 * 判定：Write / Edit 的 file_path 落在 <home>/.claude/projects/<任一专案>/memory/
 * 底下 → deny 并说明该写去哪。其他一律静默放行（无输出、exit 0）。
 *
 * 范围刻意窄：只挡 Write/Edit。删除/清理 memory 是允许方向（迁移与清理本来就要做），
 * Bash 写入侦测是漏水的半吊子（上游已证），不做。
 */

"use strict";

const { readStdinJson, normPath } = require("./wiki-lib");

// 任一专案的 memory 目录（不只本专案——从这里写别专案的 memory 同样不该发生）
const MEMORY_PATH_RE = /\/\.claude\/projects\/[^/]+\/memory\//;

async function main() {
  const data = await readStdinJson();
  if (!data) process.exit(0);

  if (data.tool_name !== "Write" && data.tool_name !== "Edit") process.exit(0);

  const input = data.tool_input;
  const filePath = input && typeof input === "object" ? input.file_path : "";
  if (typeof filePath !== "string" || !filePath) process.exit(0);

  // 结尾补 / 让「目录本身」也能命中；normPath 统一斜线与大小写
  const norm = normPath(filePath) + (filePath.endsWith("/") || filePath.endsWith("\\") ? "" : "");
  if (!MEMORY_PATH_RE.test(norm)) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "memory 已停用（知识系统 Q1 方案 A）。这份内容改写到正确位置：" +
          "专案知识 → 知识库（先以「Wiki 建议」提案，经同意后写入 docs/ 并同步索引）；" +
          "任务进度/待办 → .claude/state/；" +
          "与用户的合作规则（feedback 类）→ 先询问用户是否要记、记在哪。",
      },
    })
  );
  process.exit(0);
}

main().catch(() => process.exit(0));
