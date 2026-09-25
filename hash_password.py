#!/usr/bin/env python3
"""
Wake-on-LAN 안전한 비밀번호 해시 생성기
외부 패키지 설치 없이 Python 표준 라이브러리(hashlib, secrets, getpass)만으로 동작합니다.
메모리-하드(Memory-hard) 알고리즘인 scrypt를 사용합니다.
"""

import os
import sys
import json
import getpass
import hashlib
import secrets

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")

# scrypt 권장 파라미터
SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1
KEY_LEN = 32

def generate_hash(password: str) -> str:
    """비밀번호와 암호학적 무작위 솔트(Salt)를 이용해 scrypt 해시를 생성합니다."""
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        maxmem=0,
        dklen=KEY_LEN
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${derived.hex()}"

def update_config(hash_value: str) -> bool:
    """config.json 파일에 생성된 passwordHash를 저장합니다."""
    if not os.path.exists(CONFIG_PATH):
        print(f"[!] {CONFIG_PATH} 파일이 없습니다.")
        return False

    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)

        data["passwordHash"] = hash_value

        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")

        return True
    except Exception as e:
        print(f"[!] config.json 업데이트 중 오류 발생: {e}")
        return False

def main():
    print("=" * 55)
    print(" 🔐 Wake-on-LAN 비밀번호 해시 생성 및 설정 도구")
    print("=" * 55)

    # 1. 비밀번호 입력 (화면에 글자가 보이지 않음)
    while True:
        try:
            pw1 = getpass.getpass("새 비밀번호 입력: ")
        except (KeyboardInterrupt, EOFError):
            print("\n취소되었습니다.")
            sys.exit(0)

        if not pw1:
            print("[-] 비밀번호를 입력해주세요.\n")
            continue

        try:
            pw2 = getpass.getpass("비밀번호 확인: ")
        except (KeyboardInterrupt, EOFError):
            print("\n취소되었습니다.")
            sys.exit(0)

        if pw1 != pw2:
            print("[-] 비밀번호가 일치하지 않습니다. 다시 입력해주세요.\n")
            continue
        break

    # 2. scrypt 해시 생성
    hash_str = generate_hash(pw1)
    print("\n[+] 안전한 scrypt 해시가 생성되었습니다:")
    print(f"    {hash_str}\n")

    # 3. config.json 자동 반영 여부 질문
    try:
        choice = input(f"config.json에 이 해시를 바로 저장하시겠습니까? [Y/n]: ").strip().lower()
    except (KeyboardInterrupt, EOFError):
        print("\n종료합니다.")
        sys.exit(0)

    if choice in ("", "y", "yes"):
        if update_config(hash_str):
            print("[✔] config.json 에 비밀번호 해시가 성공적으로 저장되었습니다!")
        else:
            print("[!] 수동으로 config.json의 'passwordHash' 필드에 위 값을 넣어주세요.")
    else:
        print("[i] 설정을 변경하지 않았습니다. 필요 시 config.json에 직접 입력하세요:")
        print(f'    "passwordHash": "{hash_str}"')

if __name__ == "__main__":
    main()
