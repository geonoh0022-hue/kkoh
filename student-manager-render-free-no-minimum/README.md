# 우리 반 기록장 — Render 무료 + Neon 무료 저장

웹사이트는 Render Free에서, 기록은 Neon Free PostgreSQL에서 보관합니다. Render가 절전·재시작·재배포되어도 외부 DB의 기록은 유지됩니다. 유료 디스크와 Render Postgres는 만들지 않습니다.

무료 플랜과 계정이 유지되고 사용량 한도 내에 있는 동안 장기 사용 가능한 구성입니다. 업체의 정책 변경이나 서비스 종료까지 포함해 평생 무료·영구 보존을 보장하는 상품은 아닙니다.

## 1. Neon 무료 DB 만들기

1. https://neon.com 에 가입하고 **Free** 요금제에서 프로젝트를 만듭니다.
2. 이름은 자유롭게 정하고 가능하면 Render와 가까운 지역을 선택합니다.
3. 프로젝트의 **Connect**에서 PostgreSQL 연결 문자열(Connection string)을 복사합니다. `postgresql://` 또는 `postgres://`로 시작하는 전체 문자열입니다. `psql` 명령어와 바깥 따옴표는 제외합니다.
4. 이 값은 DB 비밀번호를 포함합니다. GitHub 파일에 넣지 말고 아래 Render 환경 변수에만 입력합니다.

SQL을 직접 실행할 필요 없이 앱이 처음 시작할 때 테이블을 만듭니다. 재배포해도 기존 기록을 초기화하지 않습니다.

## 2. GitHub에 업로드

1. ZIP을 압축 해제합니다.
2. GitHub에서 **Private** 저장소를 만듭니다.
3. 압축을 푼 파일들과 `public` 폴더를 올립니다. `package.json`, `package-lock.json`, `render.yaml`, `server.cjs`가 저장소 최상위에 있어야 합니다. ZIP 자체를 올리면 안 됩니다.
4. 실제 학생 JSON 백업이나 비밀번호는 올리지 않습니다.

## 3. Render 무료 배포

1. Render에서 GitHub 계정을 연결하고 **New → Blueprint**에서 위 저장소를 선택합니다.
2. 설정이 **Free**인지 확인합니다. 이 ZIP은 `plan: free`이며 유료 디스크나 DB를 생성하지 않습니다.
3. 다음 두 값을 입력합니다.

| 환경 변수 | 입력할 값 |
|---|---|
| `DATABASE_URL` | Neon에서 복사한 전체 연결 문자열 |
| `ADMIN_PASSWORD` | 직접 정한 비밀번호 (최소 길이 제한 없음, 빈 값은 불가) |

4. 배포 완료 후 `https://…onrender.com`에 접속합니다.
5. 아이디 **admin**, 위에서 정한 비밀번호로 로그인합니다.
6. 테스트 기록 하나를 저장하고 새로고침합니다. Render 재배포 후 다시 로그인했을 때도 기록이 보이는지 확인합니다.

수동 생성: **New → Web Service → Node → Free** / Build Command `npm ci --omit=dev` / Start Command `npm start`. 환경 변수는 위 두 개와 `NODE_ENV=production`, `NODE_VERSION=24.19.0`, `ADMIN_USERNAME=admin`입니다. Disk와 Render Postgres는 추가하지 않습니다.

## 이전 버전의 기록 옮기기

이전 HTML을 사용했다면 원래 브라우저에서 **백업 저장** 후 새 사이트에서 **백업 불러오기**를 하세요. HTML 파일 자체에는 브라우저의 학생 기록이 포함되지 않습니다. v1/v2 JSON을 지원하며 복원은 서버 전체 기록을 교체합니다.

이전 유료 구성으로 이미 배포했다면:

1. 기존 사이트에서 먼저 JSON 백업을 내려받습니다.
2. 이 ZIP으로 별도의 새 Free 서비스를 만들고 Neon을 연결합니다.
3. 새 사이트에서 백업을 복원하고 명단·기록을 확인합니다.
4. 이전이 확인된 뒤 기존 유료 서비스와 디스크를 직접 정리해야 기존 요금이 중단됩니다. 백업 전에 기존 디스크를 삭제하지 마세요.

## 무료 사용과 데이터 보관

- Render Free는 15분간 요청이 없으면 절전됩니다. 다음 접속 시 약 1분 걸릴 수 있습니다. 재시작 후에는 다시 로그인하지만 기록은 Neon에 남습니다.
- Render 무료 시간은 워크스페이스 전체 월 750시간으로 다른 무료 웹 서비스와 공유합니다. 대역폭·빌드 한도도 적용됩니다.
- 현재 Neon Free는 프로젝트당 0.5GB 저장 공간, 월 100 CU-hours 연산, 월 5GB 외부 전송량을 제공합니다. 이용량은 Neon 대시보드에서 확인합니다.
- 화면을 열거나 저장할 때만 DB를 조회하며 주기적 폴링은 하지 않습니다. 별도 상시 접속 봇을 설정할 필요가 없습니다.
- JSON 백업을 정기적으로 별도 보관하세요. 엑셀은 열람용이고 복원은 JSON으로 합니다.
- 다른 기기의 수정 내용은 새로고침하면 보입니다. 오래된 화면의 덮어쓰기는 차단됩니다. 충돌 시 입력 내용을 복사한 후 새로고침하세요.
- 네트워크 실패 시 저장 성공 안내가 나오지 않습니다. 입력 내용을 유지하고 재시도하세요. 전체 JSON 기록 크기는 약 20MB까지로 설계되어 DB 총 용량 한도와 별개입니다.
- 배포 시 `DATABASE_URL` 누락 또는 DB 연결 오류가 있으면 시작에 실패합니다. Render 임시 파일로 대신 저장하지 않습니다.

## 계정 변경

Render Environment에서 `ADMIN_PASSWORD` 또는 `ADMIN_USERNAME` 변경 후 재배포합니다. 회원가입 기능은 없습니다. 로그인은 최대 8시간이며 재시작 시 종료됩니다. 로그인 실패 10회 시 15분 제한됩니다.

## 로컬 실행 / 검증 (선택)

Node.js 24에서 `npm ci` 후 PowerShell:

```powershell
$env:ADMIN_PASSWORD='직접 정한 비밀번호'
node server.cjs
```

`http://localhost:3000`에서 엽니다. 배포 환경이 아닌 로컬에서만 `DATABASE_URL` 생략 시 SQLite를 사용합니다. 로컬에서도 Neon을 쓰려면 `DATABASE_URL`을 지정하세요. 테스트 시 별도 프로젝트를 사용하세요.

`npm test`: 로그인·권한·충돌·로컬 재시작 복원·화면 저장 핸들러와 PGlite의 PostgreSQL 엔진으로 DB 쿼리를 검사합니다. 실제 Neon 계정 연결과 Render 배포는 사용자 설정 후 위 3단계에서 확인합니다.

## 공식 자료 (2026-09-23 확인)

- Render 무료 제한: https://render.com/docs/free
- Neon 무료 한도: https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md
- Neon 절전: https://neon.com/blog/building-patterns-unlocked-by-scale-to-zero
- Neon 공식 연결 드라이버: https://github.com/neondatabase/serverless

무료 정책과 사용량 한도는 바뀔 수 있습니다.
