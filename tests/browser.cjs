const {chromium}=require('playwright');
const fs=require('node:fs'), http=require('node:http'), path=require('node:path'), assert=require('node:assert/strict');
(async()=>{
 const root=path.join(__dirname,'../public');
 const server=http.createServer((req,res)=>{const file=path.join(root,req.url==='/'?'index.html':req.url.split('?')[0]);if(!file.startsWith(root)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser; try { browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || undefined}); } catch(e) { server.close(); throw e; }
 try{
 const page=await browser.newPage({acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 let row=null, conflict=false, networkFail=false, loseResponse=false, count=0;
 await page.route('https://testproject.supabase.co/**',async route=>{
   const req=route.request(),url=req.url();
   if(networkFail && url.includes('/rpc/'))return route.abort();
   let data;
   if(url.includes('/token?')) data={access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',email:'tester@example.com'}};
   else if(url.includes('gradebook_documents'))data=row?[row]:[];
   else if(url.includes('/rpc/')){
     const body=req.postDataJSON();count++;
     if(conflict || (row && row.revision!==body.expected_revision && row.revision!==body.new_revision))return route.fulfill({status:400,json:{message:'REVISION_CONFLICT'}});
     row={revision:body.new_revision,payload:body.document};data=row.revision;
     if(loseResponse){loseResponse=false;return route.abort();}
   }else data={};
   await route.fulfill({json:data});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('#schoolName').fill('테스트학교');await page.locator('#schoolForm button').click();
 await page.locator('#tab-school').click();await page.locator('#className').fill('1반');await page.locator('#classForm button').click();
 await page.locator('#studentText').fill('1 시험학생\n2 가상학생');await page.locator('#studentForm button').click();
 await page.locator('#tab-evals').click();await page.locator('#evalName').fill('발표');await page.locator('#evalMax').fill('5');await page.locator('#evalForm button').click();
 await page.locator('#tab-rubrics').click();await page.getByRole('button',{name:'+ 기준 추가',exact:true}).click();
 await page.locator('[data-field=name]').fill('내용');await page.getByRole('button',{name:'루브릭 저장',exact:true}).click();
 await page.locator('#tab-grading').click();await page.locator('#gradeContent select').first().selectOption('0');
 await page.locator('summary').click();await page.locator('#serverUrl').fill('https://testproject.supabase.co');await page.locator('#publicKey').fill('sb_publishable_test');await page.locator('#loginEmail').fill('tester@example.com');await page.locator('#loginPassword').fill('test-password');await page.locator('#cloudLogin button').click();
 await page.locator('#cloudFirst').click();await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.startsWith('서버 저장 완료'));
 assert.equal(row.payload.schools[0].data.evaluations[0].scores[Object.keys(row.payload.schools[0].data.evaluations[0].scores)[0]][0],0);
 await page.locator('#gradeContent select').first().selectOption('5');await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.startsWith('서버 저장 완료'));
 assert.ok(count>=2);
 networkFail=true;await page.locator('#gradeContent select').first().selectOption('3');await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('서버 미저장'));
 assert.ok(await page.evaluate(()=>localStorage.getItem('performance-rubric-v4').includes('[3]')));
 networkFail=false;await page.locator('#cloudRetry').click();await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.startsWith('서버 저장 완료'));
 // Lost response must retry the same revision successfully without a false conflict.
 loseResponse=true;await page.locator('#gradeContent select').first().selectOption('4');await page.waitForFunction(()=>document.querySelector('#saveState').textContent.includes('서버 미저장'));
 const lostRevision=row.revision;await page.locator('#cloudRetry').click();await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.startsWith('서버 저장 완료'));assert.equal(row.revision,lostRevision);
 conflict=true;await page.locator('#gradeContent select').first().selectOption('0');await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('다른 기기'));
 const savedRevision=row.revision;await page.locator('#cloudRetry').click();assert.equal(row.revision,savedRevision);conflict=false;
 const downloaded=page.waitForEvent('download');await page.locator('#fullBackup').click();const download=await downloaded;const backup=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(backup.format,'gradebook-backup');
 await page.locator('#importBackup').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(()=>document.querySelector('main').inert===false);
 const before=await page.evaluate(()=>localStorage.getItem('performance-rubric-v4'));
 await page.locator('#importBackup').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":99}')});await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.includes('손상'));assert.equal(await page.evaluate(()=>localStorage.getItem('performance-rubric-v4')),before);
 await page.locator('#cloudLoad').click();await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.startsWith('서버 자료 불러옴'));
 await page.screenshot({path:path.join(require('node:os').tmpdir(),'gradebook-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(require('node:os').tmpdir(),'gradebook-mobile.png'),fullPage:true});
 await page.locator('#cloudLogout').click();await page.waitForFunction(()=>document.querySelector('#cloudStatus').textContent.startsWith('로그아웃'));assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('performance-rubric-v4')).schools.length),0);
 assert.deepEqual(errors,[]);
 // Standalone app loads with no network and retains backup features.
 const offline=await browser.newPage();await offline.context().setOffline(true);const offlineErrors=[];offline.on('pageerror',e=>offlineErrors.push(e.message));
 await offline.goto('file:///'+path.join(__dirname,'../오프라인-실행.html').replace(/\\/g,'/'));await offline.locator('#schoolName').fill('오프라인학교');await offline.locator('#schoolForm button').click();assert.equal(await offline.locator('#schoolList h3').textContent(),'오프라인학교');assert.deepEqual(offlineErrors,[]);
 console.log('PASS: grading, first save, auto-save, network failure/retry, lost-response idempotency, conflict protection, backup export/import, malformed import, cloud reload, logout, offline file.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
