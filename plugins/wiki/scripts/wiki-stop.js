/**
 * wiki-stop.js — commit 闸门（移植自 llm-project-wiki 的 wiki_stop_hook.py，改 Node）
 *
 * 两个模式共用一个 session 状态档（os.tmpdir()/wiki-stop-<hash>.json）：
 *
 *   mark-commit 模式（PostToolUse，matcher Bash|PowerShell）：
 *     监看实际执行过的指令，跑了 `git commit` 就在状态档立 pending_commit 旗标。
 *     只认「真的执行了 commit」，回复里只是提到 commit 不会触发。
 *
 *   预设模式（Stop）：
 *     有 pending_commit 且最终回复没有评估标记 → 挡下、要求评估。
 *     标记出现 → 清旗标放行。防循环：一轮最多挡 2 次。
 *
 * 接受的标记（须独立成行、在 code fence 外）：
 *   Wiki 建议 / Wiki suggestion       —— 有东西要记（可带冒号接内容）
 *   无需 wiki 更新 / 無需 wiki 更新 / No wiki updates needed —— 评估过、没东西要记
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { readStdinJson } = require("./wiki-lib");

// 「这条 Bash/PowerShell 指令是不是 git commit？」——限定单一 shell 片段
// （[^|&;]* 不跨管线/串接），排除 commit-graph / commit-tree 等 plumbing。
// 先剥引号与反斜线，避免用引号藏 commit。
const COMMIT_RE = /\bgit\b[^|&;]*?\bcommit(?![\w-])/;

// 标记须独立成行（允许引用符、标题符、粗体、冒号后接内容）
const MARKER_RE = new RegExp(
  "^[ \\t]*(?:>[ \\t]*)*(?:#{1,6}[ \\t]+)?(?:\\*\\*)?(?:" +
    "Wiki[ \\t]+suggestion|Wiki[ \\t]*建[議议]|" +
    "No[ \\t]+wiki[ \\t]+updates[ \\t]+needed|[无無]需[ \\t]*wiki[ \\t]*更新" +
    ")(?:\\*\\*)?(?:[ \\t]*[:：].*)?[ \\t]*$",
  "i"
);
const FENCE_RE = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})/;

const MAX_BLOCKS_PER_TURN = 2;

/** 标记须在 code fence 外独立成行 */
function hasMarker(message) {
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  for (const line of String(message).split("\n")) {
    const fence = line.match(FENCE_RE);
    if (fence) {
      const token = fence[1];
      if (!inFence) {
        inFence = true;
        fenceChar = token[0];
        fenceLen = token.length;
      } else if (token[0] === fenceChar && token.length >= fenceLen && !line.slice(line.indexOf(token) + token.length).trim()) {
        inFence = false;
      }
      continue;
    }
    if (!inFence && MARKER_RE.test(line)) return true;
  }
  return false;
}

function isCommitCommand(command) {
  const normalized = String(command).replace(/["'\\]/g, "");
  return COMMIT_RE.test(normalized);
}

/** session 状态档：session key 先杂凑，避免奇形 id 组出目录外路径 */
function stateFile(data) {
  const key = data.session_id || data.transcript_path || "unknown";
  const digest = crypto.createHash("md5").update(String(key)).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), `wiki-stop-${digest}.json`);
}

function readState(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    return { block_count: 0 };
  }
}

function writeState(p, state) {
  try {
    fs.writeFileSync(p, JSON.stringify(state));
  } catch (_) {}
}

/** PostToolUse(Bash|PowerShell)：真的跑了 git commit 才立旗标 */
function markCommit(data) {
  const tool = data.tool_name;
  if (tool !== "Bash" && tool !== "PowerShell") return;
  const input = data.tool_input;
  const command = input && typeof input === "object" ? input.command : "";
  if (typeof command !== "string" || !isCommitCommand(command)) return;
  const p = stateFile(data);
  const state = readState(p);
  state.pending_commit = true;
  writeState(p, state);
}

function handleStop(data) {
  const lastMsg = typeof data.last_assistant_message === "string" ? data.last_assistant_message : "";
  const p = stateFile(data);

  // 1. 有评估标记 → 放行，清旗标与计数
  if (hasMarker(lastMsg)) {
    writeState(p, { block_count: 0 });
    return;
  }

  const state = readState(p);

  // 2. 本 session 没真的 commit 过 → 永不挡
  if (!state.pending_commit) return;

  // 3. 防循环：本轮已挡满 → 放行并重置
  if ((state.block_count || 0) >= MAX_BLOCKS_PER_TURN) {
    writeState(p, { block_count: 0 });
    return;
  }

  // 4. 挡下，要求评估
  state.block_count = (state.block_count || 0) + 1;
  writeState(p, state);
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        "Wiki 评估：本 session 执行过 git commit，但最终回复没有 wiki 评估标记。" +
        "快速评估这轮工作有没有产出值得进知识库的内容（判准见 /wiki:review 的 reference.md）。\n" +
        "- 有 → 以「Wiki 建议」格式提案（目标页、要记什么、来源），等用户同意再写\n" +
        "- 没有 → 独立一行输出「无需 wiki 更新」，让 hook 知道评估做过了",
    })
  );
}

async function main() {
  const mode = process.argv[2] || "";
  const data = await readStdinJson();
  if (!data) {
    process.exit(0); // 输入坏了 → 放行
  }
  if (mode === "mark-commit") {
    markCommit(data);
  } else {
    handleStop(data);
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
