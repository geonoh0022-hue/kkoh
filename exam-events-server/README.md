# 시험기간 이벤트 — 학생 로그인 없는 배포용

원본 화면의 색상·배치·탭을 유지했습니다. 학생은 로그인 없이 공통 화면을 보고 이름을 선택해 점수를 제출합니다. 교사 전용 기능은 비밀번호 로그인을 유지합니다.

## 이미 배포 중이라면

1. 이 폴더의 `server.py`와 `public/index.html`을 GitHub의 기존 파일 위치에 덮어씁니다.
2. 변경사항을 커밋하고 Render에서 최신 커밋을 재배포합니다.
3. 기존 `ADMIN_PASSWORD`, `DATA_DIR`, 영구 디스크 설정은 그대로 유지합니다. DB를 삭제할 필요가 없습니다.
4. 배포가 완료되면 브라우저를 새로고침합니다.

현재 파일은 배포용 소스입니다. GitHub나 Render에 자동 반영하지 않았습니다. ZIP이나 HTML만 단독 업로드하면 서버가 실행되지 않습니다.

## 화면 사용

- 기본 주소 `/`: 명단, 열품타·플래너 현황, 로또 순위·점수차, 시험 시간표·범위 공개.
- **학생 입력 화면 열기** 또는 `/student`: 로그인 없이 이름을 선택해 점수 제출.
- 교사 로그인 후: 학생 명단·시간·플래너·시험 안내·기간·학년도 수정, 과목별 점수 상세표, 백업·복원·초기화.
- 과목별 개별 점수와 다른 학년도·시험 기록은 공개 데이터에 포함하지 않습니다.

이름 선택만으로 입력하므로 다른 학생 이름을 선택하면 해당 학생의 점수도 수정할 수 있습니다. 기존 점수는 로그인 없는 입력 화면에 미리 표시하지 않습니다. 예상 점수는 40~100점, 실제 점수는 0~100점입니다. 예상 점수 입력 기간은 한국 시간 기준으로 서버에서 확인합니다.

## Render 새 배포

이 패키지의 `render.yaml`에는 유료 웹 서비스와 영구 디스크 1GB 설정이 있습니다. 생성 화면의 요금을 확인하고 진행하세요.

1. 압축을 풀고 파일을 GitHub 저장소에 올립니다. ZIP 파일 자체를 올리는 것이 아닙니다.
2. Render에서 저장소를 연결합니다. `exam-events-server` 폴더째 올렸다면 Root Directory를 `exam-events-server`로 설정합니다. 폴더 내부 파일을 저장소 최상위에 올렸다면 Root Directory를 비웁니다.
3. Dockerfile Path는 `./Dockerfile`, Docker Build Context Directory는 `.`입니다.
4. Environment에서 `ADMIN_PASSWORD`에 직접 정한 12~256자 비밀번호를 넣습니다. 따옴표 없이 입력하세요. `COOKIE_SECURE=true`, `DATA_DIR=/var/data`도 설정합니다.
5. `/var/data`에 영구 디스크를 연결합니다. Blueprint 배포라면 제공된 설정에 포함되어 있습니다. 임시 파일시스템에는 기록을 저장하지 마세요.
6. 배포 완료 후 HTTPS 주소로 접속합니다. 교사 화면에서 명단과 시험을 설정하고 공통 주소를 학생에게 공유합니다.

`Dockerfile not found`는 폴더 경로를, `ADMIN_PASSWORD를 12~256자로` 오류는 환경변수를 확인하세요. `render.yaml`을 단순 업로드했다고 모든 설정이 자동 적용되는 것은 아닙니다. Blueprint를 쓰지 않았다면 서비스 설정에서 직접 확인해야 합니다.

## 로컬 실행

Python 3.12 이상, Windows PowerShell 예시:

```powershell
python -m pip install -r requirements.txt
$env:ADMIN_PASSWORD = '직접 정한 12자 이상 비밀번호'
$env:COOKIE_SECURE = 'false'
python server.py
```

`http://localhost:8080/`로 접속합니다. 학생 배포에는 로컬 주소 대신 HTTPS 호스팅 주소가 필요합니다.

Docker라면 `.env.example`을 `.env`로 복사하고 비밀번호를 수정한 뒤 `docker compose up --build -d`를 실행합니다. `docker compose down -v`는 기록 볼륨까지 삭제하므로 사용하지 마세요.

## 기록·비밀번호

- 이전 HTML 기록은 사용했던 기기·브라우저에서 JSON 백업을 받고, 새 교사 화면의 **백업 불러오기**로 가져옵니다.
- 기존 서버의 `events.sqlite3` 파일과 교사 비밀번호 형식을 그대로 사용합니다. 같은 영구 디스크와 DATA_DIR를 유지하면 기존 기록이 남습니다.
- `ADMIN_PASSWORD`는 빈 DB의 최초 설정에만 쓰입니다. 기존 비밀번호는 교사 화면에서 변경하거나 서버 콘솔에서 `python reset_password.py`로 재설정합니다.
- JSON 기록 백업에는 비밀번호가 포함되지 않습니다.
- 저장 실패 안내가 나타나면 수정본을 내려받아 보관하고 최신 기록을 다시 불러옵니다. 동시 학생 제출은 각각 저장하며, 오래된 교사 화면의 전체 덮어쓰기는 차단합니다.

## 검증

`python -m unittest -v test_server.py`로 서버 검증을 실행할 수 있습니다. 공개 조회·로그인 없는 제출·교사 권한·점수 상세 비공개·동시 제출·충돌 처리·기간 검사·기록 유지와 브라우저 동작을 확인했습니다. 실제 Render 배포는 아직 실행하지 않았습니다.
