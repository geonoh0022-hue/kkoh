const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
test('authentication, validation, persistence and concurrent update protection',async()=>{
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'student-manager-'));
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const base=`http://127.0.0.1:${port}`;let child;
async function start(){child=spawn(process.execPath,['server.cjs'],{cwd:__dirname,env:{...process.env,PORT:String(port),DATA_DIR:dir,NODE_ENV:'test',ADMIN_PASSWORD:'a'}});await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('Exited '+code)));child.once('error',reject);});}
async function stop(){if(!child||child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
async function call(url,method='GET',value,cookie='',origin=base){return fetch(base+url,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie},...(value?{body:JSON.stringify(value)}:{})});}
async function login(){const r=await call('/api/login','POST',{username:'admin',password:'a'});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/);return r.headers.get('set-cookie').split(';')[0];}
try{await start();assert.equal((await call('/api/data')).status,401);assert.equal((await call('/api/login','POST',{username:'admin',password:'wrong'})).status,401);
const cookie=await login();assert.equal((await call('/api/data','PUT',{},cookie,'https://other.invalid')).status,403);
assert.equal((await call('/api/data','PUT',{revision:0,data:{version:2}},cookie)).status,400);
const data={version:2,classes:[{id:'c1',year:'2026',name:'2학년 3반'}],students:[{id:'s1',name:'테스트 학생',number:'1',className:'2학년 3반',classId:'c1'}],records:[{id:'r1',studentId:'s1',category:'학생 상담',date:'2026-09-23',title:'테스트',body:'저장 확인',method:'전화',target:'',attendance:'지각'}]};
assert.equal((await call('/api/data','PUT',{revision:0,data},cookie)).status,200);
assert.equal((await call('/api/data','PUT',{revision:0,data},cookie)).status,409);
assert.deepEqual((await (await call('/api/data','GET',null,cookie)).json()).data,data);
assert.equal((await call('/api/logout','POST',{},cookie)).status,200);assert.equal((await call('/api/data','GET',null,cookie)).status,401);
await stop();await start();const cookie2=await login();const saved=await(await call('/api/data','GET',null,cookie2)).json();assert.deepEqual(saved.data,data);assert.equal(saved.revision,1);
const page=await(await call('/','GET',null,cookie2)).text();assert.match(page,/id="app" hidden/);assert.match(page,/src="\/app.js"/);
for(let i=0;i<10;i++)assert.equal((await call('/api/login','POST',{username:'admin',password:'wrong'})).status,401);
assert.equal((await call('/api/login','POST',{username:'admin',password:'wrong'})).status,429);
}finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
});

