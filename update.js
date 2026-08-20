#!/usr/bin/env node
// 一键发布：bump patch 版本 -> marketplace update -> 各项目 plugin update
// 用法：node update.js
// 要更新哪些项目，写在 projects.local.txt（一行一个项目根目录，不进 git）

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const MANIFEST = path.join(ROOT, 'plugins', 'wiki', '.claude-plugin', 'plugin.json');
const PROJECTS_FILE = path.join(ROOT, 'projects.local.txt');

function run(cmd, cwd) {
  console.log(`\n$ ${cmd}${cwd ? `  (cwd: ${cwd})` : ''}`);
  execSync(cmd, { stdio: 'inherit', shell: true, cwd: cwd || ROOT });
}

// 1. bump patch 版本
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const parts = manifest.version.split('.').map(Number);
parts[2] += 1;
const newVersion = parts.join('.');
console.log(`version: ${manifest.version} -> ${newVersion}`);
manifest.version = newVersion;
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

// 2. 刷新 marketplace（全机一次）
run('claude plugin marketplace update claude-knowledge-plugin');

// 3. 逐项目更新（local scope 依附于项目，必须在项目目录下执行）
if (!fs.existsSync(PROJECTS_FILE)) {
  console.error(`\n缺 ${PROJECTS_FILE}：一行一个项目根目录路径。已 bump + marketplace update，项目侧请手动跑：`);
  console.error('  claude plugin update wiki@claude-knowledge-plugin --scope local');
  process.exit(1);
}
const projects = fs
  .readFileSync(PROJECTS_FILE, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

for (const dir of projects) {
  if (!fs.existsSync(dir)) {
    console.error(`跳过（目录不存在）: ${dir}`);
    continue;
  }
  run('claude plugin update wiki@claude-knowledge-plugin --scope local', dir);
}

console.log(`\n完成：v${newVersion} 已发布到 ${projects.length} 个项目。重启 session（或 /reload-plugins）生效。`);
