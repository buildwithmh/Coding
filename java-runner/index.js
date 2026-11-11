'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const PORT = 3100, TOKEN = process.env.JAVA_RUNNER_TOKEN || '', MAX = 128 * 1024;
function run(bin, args, cwd, input = '') {
  return new Promise(resolve => {
    const child = spawn(bin, args, { cwd, env: { PATH: process.env.PATH, HOME: cwd, LANG: 'C.UTF-8' }, stdio: ['pipe','pipe','pipe'] });
    let output = '', error = '', done = false, timeout = false, overflow = false;
    const finish = data => { if (done) return; done = true; clearTimeout(timer); resolve(data); };
    const timer = setTimeout(() => { timeout = true; child.kill('SIGKILL'); }, 8000);
    const collect = (old, chunk, stream) => { const next = old + chunk.toString('utf8'); if (Buffer.byteLength(next) > MAX) { overflow = true; child.kill('SIGKILL'); return old; } return next; };
    child.stdout.on('data', d => { output = collect(output,d); }); child.stderr.on('data', d => { error = collect(error,d); });
    child.on('error', e => finish({ exitCode: 1, output, error: e.message }));
    child.on('close', code => finish({ exitCode: code ?? 1, output, error: timeout ? 'Execution exceeded 8 seconds.' : overflow ? 'Output exceeded 128 KB.' : error, timedOut: timeout, overflow }));
    child.stdin.end(String(input).slice(0,16000));
  });
}
const server = http.createServer(async (req,res) => {
  res.setHeader('content-type','application/json; charset=utf-8');
  if (req.method === 'GET' && req.url === '/health') { res.end(JSON.stringify({ok:true,java:'OpenJDK 17'})); return; }
  if (req.method !== 'POST' || req.url !== '/run') { res.writeHead(404); res.end(JSON.stringify({ok:false,error:'Not found'})); return; }
  if (!TOKEN || req.headers['x-runner-token'] !== TOKEN) { res.writeHead(403); res.end(JSON.stringify({ok:false,error:'Forbidden'})); return; }
  let raw=''; for await (const chunk of req) { raw += chunk; if (raw.length > MAX + 20000) { res.writeHead(413); res.end(JSON.stringify({ok:false,error:'Request too large'})); return; } }
  let body; try { body=JSON.parse(raw); } catch { res.writeHead(400); res.end(JSON.stringify({ok:false,error:'Invalid JSON'})); return; }
  const filename=body.filename, code=body.code;
  if (typeof filename !== 'string' || !/^[A-Za-z_$][\w$]*\.java$/.test(filename) || typeof code !== 'string' || !code.trim() || Buffer.byteLength(code)>MAX) { res.writeHead(400); res.end(JSON.stringify({ok:false,error:'Invalid Java filename or source.'})); return; }
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mhcoder-java-'));
  try {
    await fs.writeFile(path.join(dir,filename),code,{mode:0o600});
    const compile=await run('javac',['-encoding','UTF-8','-proc:none',filename],dir);
    if (compile.exitCode !== 0) { res.end(JSON.stringify({ok:true,...compile,phase:'compile'})); return; }
    const execution=await run('java',['-Xms16m','-Xmx96m','-XX:MaxMetaspaceSize=64m','-Djava.awt.headless=true','-cp',dir,filename.slice(0,-5)],dir,body.input||'');
    res.end(JSON.stringify({ok:true,...execution,phase:'run'}));
  } catch(e) { res.writeHead(500); res.end(JSON.stringify({ok:false,error:e.message})); }
  finally { await fs.rm(dir,{recursive:true,force:true}); }
});
server.listen(PORT,'0.0.0.0',()=>process.stdout.write(`Java runner listening on ${PORT}\n`));
