const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const dgram = require('dgram');

const scryptAsync = promisify(crypto.scrypt);

// -------------------------------------------------------------
// 설정 캐싱 및 자동 갱신
// -------------------------------------------------------------
const configPath = path.join(__dirname, '..', 'config.json');
let cachedConfig = null;

function loadConfig() {
  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(data);
    } else {
      console.warn('[경고] config.json 파일이 존재하지 않습니다. config_example.json을 참고하여 생성해주세요.');
    }
  } catch (err) {
    console.error('config.json 읽기 오류:', err);
  }

  cachedConfig = {
    passwordHash: process.env.WOL_PASSWORD_HASH || config.passwordHash || '',
    wolCommand: process.env.WOL_COMMAND || config.wolCommand || 'builtin',
    targets: Array.isArray(config.targets) ? config.targets : []
  };

  return cachedConfig;
}

// 파일 변경 감지 (존재할 경우)
try {
  if (fs.existsSync(configPath)) {
    fs.watch(configPath, { persistent: false }, (eventType) => {
      if (eventType === 'change') {
        loadConfig();
      }
    });
  }
} catch (e) {
  // watch 실패 시 무시하고 캐시 사용
}

function getConfig() {
  return cachedConfig || loadConfig();
}

// 초기 로드
loadConfig();

const { rateLimit } = require('express-rate-limit');

// -------------------------------------------------------------
// Rate Limiter (Brute-Force 방어 미들웨어)
// -------------------------------------------------------------
const wakeRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분 슬라이딩 윈도우
  limit: 5, // 최대 5회 실패 허용
  skipSuccessfulRequests: true, // 2xx 성공 응답 시에는 실패 카운트 제외 (실패만 카운트)
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: '비밀번호 연속 오류로 일시 차단되었습니다. 잠시 후 다시 시도해주세요.'
  }
});

// -------------------------------------------------------------
// 비밀번호 해시 비동기 검증 (scrypt 비동기 + timingSafeEqual)
// -------------------------------------------------------------
async function verifyPassword(inputPassword, passwordHash) {
  if (typeof inputPassword !== 'string' || !inputPassword || !passwordHash || !passwordHash.startsWith('scrypt$')) {
    return false;
  }

  try {
    const parts = passwordHash.split('$');
    // 포맷: scrypt$cost(N)$blockSize(r)$parallel(p)$saltHex$hashHex
    if (parts.length === 6) {
      const cost = parseInt(parts[1], 10);
      const blockSize = parseInt(parts[2], 10);
      const parallel = parseInt(parts[3], 10);
      const salt = Buffer.from(parts[4], 'hex');
      const expectedHash = Buffer.from(parts[5], 'hex');

      // 비동기 처리: libuv 스레드풀에서 실행되어 메인 이벤트 루프 블로킹 방지
      const derivedKey = await scryptAsync(inputPassword, salt, expectedHash.length, {
        N: cost,
        r: blockSize,
        p: parallel,
        maxmem: 64 * 1024 * 1024
      });

      if (derivedKey.length !== expectedHash.length) return false;
      return crypto.timingSafeEqual(derivedKey, expectedHash);
    }
  } catch (err) {
    console.error('해시 검증 중 오류:', err);
  }

  return false;
}

