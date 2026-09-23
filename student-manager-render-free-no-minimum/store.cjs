const initial={version:2,classes:[],students:[],records:[]};
function postgresStore(sql){return {
 async init(){
  await sql`CREATE TABLE IF NOT EXISTS student_manager_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body JSONB NOT NULL)`;
  await sql`INSERT INTO student_manager_state(id,revision,body) VALUES(1,0,${JSON.stringify(initial)}::jsonb) ON CONFLICT(id) DO NOTHING`;
 },
 async read(){const [row]=await sql`SELECT revision,body FROM student_manager_state WHERE id=1`;if(!row)throw Error('Missing state');return {data:row.body,revision:row.revision};},
 async save(data,revision){const rows=await sql`UPDATE student_manager_state SET body=${JSON.stringify(data)}::jsonb, revision=revision+1 WHERE id=1 AND revision=${revision} RETURNING revision`;return rows.length?rows[0].revision:null;}
};}
function createStore(env){
 if(env.DATABASE_URL){
  const {neon}=require('@neondatabase/serverless');
  return postgresStore(neon(env.DATABASE_URL));
 }
 // Never silently use Render's disposable filesystem for deployed data.
 if(env.NODE_ENV==='production'||env.RENDER)throw Error('DATABASE_URL is required for deployment');
 const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
 const dir=env.DATA_DIR||path.join(__dirname,'data');fs.mkdirSync(dir,{recursive:true});
 const db=new DatabaseSync(path.join(dir,'records.sqlite'));
 return {
  async init(){db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL)');db.prepare('INSERT OR IGNORE INTO state VALUES(1,0,?)').run(JSON.stringify(initial));},
  async read(){const row=db.prepare('SELECT * FROM state WHERE id=1').get();return {data:JSON.parse(row.body),revision:row.revision};},
  async save(data,revision){const result=db.prepare('UPDATE state SET body=?,revision=revision+1 WHERE id=1 AND revision=?').run(JSON.stringify(data),revision);return result.changes?revision+1:null;}
 };
}
module.exports={createStore,postgresStore};
