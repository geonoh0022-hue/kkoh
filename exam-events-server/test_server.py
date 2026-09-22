import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import server

def request(path, method='GET', body=None, cookie='', custom=True):
    raw = json.dumps(body or {}).encode()
    env = dict(PATH_INFO=path,REQUEST_METHOD=method,CONTENT_LENGTH=str(len(raw)),CONTENT_TYPE='application/json',HTTP_COOKIE=cookie)
    env['wsgi.input'] = io.BytesIO(raw)
    if custom:
        env['HTTP_X_EXAM_REQUEST']='1'
    meta={}
    def start(status, headers):
        meta.update(status=int(status.split()[0]),headers=dict(headers))
    data=json.loads(b''.join(server.app(env,start)))
    return meta['status'],data,meta['headers']

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        server.DATA=Path(self.tmp.name)
        os.environ['ADMIN_PASSWORD']='test-password-12345'
        server.init()
        status,_,headers=request('/api/login','POST',{'role':'teacher','password':os.environ['ADMIN_PASSWORD']})
        self.assertEqual(status,200)
        self.cookie=headers['Set-Cookie'].split(';')[0]
        self.db=request('/api/state',cookie=self.cookie)[1]['data']
        self.year,self.exam=self.db['activeYear'],self.db['activeExam']
        self.entry=self.db['years'][self.year]['sessions'][self.exam]
        roster=[{'id':'s1','name':'학생가'},{'id':'s2','name':'학생나'}]
        self.db['years'][self.year]['roster']=roster
        self.entry['students']=[dict(r,studyMinutes=0,lotto={'math':{'pred':'','actual':''}}) for r in roster]
        self.entry['exams']=[dict(id='e1',subject='수학',subjectKey='math',date='',period='',range='',note='')]
        self.assertEqual(self.save(0)[0],200)

    def tearDown(self):
        self.tmp.cleanup()

    def save(self, revision):
        return request('/api/state','PUT',{'data':self.db,'revision':revision},self.cookie)

    def score(self,student,value=80,**extra):
        body=dict(student=student,year=self.year,exam=self.exam,mode='pred',values={'math':value})
        body.update(extra)
        return request('/api/scores','POST',body)

    def test_public_submission_and_protected_details(self):
        self.assertEqual(self.score('s1',80)[0],200)
        self.assertEqual(self.score('s1',85,mode='actual')[0],200)
        data=request('/api/state')[1]['data']
        student=data['years'][self.year]['sessions'][self.exam]['students'][0]
        self.assertEqual(student['publicResult']['totalDiff'],5)
        self.assertTrue(student['publicResult']['eligible'])
        self.assertEqual(student['lotto']['math'],{'pred':'','actual':''})
        self.assertEqual(request('/api/state','PUT',{'data':self.db,'revision':3})[0],401)
        self.assertEqual(request('/api/password','POST',{'password':'changed-password'})[0],401)
        self.assertEqual(request('/api/codes','POST',{})[0],404)
        self.assertEqual(request('/api/login','POST',{'code':'oldcode'})[0],400)
        self.assertEqual(request('/api/scores','POST',{},custom=False)[0],403)

    def test_concurrency_and_reopening(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda args:self.score(*args),[('s1',81),('s2',92)]))
        self.assertEqual([r[0] for r in results],[200,200])
        self.assertEqual(self.save(1)[0],409)
        server.init()
        db=request('/api/state',cookie=self.cookie)[1]['data']
        students=db['years'][self.year]['sessions'][self.exam]['students']
        self.assertEqual([s['lotto']['math']['pred'] for s in students],['81','92'])

    def test_validation_and_period(self):
        for value in [39,101,'','abc',True,float('nan')]:
            self.assertEqual(self.score('s1',value)[0],400)
        self.assertEqual(self.score('unknown')[0],400)
        self.assertEqual(self.score('s1',exam='wrong')[0],409)
        self.entry['lottoPredWindow']={'start':'2000-01-01','end':'2000-01-02'}
        self.assertEqual(self.save(1)[0],200)
        self.assertEqual(self.score('s1')[0],403)
        self.assertEqual(self.score('s1',0,mode='actual')[0],200)

    def test_password_and_logout(self):
        self.assertEqual(request('/api/login','POST',{'role':'teacher','password':'wrong'})[0],401)
        self.assertEqual(request('/api/password','POST',{'password':'changed-password-12345'},self.cookie)[0],200)
        self.assertEqual(request('/api/login','POST',{'role':'teacher','password':os.environ['ADMIN_PASSWORD']})[0],401)
        self.assertEqual(request('/api/logout','POST',{},self.cookie)[0],200)
        self.assertEqual(self.save(1)[0],401)

if __name__ == '__main__':
    unittest.main(verbosity=2)
