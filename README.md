# Wake-on-LAN (WOL) Web App

비밀번호 인증을 통해 원격 장비(Workstation, NAS 등)를 선택하여 부팅할 수 있는 안전하고 간편한 Wake-on-LAN 웹 애플리케이션입니다.

---

## ⚙️ 설정 방법

1. **설정 파일 생성**:
   ```bash
   cp config_example.json config.json
   ```

2. **비밀번호 설정 (`hash_password.py`)**:
   ```bash
   python3 hash_password.py
   ```
   * 비밀번호를 입력하면 안전한 `scrypt` 해시가 자동 생성되어 `config.json`에 저장됩니다.

3. **장비 목록 편집 (`config.json`)**:
   ```json
   {
     "passwordHash": "scrypt$16384$8$1$...",
     "wolCommand": "wakeonlan",
     "targets": [
       {
         "id": "workstation",
         "name": "Workstation",
         "mac": "AA:BB:CC:DD:EE:FF"
       },
       {
         "id": "nas",
         "name": "Home NAS",
         "mac": "00:11:22:33:44:55"
       }
     ]
   }
   ```
   * **`targets`**: 부팅할 장비 목록 (`id`, `name`, `mac`)
   * **`wolCommand`**: 서버에서 실행할 WOL 명령어 (기본값: `wakeonlan`)

> 보안상 브라우저에는 `id`와 `name`만 전달되며, MAC 주소는 서버 내부에서만 안전하게 사용됩니다.

---

## 🚀 실행 방법

```bash
# 비밀번호 생성
python3 hash_password.py

# 의존성 설치 (최초 1회)
npm install

# 서버 시작
npm start

# 또는 포트 지정 실행
PORT=8080 npm start
```

서버 실행 후 브라우저에서 `http://localhost:3000`으로 접속하세요.

---

## 🛡️ 주요 보안 기능

1. **대상 장비 화이트리스트 검증**:
   - 클라이언트에서 임의의 MAC 주소를 전송할 수 없으며, 서버에 미리 등록된 장비(`id`)만 지정하여 부팅합니다.
2. **scrypt 단방향 암호화 해시**:
   - 비밀번호는 무작위 솔트(Salt)가 적용된 scrypt 알고리즘으로 안전하게 저장 및 검증됩니다.
3. **무차별 대입 공격(Brute-Force) 차단**:
   - Cloudflare 프록시 환경(`cf-connecting-ip`)을 지원하며, 5회 연속 비밀번호 오류 시 5분간 요청이 자동 차단됩니다.
4. **타이밍 공격(Timing Attack) 방어**:
   - `crypto.timingSafeEqual` 상수 시간 비교로 미세한 연산 시간 차이를 통한 비밀번호 유추를 원천 차단합니다.
5. **보안 헤더 및 정보 노출 차단**:
   - `X-Frame-Options: DENY`, MIME 스니핑 방지 헤더, `x-powered-by` 비활성화 및 에러 페이지 내 스택 트레이스 노출 방지.