// -------------------------------------------------------------
// 내장 Wake-on-LAN UDP 매직 패킷 브로드캐스트
// -------------------------------------------------------------
function sendMagicPacketNative(macAddress, broadcastIp = '255.255.255.255', port = 9) {
  return new Promise((resolve, reject) => {
    const cleanMac = macAddress.replace(/[:-]/g, '');
    const macBuffer = Buffer.from(cleanMac, 'hex');
    const magicPacket = Buffer.alloc(102);
    magicPacket.fill(0xff, 0, 6);
    for (let i = 0; i < 16; i++) {
      macBuffer.copy(magicPacket, 6 + i * 6);
    }

    const client = dgram.createSocket('udp4');
    client.bind(() => {
      client.setBroadcast(true);
      client.send(magicPacket, 0, magicPacket.length, port, broadcastIp, (err) => {
        client.close();
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

/* GET home page. */
router.get('/', function(req, res, next) {
  const config = getConfig();
  const safeTargets = config.targets.map(t => ({
    id: t.id,
    name: t.name
  }));

  res.render('index', { 
    title: 'WOL Manager',
    targets: safeTargets
  });
});

/* POST wake request */
router.post('/api/wake', wakeRateLimiter, async function(req, res) {
  const { password, targetId } = req.body;

  // 입력값 타입 및 길이 검증 (Type Confusion 및 DoS 방어)
  if (typeof password !== 'string' || password.length === 0 || password.length > 128) {
    return res.status(400).json({
      success: false,
      message: '비밀번호 입력이 올바르지 않습니다.'
    });
  }

  if (typeof targetId !== 'string' || targetId.length === 0 || targetId.length > 64) {
    return res.status(400).json({
      success: false,
      message: '대상 장비 선택이 올바르지 않습니다.'
    });
  }

  const config = getConfig();

  // 1. 비밀번호 해시 설정 여부 확인
  if (!config.passwordHash) {
    return res.status(500).json({
      success: false,
      message: '서버에 비밀번호 해시가 설정되어 있지 않습니다. hash_password.py를 실행하세요.'
    });
  }

  // 2. 비밀번호 해시 비동기 검증
  const isValid = await verifyPassword(password, config.passwordHash);
  if (!isValid) {
    return res.status(401).json({
      success: false,
      message: '비밀번호가 올바르지 않습니다.'
    });
  }

  // 4. 대상 장비 조회
  if (config.targets.length === 0) {
    return res.status(400).json({
      success: false,
      message: '등록된 대상 장비가 없습니다. config.json을 확인해주세요.'
    });
  }

  const target = config.targets.find(t => t.id === targetId);
  if (!target || !target.mac) {
    return res.status(400).json({
      success: false,
      message: '선택한 대상 장비를 찾을 수 없습니다.'
    });
  }

  const mac = target.mac.trim();
  const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;
  if (!macRegex.test(mac)) {
    return res.status(400).json({
      success: false,
      message: '서버에 설정된 MAC 주소 형식이 올바르지 않습니다. 관리자에게 문의하세요.'
    });
  }

  // 5. WOL 패킷 전송 (외부 CLI 지정 시 우선 실행, 실패하거나 미지정 시 내장 UDP 전송)
  const command = config.wolCommand;
  if (command && command !== 'builtin' && command !== 'native') {
    execFile(command, [mac], async (error, stdout, stderr) => {
      if (error) {
        console.warn(`CLI 실행 실패 [${command} ${mac}], 내장 UDP 소켓으로 전송을 시도합니다:`, error.message);
        try {
          await sendMagicPacketNative(mac);
          return res.json({
            success: true,
            message: `${target.name}으로 Wake-on-LAN 패킷을 전송했습니다!`
          });
        } catch (nativeErr) {
          console.error('내장 WOL 전송 실패:', nativeErr);
          return res.status(500).json({
            success: false,
            message: 'Wake-on-LAN 패킷 전송 중 서버 오류가 발생했습니다.'
          });
        }
      }

      return res.json({
        success: true,
        message: `${target.name}으로 Wake-on-LAN 패킷을 전송했습니다!`
      });
    });
  } else {
    try {
      await sendMagicPacketNative(mac);
      return res.json({
        success: true,
        message: `${target.name}으로 Wake-on-LAN 패킷을 전송했습니다!`
      });
    } catch (err) {
      console.error('WOL 패킷 전송 실패:', err);
      return res.status(500).json({
        success: false,
        message: 'Wake-on-LAN 패킷 전송 중 서버 오류가 발생했습니다.'
      });
    }
  }
});

module.exports = router;
