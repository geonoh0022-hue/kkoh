'use strict';
(() => {
  let session = null, config = null, revision = null, enabled = false;
  let debounce, busy = false, pending = false, blocked = false, inFlight = null;
  let remember = false, tabBlocked = false;
  const SESSION_KEY = 'gradebook-session-v1', SYNC_KEY = 'gradebook-sync-v1';
  const readJSON = (storage,key) => { try { return JSON.parse(storage.getItem(key)); } catch { return null; } };
  const status = message => { $('cloudStatus').textContent = message; };
  const empty = () => ({version:4,schools:[],activeSchool:null});
  const copy = () => GradeData.validate(store);
  const lock = value => { document.querySelector('main').inert = value || tabBlocked; };
  const fingerprint = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))))).map(n=>n.toString(16).padStart(2,'0')).join('');
  function saveSession() {
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem(SESSION_KEY,JSON.stringify({url:config.url,session,remember}));
    (remember ? sessionStorage : localStorage).removeItem(SESSION_KEY);
  }
  function resetSession() {
    localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY);
    session = null; enabled = false; clearTimeout(debounce);
    $('loginFields').disabled = false; $('cloudActions').hidden = true;
    $('loginPanel').open = true;
  }
  function authenticated() {
    $('loginFields').disabled = true; $('cloudActions').hidden = false;
    $('loginEmail').value = session.user.email || '';
  }
  async function markSynced(data) {
    localStorage.setItem(SYNC_KEY,JSON.stringify({url:config.url,user:session.user.id,revision,fingerprint:await fingerprint(data)}));
  }
  function download(data, prefix = '수행평가-전체백업') {
    const blob = new Blob([JSON.stringify({format:'gradebook-backup',version:1,createdAt:new Date().toISOString(),data},null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = prefix+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url),10000);
  }
  function replace(data) {
    const clean = GradeData.validate(data);
    // Commit to local storage before changing the UI. If quota fails, keep current data.
    localStorage.setItem(KEY,JSON.stringify(clean));
    store = clean; db = store.schools.find(s => s.id === store.activeSchool)?.data ?? {version:3,classes:[],evaluations:[],active:null};
    activeEval = null; dirty = false;
    $('evalYear').value = cls()?.year ?? new Date().getFullYear(); $('evalGrade').value = cls()?.grade || '1';
    render();
  }
  function readConfig() {
    const url = $('serverUrl').value.trim().replace(/\/$/,'');
    const key = $('publicKey').value.trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw Error('Supabase Project URL(https://프로젝트.supabase.co)을 입력하세요.');
    let valid = key.startsWith('sb_publishable_');
    if (key.startsWith('eyJ')) {
      try { valid = JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role === 'anon'; } catch {}
    }
    if (!valid) throw Error('Publishable key 또는 anon 공개 키만 입력하세요. secret/service_role 키는 사용할 수 없습니다.');
    return {url,key};
  }
  async function request(path, body, auth = true, method) {
    const headers = {apikey:config.key,'Content-Type':'application/json'};
    if (auth) headers.Authorization = 'Bearer '+session.access_token;
    let response;
    try { response = await fetch(config.url+path,{method:method || (body === undefined ? 'GET':'POST'),headers,body:body === undefined ? undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)}); }
    catch { throw Error('서버에 연결하지 못했습니다. 자료는 브라우저에 남아 있습니다. 연결/프로젝트 일시정지 상태를 확인하세요.'); }
    const text = await response.text();
    let data; try { data = text ? JSON.parse(text):null; } catch { throw Error('서버 응답을 확인할 수 없습니다.'); }
    if (!response.ok) {
      if (String(data?.message).includes('REVISION_CONFLICT')) { blocked = true; enabled = false; throw Error('다른 기기에서 자료가 변경되었습니다. 전체 백업 후 「서버 자료 불러오기」로 확인하세요. 자동 저장을 중지했습니다.'); }
      if (response.status === 401 || (path.includes('grant_type=refresh_token') && [400,403].includes(response.status))) {
        resetSession(); throw Error('로그인이 만료되었습니다. 자료는 유지됩니다. 이메일과 비밀번호로 다시 로그인하세요.');
      }
      throw Error(data?.msg || data?.message || data?.error_description || '서버 요청 실패 ('+response.status+')');
    }
    return data;
  }
  async function refresh() {
    if (!session) throw Error('먼저 로그인하세요.');
    const action = async () => {
      // Another tab may already have rotated this refresh token.
      const saved = readJSON(remember ? localStorage : sessionStorage,SESSION_KEY);
      if (saved?.url === config.url && saved.session?.user?.id === session?.user?.id) session = saved.session;
      if (Date.now() > session.expires_at*1000 - 60000) {
        const next = await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:session.refresh_token},false);
        session = {...next,expires_at:next.expires_at || Date.now()/1000+next.expires_in};
        saveSession();
      }
    };
    if (navigator.locks) await navigator.locks.request('gradebook-auth-refresh',action); else await action();
  }
  async function remote() {
    await refresh();
    const rows = await request('/rest/v1/gradebook_documents?select=revision,payload,updated_at&owner_id=eq.'+encodeURIComponent(session.user.id));
    return rows[0] || null;
  }
  async function upload() {
    if (!session || !enabled || blocked || busy) return;
    busy = true; clearTimeout(debounce);
    try {
      await refresh();
      // Keep the exact request after a lost response. Repeating its UUID is idempotent.
      if (!inFlight) inFlight = {expected_revision:revision,new_revision:crypto.randomUUID(),document:copy()};
      status('서버에 저장 중…');
      const result = await request('/rest/v1/rpc/save_gradebook',inFlight);
      revision = result;
      await markSynced(inFlight.document);
      const saved = JSON.stringify(inFlight.document); inFlight = null;
      pending = JSON.stringify(store) !== saved;
      status('서버 저장 완료 · '+new Date().toLocaleTimeString()+(pending?' · 추가 변경 저장 대기':''));
      $('saveState').textContent = pending ? '추가 변경 저장 대기':'서버 저장 완료';
    } catch (e) { pending = true; status(e.message); $('saveState').textContent = '서버 미저장 · 전체 백업 권장'; }
    finally { busy = false; }
    // Do not loop automatically after failure; user retries or next edit retries.
    if (pending && !inFlight && enabled && !blocked) debounce = setTimeout(upload,1500);
  }
  window.cloudChanged = () => {
    pending = true;
    if (enabled && !blocked) { status('브라우저 저장됨 · 서버 저장 대기'); clearTimeout(debounce); debounce = setTimeout(upload,1500); }
    else status(session ? '브라우저 저장됨 · 서버 저장을 시작하려면 자료 불러오기 또는 첫 저장을 선택하세요.':'브라우저에만 저장됨 · 서버 저장은 로그인 후 사용');
  };
  async function guarded(action) {
    if (busy) return status('진행 중인 서버 요청이 끝난 후 다시 시도하세요.');
    busy = true; lock(true);
    try { await action(); } catch(e) { status(e.message); }
    finally { busy = false; lock(false); }
    if (pending && enabled && !blocked && !inFlight) debounce = setTimeout(upload,1500);
  }
  async function acceptRow(row) {
    replace(row.payload); revision = row.revision; enabled = true; blocked = false; pending = false; inFlight = null;
    await markSynced(store);
    $('saveState').textContent = '서버 연결됨';
    status('로그인됨 · 서버 자료 준비 완료 · 변경 내용은 자동 저장됩니다.');
    $('loginPanel').open = false;
  }
  async function connectAfterLogin() {
    const row = await remote();
    if (!row) { status('로그인됨 · 서버가 비어 있습니다. 기존 자료를 가져온 뒤 「현재 자료 첫 저장」을 누르세요.'); return; }
    GradeData.validate(row.payload);
    const base = readJSON(localStorage,SYNC_KEY);
    const localHash = await fingerprint(store);
    const sameOwner = base?.url === config.url && base.user === session.user.id;
    const sameData = localHash === await fingerprint(row.payload);
    if (sameData || (sameOwner && localHash === base.fingerprint) || (!base && store.schools.length === 0)) {
      await acceptRow(row); return;
    }
    if (sameOwner && row.revision === base.revision) {
      revision = row.revision; enabled = true; blocked = false; pending = true;
      status('로그인됨 · 이 기기의 미저장 변경을 복구해 서버 저장을 재개합니다.');
      $('loginPanel').open = false; return;
    }
    enabled = false; pending = true; $('loginPanel').open = true;
    status('이 기기에 서버와 다른 자료가 남아 있습니다. 자동 교체하지 않았습니다. 전체 백업 후 서버 자료 불러오기를 선택하세요.');
  }
  $('cloudLogin').onsubmit = event => {
    event.preventDefault();
    guarded(async () => {
      if (session) throw Error('계정을 바꾸려면 먼저 로그아웃하세요.');
      config = readConfig();
      localStorage.setItem('gradebook-cloud-config',JSON.stringify(config));
      const result = await request('/auth/v1/token?grant_type=password',{email:$('loginEmail').value.trim(),password:$('loginPassword').value},false);
      session = {...result,expires_at:result.expires_at || Date.now()/1000+result.expires_in};
      remember = $('rememberLogin').checked;
      saveSession();
      localStorage.setItem('gradebook-login-email',session.user.email || '');
      $('loginPassword').value = ''; enabled = false; blocked = false; inFlight = null;
      authenticated();
      await connectAfterLogin();
    });
  };
  $('cloudLoad').onclick = () => guarded(async () => {
    if (!leaveDraft()) return;
    if (!confirm('현재 자료가 있으면 교체 전 백업을 내려받고 서버 자료로 바꿉니다. 계속할까요?')) return;
    const row = await remote();
    if (!row) throw Error('서버에 자료가 없습니다. 「현재 자료 첫 저장」을 누르세요.');
    const data = GradeData.validate(row.payload);
    if (store.schools.length) download(copy(),'수행평가-교체전백업');
    await acceptRow({...row,payload:data});
    $('saveState').textContent = '서버 자료 불러옴'; status('서버 자료 불러옴 · 이후 변경은 자동 저장됩니다.');
  });
  $('cloudFirst').onclick = async () => {
    await guarded(async () => {
      if (enabled) throw Error('이미 서버에 연결되어 있습니다. 「저장 재시도」를 사용하세요.');
      const row = await remote();
      if (row) throw Error('서버에 기존 자료가 있습니다. 먼저 서버 자료를 불러오세요. 현재 자료는 전체 백업으로 보관할 수 있습니다.');
      copy(); revision = null; blocked = false; enabled = true; pending = true;
    });
    if (enabled && pending) await upload();
  };
  $('cloudRetry').onclick = () => { if (session && !enabled && !blocked) return guarded(connectAfterLogin); if (!enabled || blocked) return status('먼저 서버 자료 불러오기 또는 첫 저장을 선택하세요.'); upload(); };
  $('cloudLogout').onclick = () => guarded(async () => {
    if (!leaveDraft()) return;
    if (!confirm('현재 자료를 백업하고 이 브라우저의 작업 자료를 지웁니다. 서버 자료는 유지됩니다. 로그아웃할까요?')) return;
    if (store.schools.length) download(copy(),'수행평가-로그아웃백업');
    clearTimeout(debounce); enabled = false;
    try { await request('/auth/v1/logout?scope=local',{},true); } catch {}
    resetSession(); localStorage.removeItem(SYNC_KEY);
    revision = null; pending = false; inFlight = null; blocked = false;
    replace(empty()); $('loginFields').disabled = false; $('cloudActions').hidden = true;
    $('saveState').textContent = '로그아웃'; status('로그아웃했습니다. 서버 자료는 다음 로그인 때 불러오세요.');
  });
  $('fullBackup').onclick = () => { try { if (dirty) return status('루브릭 변경 내용을 먼저 저장하세요.'); download(copy()); status('전체 백업을 내려받았습니다. 다운로드 폴더에서 파일을 확인하세요.'); } catch(e) { status(e.message); } };
  $('importBackup').onchange = event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    guarded(async () => {
      if (file.size > 8*1024*1024) throw Error('백업 파일이 너무 큽니다.');
      if (!leaveDraft()) return;
      let input = JSON.parse(await file.text());
      if (input && [2,3].includes(input.version) && Array.isArray(input.classes)) {
        const school = {id:uid(),name:'기존 학교',data:migrateData(input)};
        input = {version:4,schools:[school],activeSchool:school.id};
      }
      const data = GradeData.validate(input);
      if (!confirm('백업의 '+data.schools.length+'개 학교 자료로 전체 교체합니다. 현재 자료는 먼저 백업됩니다. 계속할까요?')) return;
      if (store.schools.length) download(copy(),'수행평가-복원전백업');
      replace(data); window.cloudChanged();
    });
  };
  // Same-origin tabs must not silently overwrite each other's local copy.
  window.addEventListener('storage',event => {
    if (event.key === SESSION_KEY && event.newValue === null && remember && session) {
      resetSession(); status('다른 탭에서 로그아웃했습니다. 다시 로그인하세요.');
    }
    if (event.key === KEY) {
      clearTimeout(debounce); enabled = false; blocked = true; tabBlocked = true; lock(true);
      status('다른 탭에서 자료가 변경되었습니다. 이 탭의 전체 백업을 받은 뒤 새로고침하세요. 중복 편집을 막았습니다.');
    }
  });
  window.addEventListener('beforeunload',event => { if (pending || busy) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('online',() => { if (enabled && pending && !blocked) upload(); else if (session && !enabled && !blocked) guarded(connectAfterLogin); });
  $('downloadConfig').onclick = () => {
    try {
      const cfg = readConfig();
      localStorage.setItem('gradebook-cloud-config',JSON.stringify(cfg));
      const url = URL.createObjectURL(new Blob(['// 공개 연결 정보만 포함합니다.\nwindow.GRADEBOOK_CONFIG = '+JSON.stringify(cfg,null,2)+';\n'],{type:'text/javascript'}));
      const a = document.createElement('a'); a.href = url; a.download = 'config.js'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),10000);
      status('config.js를 내려받았습니다. GitHub의 public/config.js를 이 파일로 바꾸면 모든 기기에 연결 설정이 적용됩니다.');
    } catch(e) { status(e.message); }
  };
  const preset = window.GRADEBOOK_CONFIG;
  const cfg = preset?.url && preset?.key ? preset : readJSON(localStorage,'gradebook-cloud-config');
  if (cfg) { $('serverUrl').value = cfg.url || ''; $('publicKey').value = cfg.key || ''; }
  try { $('loginEmail').value = localStorage.getItem('gradebook-login-email') || ''; } catch {}
  $('connectionSetup').open = !cfg;
  status('브라우저 저장 모드 · 로그인 유지를 선택하면 다음 접속부터 자동 연결됩니다.');
  const saved = readJSON(localStorage,SESSION_KEY) || readJSON(sessionStorage,SESSION_KEY);
  if (saved?.session?.access_token && saved.session.refresh_token && saved.session.user?.id && saved.url === cfg?.url) {
    guarded(async () => {
      config = readConfig(); session = saved.session; remember = !!saved.remember;
      $('rememberLogin').checked = remember;
      authenticated(); status('자동 로그인 · 서버 자료 확인 중…');
      await connectAfterLogin();
    });
  }
})();
