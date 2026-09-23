const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createStore}=require('./store.cjs');
const valid=require('./validate.cjs');
const password=process.env.ADMIN_PASSWORD, username=process.env.ADMIN_USERNAME||'admin';
if(!password)throw Error('ADMIN_PASSWORD must not be empty');
const production=process.env.NODE_ENV==='production';
const store=createStore(process.env);
const salt=crypto.randomBytes(16), expected=crypto.scryptSync(password,salt,64), sessions=new Map(), attempts=new Map();
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
setInterval(()=>{const now=Date.now();for(const[k,v]of sessions)if(v<now)sessions.delete(k);for(const[k,v]of attempts)if(v.until<now)attempts.delete(k);},60000).unref();
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
async function body(req){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>22*1024*1024)throw Error('too large');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString());}
const server=http.createServer(async(req,res)=>{
res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
try{
const url=new URL(req.url,'http://localhost');
if(req.method==='GET'&&url.pathname==='/healthz')return json(res,200,{ok:true});
if(!['GET','HEAD'].includes(req.method)){
const origin=req.headers.origin, expectedOrigin=process.env.APP_ORIGIN||`${production?'https':'http'}://${req.headers.host}`;
if(origin!==expectedOrigin||!String(req.headers['content-type']).startsWith('application/json'))return json(res,403,{error:'잘못된 요청 출처입니다.'});
}
const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('session='))?.slice(8)||'';
const authenticated=(sessions.get(hash(token))||0)>Date.now();
if(req.method==='POST'&&url.pathname==='/api/login'){
// A global bound is intentional for this single-owner service; no proxy IP trust is needed.
const key='owner', now=Date.now(), a=attempts.get(key);
if(a&&a.until>now&&a.count>=10)return json(res,429,{error:'로그인 시도가 많습니다. 15분 뒤 다시 시도하세요.'});
const input=await body(req);if(typeof input.password!=='string'||input.password.length>1024)return json(res,400,{error:'입력값 오류'});
const ok=crypto.timingSafeEqual(crypto.scryptSync(input.password,salt,64),expected)&&input.username===username;
if(!ok){attempts.set(key,{count:(a&&a.until>now?a.count:0)+1,until:a&&a.until>now?a.until:now+900000});return json(res,401,{error:'아이디 또는 비밀번호가 올바르지 않습니다.'});}
attempts.delete(key);const value=crypto.randomBytes(32).toString('hex');if(sessions.size>=100)sessions.delete(sessions.keys().next().value);sessions.set(hash(value),now+8*3600000);
res.setHeader('Set-Cookie',`session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${production?'; Secure':''}`);return json(res,200,{ok:true});
}
if(req.method==='GET'&&['/login','/login.js'].includes(url.pathname)){const file=url.pathname==='/login'?'login.html':'login.js';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');return res.end(fs.readFileSync(path.join(__dirname,'public',file)));}
if(!authenticated){if(url.pathname.startsWith('/api/'))return json(res,401,{error:'로그인이 필요합니다.'});res.writeHead(302,{Location:'/login'});return res.end();}
if(req.method==='POST'&&url.pathname==='/api/logout'){sessions.delete(hash(token));res.setHeader('Set-Cookie',`session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production?'; Secure':''}`);return json(res,200,{ok:true});}
if(req.method==='GET'&&url.pathname==='/api/data')return json(res,200,await store.read());
if(req.method==='PUT'&&url.pathname==='/api/data'){
const input=await body(req);let good=false;try{good=Number.isSafeInteger(input.revision)&&valid(input.data);}catch{}
if(!good)return json(res,400,{error:'저장할 데이터의 형식이 올바르지 않습니다.'});
const revision=await store.save(input.data,input.revision);
if(revision===null)return json(res,409,{error:'다른 창 또는 기기에서 기록이 변경되었습니다. 덮어쓰기를 방지했습니다.'});
return json(res,200,{revision});
}
const files={'/':'index.html','/app.js':'app.js'};
if(req.method==='GET'&&files[url.pathname]){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');return res.end(fs.readFileSync(path.join(__dirname,'public',files[url.pathname])));}
json(res,404,{error:'찾을 수 없습니다.'});
}catch(e){json(res,503,{error:'요청 처리에 실패했습니다. 잠시 후 다시 시도하세요. 저장 성공 안내 전에는 창을 닫지 마세요.'});}
});
store.init().then(()=>server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Student manager ready'))).catch(()=>{console.error('Database initialization failed. Check DATABASE_URL and Neon project status.');process.exit(1);});
