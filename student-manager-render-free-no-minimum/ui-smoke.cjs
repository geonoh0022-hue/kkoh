// Lightweight DOM harness for the original form handlers; no browser dependencies.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('UI loads server data and awaits class, student, roster and record saves',async()=>{
 const elements=new Map();
 function element(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,checked:false,dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return true;}},addEventListener(){},showModal(){},close(){},focus(){}});return elements.get(id);}
 let stored={version:2,classes:[],students:[],records:[]},revision=0;const alerts=[];
 const context=vm.createContext({document:{getElementById:element,addEventListener(){}},window:{addEventListener(){}},location:{},globalThis:{crypto:require('node:crypto').webcrypto},Date,Math,Set,Map,JSON,String,Number,Array,Error,console,alert:s=>alerts.push(s),confirm:()=>true,setTimeout:()=>0,clearTimeout(){},fetch:async(url,options)=>{if(options?.method==='PUT'){const body=JSON.parse(options.body);assert.equal(body.revision,revision);stored=body.data;revision++;return{ok:true,json:async()=>({revision})};}return{ok:true,json:async()=>({data:stored,revision})};}});
 vm.runInContext(fs.readFileSync(__dirname+'/public/app.js','utf8'),context);await new Promise(setImmediate);
 assert.equal(element('app').hidden,false);
 element('cYear').value='2026';element('cName').value='1반';await element('classForm').onsubmit({preventDefault(){}});assert.equal(stored.classes.length,1);
 element('sName').value='학생';element('sNumber').value='1';element('sClass').value=stored.classes[0].id;await element('studentForm').onsubmit({preventDefault(){}});assert.equal(stored.students.length,1);
 element('rCategory').value='학생 상담';element('rDate').value='2026-09-23';element('rTitle').value='상담';element('rBody').value='내용';element('rMethod').value='전화';element('rAttendance').value='지각';await element('recordForm').onsubmit({preventDefault(){}});assert.equal(stored.records.length,1);
 element('bulkText').value='2,다른학생';await element('bulkForm').onsubmit({preventDefault(){}});assert.equal(stored.students.length,2);assert.equal(revision,4);assert.deepEqual(alerts,[]);
});
