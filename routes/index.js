const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 설정 불러오기
function getConfig() {
  const configPath = path.join(__dirname, '..', 'config.json');
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

  return {
    passwordHash: process.env.WOL_PASSWORD_HASH || config.passwordHash || '',
    wolCommand: process.env.WOL_COMMAND || config.wolCommand || 'wakeonlan',
    targets: Array.isArray(config.targets) ? config.targets : []
  };
}

// -------------------------------------------------------------
// Rate Limiter (Brute-Force 방어 인메모리 관리자)
// -------------------------------------------------------------
const loginAttempts = new Map(); // ip -> { count, lockedUntil }
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_TIME_MS = 5 * 60 * 1000; // 5분 잠금

// 주기적으로 만료된 IP 기록 정리 (10분마다)
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if (record.lockedUntil && record.lockedUntil < now) {
      loginAttempts.delete(ip);
    }
  }
}, 10 * 60 * 1000);

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };

  if (record.lockedUntil && record.lockedUntil > now) {
    const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
    return {
      allowed: false,
      message: `비밀번호 연속 오류로 일시 차단되었습니다. ${remainingSec}초 후에 다시 시도해주세요.`
    };
  }

  if (record.lockedUntil && record.lockedUntil <= now) {
    loginAttempts.delete(ip);
  }

  return { allowed: true };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCK_TIME_MS;
  }
  loginAttempts.set(ip, record);

  const remaining = Math.max(0, MAX_FAILED_ATTEMPTS - record.count);
  return remaining;
}

function resetAttempts(ip) {
  loginAttempts.delete(ip);
}

// -------------------------------------------------------------
// 비밀번호 해시 검증 (scrypt 기반 + timingSafeEqual)
// -------------------------------------------------------------
function verifyPassword(inputPassword, passwordHash) {
  if (!inputPassword || !passwordHash || !passwordHash.startsWith('scrypt$')) {
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

      const derivedKey = crypto.scryptSync(inputPassword, salt, expectedHash.length, {
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
router.post('/api/wake', function(req, res) {
  const clientIp = req.headers['cf-connecting-ip'] || req.ip || req.connection.remoteAddress || 'unknown';

  // 1. Rate Limiting 검사
  const rateLimit = checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    return res.status(429).json({
      success: false,
      message: rateLimit.message
    });
  }

  const { password, targetId } = req.body;
  const config = getConfig();

  // 2. 비밀번호 해시 설정 여부 확인
  if (!config.passwordHash) {
    return res.status(500).json({
      success: false,
      message: '서버에 비밀번호 해시가 설정되어 있지 않습니다. hash_password.py를 실행하세요.'
    });
  }

  // 3. 비밀번호 해시 검증
  const isValid = verifyPassword(password, config.passwordHash);
  if (!isValid) {
    const remaining = recordFailedAttempt(clientIp);
    const message = remaining > 0 
      ? `비밀번호가 올바르지 않습니다. (남은 시도 횟수: ${remaining}회)`
      : `비밀번호 5회 오류로 5분간 시도가 제한됩니다.`;

    return res.status(401).json({
      success: false,
      message: message
    });
  }

  // 인증 성공 시 실패 카운트 리셋
  resetAttempts(clientIp);

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

  // 5. wol 명령어 안전 실행 (execFile)
  const command = config.wolCommand;
  execFile(command, [mac], (error, stdout, stderr) => {
    if (error) {
      console.error(`명령 실행 실패 [${command} ${mac}]:`, error);
      return res.status(500).json({
        success: false,
        message: 'Wake-on-LAN 패킷 전송 중 서버 오류가 발생했습니다.'
      });
    }

    return res.json({
      success: true,
      message: `${target.name}으로 Wake-on-LAN 패킷을 전송했습니다!`
    });
  });
});

module.exports = router;
