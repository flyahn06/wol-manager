document.addEventListener('DOMContentLoaded', () => {
  const targetSelect = document.getElementById('targetSelect');
  const passwordInput = document.getElementById('password');
  const togglePasswordBtn = document.getElementById('togglePassword');
  const wakeBtn = document.getElementById('wakeBtn');
  const wakeBtnText = document.getElementById('wakeBtnText');
  const statusMessage = document.getElementById('statusMessage');

  // 등록된 장비가 없어 폼이 렌더링되지 않은 경우 종료
  if (!wakeBtn || !passwordInput) return;

  const statusTitle = statusMessage.querySelector('.status-title');
  const statusDesc = statusMessage.querySelector('.status-desc');
  const statusIcon = statusMessage.querySelector('.status-icon i');

  // 1. 대상 기기 변경 시 버튼 텍스트 업데이트
  function updateButtonLabel() {
    if (targetSelect && targetSelect.selectedOptions.length > 0) {
      const selectedName = targetSelect.selectedOptions[0].text;
      wakeBtnText.textContent = `${selectedName} 켜기`;
    } else {
      wakeBtnText.textContent = '장비 켜기';
    }
  }

  if (targetSelect) {
    targetSelect.addEventListener('change', updateButtonLabel);
    updateButtonLabel();
  }

  // 2. 비밀번호 표시/숨기기 토글
  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      
      const icon = togglePasswordBtn.querySelector('i');
      if (isPassword) {
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
      } else {
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
      }
    });
  }

  // 3. 엔터 키 누를 때 바로 전송
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      triggerWake();
    }
  });

  // 4. 전원 버튼 클릭
  wakeBtn.addEventListener('click', () => {
    triggerWake();
  });

  // 전원 켜기 실행 함수
  async function triggerWake() {
    const password = passwordInput.value.trim();
    const targetId = targetSelect ? targetSelect.value : '';
    const targetName = targetSelect && targetSelect.selectedOptions.length > 0 
      ? targetSelect.selectedOptions[0].text 
      : '장비';

    if (!password) {
      showStatus('error', '비밀번호를 입력하세요', '명령을 실행하려면 비밀번호가 필요합니다.');
      passwordInput.focus();
      return;
    }

    // 버튼 로딩 상태
    setLoading(true);
    showStatus('loading', '매직 패킷 전송 중...', `${targetName}으로 Wake-on-LAN 패킷을 전송하고 있습니다.`);

    try {
      const response = await fetch('/api/wake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          password: password,
          targetId: targetId
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        showStatus('success', '전송 완료!', data.message || `${targetName}으로 패킷이 정상 전송되었습니다.`);
        passwordInput.value = '';
      } else {
        showStatus('error', '전송 실패', data.message || '패킷 전송 중 오류가 발생했습니다.');
      }
    } catch (err) {
      showStatus('error', '네트워크 오류', err.message || '서버와의 통신에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  function setLoading(isLoading) {
    wakeBtn.disabled = isLoading;
    const btnIcon = wakeBtn.querySelector('i');

    if (isLoading) {
      btnIcon.className = 'fa-solid fa-spinner fa-spin';
      wakeBtnText.textContent = '실행 중...';
    } else {
      btnIcon.className = 'fa-solid fa-power-off';
      updateButtonLabel();
    }
  }

  function showStatus(type, title, desc) {
    statusMessage.className = `status-message ${type}`;
    statusTitle.textContent = title;
    statusDesc.textContent = desc || '';

    statusIcon.className = '';
    if (type === 'loading') {
      statusIcon.className = 'fa-solid fa-circle-notch fa-spin';
    } else if (type === 'success') {
      statusIcon.className = 'fa-solid fa-circle-check';
    } else if (type === 'error') {
      statusIcon.className = 'fa-solid fa-circle-xmark';
    }
  }
});
