const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {postgresStore,createStore}=require('./store.cjs');
test('production never falls back to disposable local disk',()=>{
 assert.throws(()=>createStore({NODE_ENV:'production'}),/DATABASE_URL/);
 assert.throws(()=>createStore({RENDER:'true'}),/DATABASE_URL/);
});
test('PostgreSQL schema initialization, JSON round trip and atomic revision checks',async()=>{
 const db=new PGlite();
 const sql=async(strings,...values)=>{let query=strings[0];values.forEach((v,i)=>query+='$'+(i+1)+strings[i+1]);return (await db.query(query,values)).rows;};
 try{
 const store=postgresStore(sql);await store.init();assert.equal((await store.read()).revision,0);
 const data={version:2,classes:[{id:'한글',name:"O'Reilly 반",year:'2026'}],students:[],records:[]};
 assert.equal(await store.save(data,0),1);
 assert.equal(await store.save({...data,classes:[]},0),null);
 await store.init();
 assert.deepEqual(await postgresStore(sql).read(),{data,revision:1});
 const results=await Promise.all([store.save(data,1),store.save(data,1)]);
 assert.equal(results.filter(x=>x===2).length,1);assert.equal(results.filter(x=>x===null).length,1);
 }finally{await db.close();}
});
