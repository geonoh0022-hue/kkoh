'use strict';
// Portable JSON format. No vendor SDK or build dependency.
const GradeData = (() => {
  const MAX_BYTES = 4 * 1024 * 1024;
  function validate(input) {
    const value = input?.format === 'gradebook-backup' ? input.data : input;
    const fail = () => { throw Error('지원하지 않거나 손상된 전체 백업입니다. 원본 파일을 보관하세요.'); };
    const obj = x => x && typeof x === 'object' && !Array.isArray(x);
    const str = x => typeof x === 'string' && x.length > 0 && x.length <= 200;
    const unique = a => new Set(a.map(x => x.id)).size === a.length;
    if (!obj(value) || value.version !== 4 || !Array.isArray(value.schools) || !unique(value.schools)) fail();
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_BYTES) throw Error('전체 자료는 4MB 이하만 지원합니다. 백업 후 학년별로 보관하세요.');
    for (const s of value.schools) {
      if (!obj(s) || !str(s.id) || !str(s.name) || !obj(s.data)) fail();
      const d = s.data;
      if (d.version !== 3 || !Array.isArray(d.classes) || !Array.isArray(d.evaluations) || !unique(d.classes) || !unique(d.evaluations)) fail();
      const students = new Set();
      for (const c of d.classes) {
        if (!str(c.id) || !str(c.name) || !Number.isInteger(c.year) || c.year < 2000 || c.year > 2200 || !['','1','2','3','4','5','6'].includes(c.grade) || !Array.isArray(c.students)) fail();
        for (const st of c.students) {
          if (!str(st.id) || !str(st.name) || !['string','number'].includes(typeof st.number) || students.has(st.id)) fail();
          students.add(st.id);
        }
      }
      for (const e of d.evaluations) {
        if (!str(e.id) || !str(e.name) || !Number.isInteger(e.year) || !['','1','2','3','4','5','6'].includes(e.grade) || !Number.isFinite(e.max) || e.max <= 0 || !Array.isArray(e.criteria) || !obj(e.scores)) fail();
        for (const r of e.criteria) {
          if (!str(r.name) || !Number.isFinite(r.max) || r.max <= 0 || !Array.isArray(r.levels) || !r.levels.length || r.levels.some(n => !Number.isFinite(n) || n < 0 || n > r.max)) fail();
        }
        for (const scores of Object.values(e.scores)) {
          if (!Array.isArray(scores) || scores.length > e.criteria.length || scores.some((n,i) => n !== null && (!Number.isFinite(n) || !e.criteria[i].levels.includes(n)))) fail();
        }
      }
      if (d.active !== null && !d.classes.some(c => c.id === d.active)) fail();
    }
    if (value.activeSchool !== null && !value.schools.some(s => s.id === value.activeSchool)) fail();
    return JSON.parse(JSON.stringify(value));
  }
  return { validate, MAX_BYTES };
})();
if (typeof module !== 'undefined') module.exports = GradeData;
