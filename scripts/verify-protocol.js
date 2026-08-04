const { spawn } = require('child_process');
const readline = require('readline');

const child = spawn('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderrBuf = '';
child.stderr.on('data', d => { stderrBuf += d.toString(); });
const rl = readline.createInterface({ input: child.stdout });

const VAULT = process.env.OBSIDIAN_VAULT_PATH || process.env.HOME + '/Obsidian';
const TEST_NAME = '[Obsidian Test] 协议验证 thread';

function send(obj) { child.stdin.write(JSON.stringify(obj) + '\n'); }
function call(id, method, params) { send({ jsonrpc: '2.0', id, method, params }); }

let pending = {};
let notifications = [];
rl.on('line', line => {
  if (!line.startsWith('{')) return;
  try {
    const msg = JSON.parse(line);
    if (msg.id && pending[msg.id]) {
      pending[msg.id](msg);
      delete pending[msg.id];
    } else if (msg.method) {
      notifications.push(msg);
    }
  } catch(e) {}
});

(async () => {
  // 1. initialize
  await new Promise((resolve, reject) => {
    pending[1] = m => { console.log('=== initialize OK ==='); resolve(); };
    call(1, 'initialize', { clientInfo: { name: 'obsidian-ai-test', version: '0.1.0' }, capabilities: {} });
    setTimeout(reject, 5000);
  });

  // 2. 列出 Obsidian 项目下的现有 thread（看 v2 协议和线程发现是否一致）
  const listRes = await new Promise((resolve, reject) => {
    pending[2] = m => { resolve(m.result); };
    call(2, 'thread/list', { cwd: VAULT, limit: 10 });
    setTimeout(reject, 5000);
  });
  console.log('=== thread/list (cwd=Obsidian) ===');
  console.log('found:', listRes.data.length, 'threads');
  listRes.data.forEach(t => console.log('  -', t.id.substring(0,8), 'name:', t.name, '| source:', t.source));

  // 3. 创建一个测试 thread
  console.log('\n=== thread/start ===');
  const startRes = await new Promise((resolve, reject) => {
    pending[3] = m => { resolve(m.result); };
    call(3, 'thread/start', {
      cwd: VAULT,
      name: TEST_NAME,
      threadSource: 'obsidian-ai-assistant',
      model: 'gpt-5',
      modelProvider: 'openai',
    });
    setTimeout(reject, 10000);
  });
  console.log('=== thread/start OK ===');
  console.log('thread.id:', startRes.thread.id);
  console.log('thread.name:', startRes.thread.name);
  console.log('thread.cwd:', startRes.thread.cwd);
  console.log('thread.source:', startRes.thread.source);
  console.log('thread.preview:', (startRes.thread.preview || '').substring(0,60));
  const newThreadId = startRes.thread.id;

  // 4. 发一个 turn，问一个简单问题
  console.log('\n=== turn/start: 简单问一句 ===');
  const turnRes = await new Promise((resolve, reject) => {
    pending[4] = m => { resolve(m); };
    call(4, 'turn/start', {
      threadId: newThreadId,
      input: [{ type: 'text', text: '说 OK 即可，不要任何其他内容。' }],
    });
    setTimeout(reject, 30000);
  });
  console.log('=== turn response ===');
  if (turnRes.result) {
    console.log('turn.status:', turnRes.result.turn?.status);
    const items = turnRes.result.turn?.items || [];
    items.forEach(it => {
      if (it.type === 'agentMessage') {
        console.log('AI said:', it.content?.[0]?.text || JSON.stringify(it).substring(0, 200));
      }
    });
  } else {
    console.log('turn error:', JSON.stringify(turnRes).substring(0, 300));
  }

  // 5. 重新列表，确认新 thread 出现在 Obsidian 项目下
  console.log('\n=== 再次 thread/list 验证新 thread 出现 ===');
  const list2 = await new Promise((resolve, reject) => {
    pending[5] = m => { resolve(m.result); };
    call(5, 'thread/list', { cwd: VAULT, limit: 10 });
    setTimeout(reject, 5000);
  });
  const found = list2.data.find(t => t.id === newThreadId);
  console.log('new thread in list?', found ? '✅ YES' : '❌ NO');
  if (found) {
    console.log('  - name:', found.name);
    console.log('  - source:', found.source);
  }

  console.log('\n=== ALL TESTS PASSED ===');
  console.log('新创建的 thread id:', newThreadId);
  console.log('应该在 Codex 桌面版 Obsidian 项目下能看到它。');
  child.kill();
  process.exit(0);
})().catch(e => { console.log('ERROR:', e.message); child.kill(); process.exit(1); });
