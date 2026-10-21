#!/usr/bin/env node
/* 家账本 · 一键发布到 GitHub Pages
 *
 * 用法：
 *   node tools/publish-github.mjs --dry-run
 *   node tools/publish-github.mjs --token-file C:\Users\Administrator\github-token.txt --repo family-ledger
 *
 * Token 需要有 repo 权限（classic token 勾选 repo 即可）。
 * 脚本只从本地文件读取 Token，不会打印或写入仓库。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.github.com';
const DEFAULT_NAME = 'family-ledger';
const UA = 'family-ledger-publisher';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function printHelp() {
  console.log(`
家账本 · GitHub Pages 发布脚本

用法：
  node tools/publish-github.mjs --dry-run
  node tools/publish-github.mjs --token-file <token文件> [--repo <owner/name>] [--private]

参数：
  --token-file <path>  存放 GitHub Token 的文本文件（只读取一行）
  --repo <owner/name>  目标仓库；只给名称时使用当前登录账号
  --name <name>        仓库不存在时创建的仓库名，默认 ${DEFAULT_NAME}
  --private            创建私有仓库（GitHub Pages 需要付费计划）
  --dry-run            只列出将上传的文件，不联网
  -h, --help           显示帮助

Token 权限：classic token 勾选 repo；fine-grained token 需要 Contents 读写 + Pages 读写。
`);
}

function parseArgs(argv) {
  const opts = {
    name: DEFAULT_NAME,
    private: false,
    dryRun: false,
    repo: null,
    tokenFile: process.env.GITHUB_TOKEN_FILE || null
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--private') opts.private = true;
    else if (arg === '--public') opts.private = false;
    else if (arg === '--name') opts.name = argv[++i];
    else if (arg.startsWith('--name=')) opts.name = arg.slice(7);
    else if (arg === '--repo') opts.repo = argv[++i];
    else if (arg.startsWith('--repo=')) opts.repo = arg.slice(7);
    else if (arg === '--token-file') opts.tokenFile = argv[++i];
    else if (arg.startsWith('--token-file=')) opts.tokenFile = arg.slice(13);
    else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      console.error('未知参数：' + arg);
      printHelp();
      process.exit(2);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

const IGNORED_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.github', '.idea', '.vscode']);
const IGNORED_FILES = new Set([
  'github-token.txt', 'docs/metrics.json', '.DS_Store', 'Thumbs.db',
  '_preview.html', '_preview_modal.html', '_debug.html'
]);
const IGNORED_EXT = new Set(['.zip', '.log', '.tmp']);

function collectFiles(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectFiles(full, base, out);
    } else if (entry.isFile()) {
      if (IGNORED_FILES.has(rel) || IGNORED_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      if (entry.name.startsWith('github-token')) continue;
      out.push({ rel, full, size: fs.statSync(full).size });
    }
  }
}

const files = [];
collectFiles(ROOT, ROOT, files);
files.sort((a, b) => a.rel.localeCompare(b.rel));
files.push({ rel: '.nojekyll', full: null, size: 1, virtual: true });

const total = files.reduce((sum, file) => sum + file.size, 0);
const formatSize = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

if (opts.dryRun) {
  console.log('家账本 · 发布文件预览\n');
  files.forEach((file) => {
    console.log('  ' + String(file.size).padStart(8) + '  ' + file.rel);
  });
  console.log('\n共 ' + files.length + ' 个文件，' + formatSize(total));
  console.log('目标仓库：' + (opts.repo || '<你的账号>/' + opts.name));
  console.log('提示：去掉 --dry-run 并传入 --token-file 即可真正发布。');
  process.exit(0);
}

function fail(message, hint) {
  console.error('\n✗ ' + message);
  if (hint) console.error('  ' + hint);
  process.exit(1);
}

let token = process.env.GITHUB_TOKEN || '';
if (!token) {
  const tokenFile = opts.tokenFile;
  if (!tokenFile) {
    fail('缺少 GitHub Token', '请用 --token-file 指向保存 Token 的文本文件，或设置 GITHUB_TOKEN 环境变量。');
  }
  if (!fs.existsSync(tokenFile)) {
    fail('找不到 Token 文件：' + tokenFile, '请把 Token 单独一行写入该文件后重试。');
  }
  token = fs.readFileSync(tokenFile, 'utf8').trim();
}
if (!token || /\s/.test(token)) {
  fail('Token 格式不正确', 'Token 应该是单独一行、没有空格的字符串。');
}

async function api(method, endpoint, body) {
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': UA
  };
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(API + endpoint, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (err) { data = null; }
  }
  if (!res.ok) {
    const message = data && data.message ? data.message : text.slice(0, 240);
    const error = new Error(method + ' ' + endpoint + ' -> ' + res.status + ': ' + message);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function mapLimit(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

async function main() {
  console.log('家账本 · 发布到 GitHub Pages\n');

  let user;
  try {
    user = await api('GET', '/user');
  } catch (err) {
    if (err.status === 401) fail('Token 无效或已过期', '请重新生成 Token 后重试。');
    throw err;
  }
  console.log('已登录：' + user.login);

  let owner;
  let repoName;
  if (opts.repo) {
    const parts = opts.repo.split('/');
    if (parts.length === 2) {
      owner = parts[0];
      repoName = parts[1];
    } else {
      owner = user.login;
      repoName = parts[0];
    }
  } else {
    owner = user.login;
    repoName = opts.name;
  }

  let repo;
  try {
    repo = await api('GET', '/repos/' + owner + '/' + repoName);
    console.log('使用已有仓库：' + owner + '/' + repoName);
  } catch (err) {
    if (err.status !== 404) throw err;
    if (owner !== user.login) {
      fail('仓库 ' + owner + '/' + repoName + ' 不存在', '请先在 GitHub 上创建它，或改用你自己的账号。');
    }
    console.log('创建仓库：' + owner + '/' + repoName);
    repo = await api('POST', '/user/repos', {
      name: repoName,
      description: '家账本 · 家庭收支明细（PWA）',
      private: !!opts.private,
      auto_init: true,
      has_issues: false,
      has_wiki: false
    });
  }

  const branch = repo.default_branch || 'main';
  let base = null;
  try {
    const ref = await api('GET', '/repos/' + owner + '/' + repoName + '/git/ref/heads/' + branch);
    const commit = await api('GET', '/repos/' + owner + '/' + repoName + '/git/commits/' + ref.object.sha);
    base = { sha: commit.sha, tree: commit.tree.sha };
  } catch (err) {
    if (err.status !== 404 && err.status !== 409) throw err;
    console.log('仓库为空，将创建首次提交');
  }

  console.log('\n上传 ' + files.length + ' 个文件（' + formatSize(total) + '）...');
  const treeEntries = [];
  let uploaded = 0;
  await mapLimit(files, 4, async (file) => {
    const content = file.virtual ? Buffer.from('\n') : fs.readFileSync(file.full);
    const blob = await api('POST', '/repos/' + owner + '/' + repoName + '/git/blobs', {
      content: content.toString('base64'),
      encoding: 'base64'
    });
    treeEntries.push({
      path: file.rel,
      mode: '100644',
      type: 'blob',
      sha: blob.sha
    });
    uploaded += 1;
    process.stdout.write('\r  已上传 ' + uploaded + '/' + files.length);
  });
  process.stdout.write('\n');

  treeEntries.sort((a, b) => a.path.localeCompare(b.path));
  const tree = await api('POST', '/repos/' + owner + '/' + repoName + '/git/trees', {
    tree: treeEntries,
    ...(base ? { base_tree: base.tree } : {})
  });

  const commitBody = {
    message: '发布家账本 · 家庭收支明细',
    tree: tree.sha
  };
  if (base) commitBody.parents = [base.sha];
  const commit = await api('POST', '/repos/' + owner + '/' + repoName + '/git/commits', commitBody);

  if (base) {
    await api('PATCH', '/repos/' + owner + '/' + repoName + '/git/refs/heads/' + branch, {
      sha: commit.sha,
      force: false
    });
  } else {
    await api('POST', '/repos/' + owner + '/' + repoName + '/git/refs', {
      ref: 'refs/heads/' + branch,
      sha: commit.sha
    });
  }
  console.log('提交完成：' + commit.sha.slice(0, 7));

  console.log('\n启用 GitHub Pages...');
  const pagesBody = {
    source: { branch: branch, path: '/' }
  };
  try {
    await api('POST', '/repos/' + owner + '/' + repoName + '/pages', pagesBody);
  } catch (err) {
    if (err.status === 409) {
      await api('PUT', '/repos/' + owner + '/' + repoName + '/pages', pagesBody);
    } else if (err.status === 404) {
      await sleep(2500);
      await api('POST', '/repos/' + owner + '/' + repoName + '/pages', pagesBody);
    } else if (err.status === 422) {
      await api('PUT', '/repos/' + owner + '/' + repoName + '/pages', pagesBody);
    } else {
      throw err;
    }
  }

  const fallbackUrl = 'https://' + owner.toLowerCase() + '.github.io/' + repoName + '/';
  let pageUrl = fallbackUrl;
  let ready = false;

  console.log('等待构建（通常 1-3 分钟）...');
  for (let attempt = 0; attempt < 60; attempt++) {
    let info = null;
    try {
      info = await api('GET', '/repos/' + owner + '/' + repoName + '/pages');
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    if (info && info.html_url) pageUrl = info.html_url.endsWith('/') ? info.html_url : info.html_url + '/';
    if (info && info.status === 'errored') {
      throw new Error('GitHub Pages 构建失败：' + JSON.stringify(info));
    }

    try {
      const check = await fetch(pageUrl + '?__check=' + Date.now(), {
        headers: { 'User-Agent': UA },
        cache: 'no-store'
      });
      if (check.ok) {
        const html = await check.text();
        if (html.indexOf('家账本') >= 0) {
          ready = true;
          break;
        }
      }
    } catch (err) {
      // 构建期间 404 / 网络抖动都继续等
    }

    process.stdout.write('.');
    await sleep(5000);
  }
  process.stdout.write('\n');

  if (!ready) {
    console.log('\n页面还没有准备好，稍后手动打开：' + pageUrl);
    console.log('也可以在仓库 Settings → Pages 查看构建状态。');
    return;
  }

  const manifest = await fetch(pageUrl + 'manifest.json', { cache: 'no-store' });
  const worker = await fetch(pageUrl + 'sw.js', { cache: 'no-store' });

  console.log('\n✓ 发布成功');
  console.log('  网址：' + pageUrl);
  console.log('  仓库：https://github.com/' + owner + '/' + repoName);
  console.log('  manifest：' + manifest.status + '   sw.js：' + worker.status);
  if (!manifest.ok || !worker.ok) {
    console.log('  注意：PWA 文件暂时未就绪，稍等片刻后刷新页面。');
  }
  console.log('\n手机打开上面的网址，即可“添加到主屏幕 / 安装应用”。');
  console.log('发布完成后建议到 GitHub 设置中撤销本次使用的 Token。');
}

main().catch((err) => {
  console.error('\n✗ 发布失败：' + err.message);
  if (err.status === 401) {
    console.error('  Token 无效或已过期。');
  } else if (err.status === 403) {
    console.error('  Token 权限不足，或触发了 GitHub 速率限制。classic token 需要勾选 repo。');
  } else if (err.status === 404) {
    console.error('  仓库或资源不存在；如果刚创建仓库，请等待几秒后重试。');
  }
  process.exit(1);
});
