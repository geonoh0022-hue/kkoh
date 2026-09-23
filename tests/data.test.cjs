const {test} = require('node:test');
const assert = require('node:assert/strict');
const {validate} = require('../public/data.js');
const fixture = () => ({version:4,activeSchool:'s',schools:[{id:'s',name:'시험 학교',data:{version:3,active:'c',classes:[{id:'c',name:'1반',year:2026,grade:'1',students:[{id:'p',name:'시험 학생',number:'1'}]}],evaluations:[{id:'e',name:'발표',year:2026,grade:'1',max:5,criteria:[{name:'내용',max:5,levels:[5,3,0]}],scores:{p:[0]}}]}}]});
test('portable backup preserves zero scores and returns an independent copy',()=>{const a=fixture();const b=validate({format:'gradebook-backup',data:a});assert.deepEqual(a,b);b.schools[0].name='변경';assert.notEqual(a.schools[0].name,b.schools[0].name);});
test('ungraded null scores remain null',()=>{const a=fixture();a.schools[0].data.evaluations[0].scores.p=[null];assert.equal(validate(a).schools[0].data.evaluations[0].scores.p[0],null);});
test('rejects broken structures and illegal scores before import',()=>{for(const edit of [a=>a.version=99,a=>a.activeSchool='missing',a=>a.schools[0].data.classes=null,a=>a.schools[0].data.evaluations[0].scores.p=[999],a=>a.schools.push(a.schools[0])]){const a=fixture();edit(a);assert.throws(()=>validate(a));}});
test('rejects oversized payload',()=>{const a=fixture();a.extra='x'.repeat(4*1024*1024);assert.throws(()=>validate(a));});
