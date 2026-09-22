"""Exam events: public board and submissions, authenticated teacher management."""
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('DATA_DIR', ROOT / 'data'))
SECURE = os.environ.get('COOKIE_SECURE', 'true').lower() == 'true'
KST = timezone(timedelta(hours=9))
EXAMS = ('1-1', '1-2', '2-1', '2-2')

class Problem(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

def check(ok, message='입력 형식을 확인해주세요.', status=400):
    if not ok:
        raise Problem(status, message)

def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def password_hash(value):
    salt = secrets.token_hex(16)
    return salt + ':' + hashlib.pbkdf2_hmac('sha256', value.encode(), salt.encode(), 600000).hex()

def password_ok(value, stored):
    salt, expected = stored.split(':')
    return hmac.compare_digest(expected, hashlib.pbkdf2_hmac('sha256', value.encode(), salt.encode(), 600000).hex())

def blank():
    now = datetime.now(KST)
    year, exam = str(now.year), '1-1' if now.month < 8 else '2-1'
    return dict(version=3, activeYear=year, activeExam=exam, years={year: {'roster': [], 'sessions': {exam: {'students': [], 'exams': [], 'lottoPredWindow': {'start': '', 'end': ''}}}}})

def connect():
    con = sqlite3.connect(DATA / 'events.sqlite3', timeout=20)
    con.row_factory = sqlite3.Row
    return con

def init():
    DATA.mkdir(parents=True, exist_ok=True)
    with closing(connect()) as con, con:
        con.execute('PRAGMA journal_mode=WAL')
        con.executescript('''
        CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, role TEXT, year TEXT, student TEXT, expires REAL);
        CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER, until REAL);
        ''')
        con.execute('INSERT OR IGNORE INTO state VALUES (1,?,0)', (encode(blank()),))
        if not con.execute("SELECT 1 FROM config WHERE key='password'").fetchone():
            pw = os.environ.get('ADMIN_PASSWORD', '')
            check(12 <= len(pw) <= 256, '서버 시작 전에 ADMIN_PASSWORD를 12~256자로 설정해주세요.')
            con.execute("INSERT INTO config VALUES ('password',?)", (password_hash(pw),))

def valid_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        return False
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False

def score_number(value, minimum=0):
    check(type(value) in (int, float, str) and value != '')
    try:
        number = float(value)
    except (ValueError, TypeError):
        raise Problem(400, '점수는 숫자로 입력해주세요.')
    check(math.isfinite(number) and minimum <= number <= 100, '점수 범위를 확인해주세요.')
    return number

def validate(db):
    check(isinstance(db, dict) and db.get('version') == 3)
    years = db.get('years')
    check(isinstance(years, dict) and 1 <= len(years) <= 201)
    check(isinstance(db.get('activeYear'), str) and db['activeYear'] in years and db.get('activeExam') in EXAMS)
    for year, bucket in years.items():
        check(re.fullmatch(r'20\d\d|21\d\d|2200', year) and isinstance(bucket, dict))
        roster, sessions = bucket.get('roster'), bucket.get('sessions')
        check(isinstance(roster, list) and len(roster) <= 1000 and isinstance(sessions, dict))
        names = {}
        for r in roster:
            check(isinstance(r, dict) and isinstance(r.get('id'), str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', r['id']))
            check(r['id'] not in names and isinstance(r.get('name'), str) and 0 < len(r['name'].strip()) <= 100)
            names[r['id']] = r['name']
        for exam, entry in sessions.items():
            check(exam in EXAMS and isinstance(entry, dict))
            students, exams = entry.get('students'), entry.get('exams', [])
            check(isinstance(students, list) and len(students) == len(names))
            check(isinstance(exams, list) and len(exams) <= 500)
            seen = set()
            for student in students:
                check(isinstance(student, dict) and isinstance(student.get('id'), str) and student['id'] in names and student['id'] not in seen)
                seen.add(student['id'])
                check(student.get('name') == names[student['id']])
                for key in ('studyJoined', 'studyExcluded', 'plannerJoined', 'plannerExcluded'):
                    check(isinstance(student.get(key, False), bool))
                minutes = student.get('studyMinutes', '')
                check(minutes == '' or type(minutes) is int and 0 <= minutes <= 9007199254740991)
                days = student.get('plannerDates', [])
                check(isinstance(days, list) and len(days) <= 10000 and all(valid_date(d) for d in days))
                lotto = student.get('lotto', {})
                check(isinstance(lotto, dict) and len(lotto) <= 500)
                for key, pair in lotto.items():
                    check(re.fullmatch(r'eng|math|sci|hist|sub_[a-f0-9_]+', key) and isinstance(pair, dict))
                    for field in ('pred', 'actual'):
                        if pair.get(field, '') != '':
                            score_number(pair[field])
                student.pop('publicResult', None)
            for e in exams:
                check(isinstance(e, dict))
                for key, limit in [('id',150),('subject',40),('date',10),('period',20),('range',3000),('note',1000),('subjectKey',1000)]:
                    check(isinstance(e.get(key, ''), str) and len(e.get(key, '')) <= limit)
                check(e.get('subject', '').strip())
                check(re.fullmatch(r'eng|math|sci|hist|sub_[a-f0-9_]+', e.get('subjectKey', '')))
                check(not e.get('date') or valid_date(e['date']))
            for key in ('eventPeriod', 'lottoPredWindow'):
                w = entry.get(key, {})
                check(isinstance(w, dict) and all(not w.get(k) or valid_date(w[k]) for k in ('start','end')))
                check(not w.get('start') or not w.get('end') or w['start'] <= w['end'])
            if 'examDday' in entry:
                d = entry['examDday']
                check(isinstance(d, dict) and valid_date(d.get('date')) and isinstance(d.get('title', ''), str) and len(d.get('title', '')) <= 60)
    check(db['activeExam'] in years[db['activeYear']]['sessions'])
    return db

def read_state(con):
    row = con.execute('SELECT * FROM state WHERE id=1').fetchone()
    return json.loads(row['body']), row['revision']

def identity(con, env):
    cookie = SimpleCookie()
    try:
        cookie.load(env.get('HTTP_COOKIE', ''))
        token = cookie.get('exam_session')
        return con.execute("SELECT * FROM sessions WHERE hash=? AND expires>? AND role='teacher'", (digest(token.value), time.time())).fetchone() if token else None
    except Exception:
        return None

def require(user):
    check(user is not None, '교사 로그인이 필요합니다.', 401)

def payload(db, revision, user):
    if user is not None:
        return {'role': 'teacher', 'data': db, 'revision': revision}
    year, exam = db['activeYear'], db['activeExam']
    entry = json.loads(encode(db['years'][year]['sessions'][exam]))
    keys = {e['subjectKey'] for e in entry.get('exams', []) if re.sub(r'\s', '', e['subject']) != '자기주도학습'}
    for student in entry['students']:
        scores = student.get('lotto', {})
        pred = [scores.get(k, {}).get('pred', '') for k in keys]
        actual = [scores.get(k, {}).get('actual', '') for k in keys]
        complete = bool(keys) and all(v != '' for v in pred)
        has_actual = bool(keys) and all(v != '' for v in actual)
        below = any(v != '' and float(v) < 40 for v in pred)
        eligible = complete and has_actual and not below
        diff = round(sum(abs(float(scores[k]['pred'])-float(scores[k]['actual'])) for k in keys),2) if eligible else 0
        student['publicResult'] = dict(predComplete=complete, predBelow40=below, hasActual=has_actual, eligible=eligible, totalDiff=diff)
        student['lotto'] = {k: {'pred':'', 'actual':''} for k in keys}
    public = dict(version=3, activeYear=year, activeExam=exam, years={year:{'roster':db['years'][year]['roster'],'sessions':{exam:entry}}})
    return {'role':'guest','data':public,'revision':revision}

def cookie(token='', age=0):
    return ('Set-Cookie', f'exam_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}' + ('; Secure' if SECURE else ''))

def route(env, body, con):
    path, method = env.get('PATH_INFO', '/'), env['REQUEST_METHOD']
    user = identity(con, env)
    if method == 'GET' and path == '/api/health':
        return {'ok':True}, []
    if method == 'GET' and path == '/api/state':
        return payload(*read_state(con), user), []
    if method == 'POST' and path == '/api/login':
        check(body.get('role') == 'teacher', '학생은 로그인 없이 이용할 수 있습니다.')
        value = body.get('password','')
        check(isinstance(value, str) and len(value) <= 256)
        now = time.time()
        con.execute('BEGIN IMMEDIATE')
        con.execute('DELETE FROM attempts WHERE until<?', (now,))
        row = con.execute("SELECT * FROM attempts WHERE key='login'").fetchone()
        check(not row or row['count'] < 120, '로그인 시도가 많습니다. 잠시 후 다시 시도해주세요.', 429)
        con.execute("INSERT INTO attempts VALUES ('login',1,?) ON CONFLICT(key) DO UPDATE SET count=count+1", (now+300,))
        con.commit()
        stored = con.execute("SELECT value FROM config WHERE key='password'").fetchone()[0]
        check(password_ok(value,stored), '비밀번호가 맞지 않습니다.', 401)
        token = secrets.token_urlsafe(32)
        if user:
            con.execute('DELETE FROM sessions WHERE hash=?', (user['hash'],))
        con.execute('DELETE FROM sessions WHERE expires<?', (now,))
        con.execute('INSERT INTO sessions VALUES (?,?,?,?,?)', (digest(token),'teacher','','',now+28800))
        con.commit()
        return {'ok':True}, [cookie(token,28800)]
    if method == 'POST' and path == '/api/logout':
        if user:
            con.execute('DELETE FROM sessions WHERE hash=?',(user['hash'],))
            con.commit()
        return {'ok':True}, [cookie()]
    if method == 'POST' and path == '/api/password':
        require(user)
        pw = body.get('password','')
        check(isinstance(pw,str) and 12 <= len(pw) <= 256, '비밀번호는 12~256자로 입력해주세요.')
        con.execute("UPDATE config SET value=? WHERE key='password'", (password_hash(pw),))
        con.execute("DELETE FROM sessions WHERE role='teacher' AND hash<>?", (user['hash'],))
        con.commit()
        return {'ok':True}, []
    if method == 'PUT' and path == '/api/state':
        require(user)
        db = validate(body.get('data'))
        con.execute('BEGIN IMMEDIATE')
        _, revision = read_state(con)
        check(type(body.get('revision')) is int and body['revision'] == revision, '다른 기기에서 기록이 변경되었습니다. 최신 기록을 불러온 뒤 다시 수정해주세요.',409)
        con.execute('UPDATE state SET body=?,revision=revision+1 WHERE id=1',(encode(db),))
        con.commit()
        return {'revision':revision+1}, []
    if method == 'POST' and path == '/api/scores':
        con.execute('BEGIN IMMEDIATE')
        db, revision = read_state(con)
        check(body.get('year') == db['activeYear'] and body.get('exam') == db['activeExam'], '시험이 변경되었습니다. 새로고침 후 다시 입력해주세요.',409)
        entry = db['years'][db['activeYear']]['sessions'][db['activeExam']]
        student = next((s for s in entry['students'] if s['id'] == body.get('student')),None)
        check(student is not None,'이름을 선택해주세요.')
        mode, values = body.get('mode'),body.get('values')
        check(mode in ('pred','actual') and isinstance(values,dict))
        keys = {e['subjectKey'] for e in entry.get('exams',[]) if re.sub(r'\s','',e['subject']) != '자기주도학습'}
        check(keys and set(values) == keys,'시험 과목이 변경되었습니다. 새로고침 후 다시 입력해주세요.',409)
        if mode == 'pred':
            w, today = entry.get('lottoPredWindow',{}),datetime.now(KST).date().isoformat()
            check((not w.get('start') or today >= w['start']) and (not w.get('end') or today <= w['end']),'지금은 예상 점수 입력 기간이 아닙니다.',403)
        for key,value in values.items():
            score_number(value,40 if mode == 'pred' else 0)
            student.setdefault('lotto',{}).setdefault(key,{'pred':'','actual':''})[mode] = str(value)
        con.execute('UPDATE state SET body=?,revision=revision+1 WHERE id=1',(encode(db),))
        con.commit()
        return {'revision':revision+1}, []
    raise Problem(404,'요청한 경로를 찾을 수 없습니다.')

def app(env, start_response):
    headers = [('Cache-Control','no-store'),('X-Content-Type-Options','nosniff'),('X-Frame-Options','DENY'),('Referrer-Policy','no-referrer'),('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")]
    status = 200
    try:
        if env['REQUEST_METHOD'] == 'GET' and env.get('PATH_INFO','/') in ('/','/teacher','/student'):
            data = (ROOT/'public'/'index.html').read_bytes()
            headers.append(('Content-Type','text/html; charset=utf-8'))
        else:
            body = {}
            if env['REQUEST_METHOD'] not in ('GET','HEAD'):
                check(env.get('HTTP_X_EXAM_REQUEST') == '1','잘못된 요청입니다.',403)
                check(env.get('CONTENT_TYPE','').split(';')[0] == 'application/json','JSON 요청이 필요합니다.',415)
                try:
                    length = int(env.get('CONTENT_LENGTH') or 0)
                    check(0 <= length <= 20000000,'요청이 너무 큽니다.',413)
                    body = json.loads(env['wsgi.input'].read(length))
                    check(isinstance(body,dict))
                except (ValueError,UnicodeDecodeError):
                    raise Problem(400,'JSON 형식을 확인해주세요.')
            with closing(connect()) as con:
                result, extra = route(env,body,con)
            headers.extend(extra)
            data = encode(result).encode()
            headers.append(('Content-Type','application/json; charset=utf-8'))
    except Problem as err:
        status,data = err.status,encode({'error':err.message}).encode()
        headers.append(('Content-Type','application/json; charset=utf-8'))
    except Exception:
        import traceback
        traceback.print_exc()
        status,data = 500,encode({'error':'서버에서 처리하지 못했습니다. 잠시 후 다시 시도해주세요.'}).encode()
        headers.append(('Content-Type','application/json; charset=utf-8'))
    headers.append(('Content-Length',str(len(data))))
    start_response(f'{status} {HTTPStatus(status).phrase}',headers)
    return [data]

if __name__ == '__main__':
    init()
    from waitress import serve
    serve(app,host='0.0.0.0',port=int(os.environ.get('PORT','8080')),threads=8,max_request_body_size=20000000)
