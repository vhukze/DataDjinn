from __future__ import annotations

import base64
import json
import os
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

SYNC_ENVELOPE_VERSION = 1
SYNC_ASSOCIATED_DATA = b"DataDjinn sync payload v1"


def encrypt_sync_payload(payload: dict[str, Any], passphrase: str) -> dict[str, Any]:
    normalized_passphrase = _validate_passphrase(passphrase)
    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = _derive_key(normalized_passphrase, salt)
    plaintext = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, SYNC_ASSOCIATED_DATA)
    return {
        "version": SYNC_ENVELOPE_VERSION,
        "kdf": "scrypt",
        "cipher": "aes-256-gcm",
        "salt": _encode(salt),
        "nonce": _encode(nonce),
        "ciphertext": _encode(ciphertext),
    }


def decrypt_sync_payload(envelope: dict[str, Any], passphrase: str) -> dict[str, Any]:
    if envelope.get("version") != SYNC_ENVELOPE_VERSION:
        raise ValueError("不支持的 DataDjinn 同步文件版本")
    normalized_passphrase = _validate_passphrase(passphrase)
    try:
        salt = _decode_required(envelope, "salt")
        nonce = _decode_required(envelope, "nonce")
        ciphertext = _decode_required(envelope, "ciphertext")
        plaintext = AESGCM(_derive_key(normalized_passphrase, salt)).decrypt(
            nonce, ciphertext, SYNC_ASSOCIATED_DATA
        )
        payload = json.loads(plaintext.decode("utf-8"))
    except (InvalidTag, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise ValueError("同步口令错误或远程同步文件已损坏") from exc
    if not isinstance(payload, dict):
        raise ValueError("远程同步文件格式无效")
    return payload


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=32, n=2**15, r=8, p=1).derive(passphrase.encode("utf-8"))


def _validate_passphrase(passphrase: str) -> str:
    normalized = passphrase.strip()
    if len(normalized) < 8:
        raise ValueError("同步口令至少需要 8 个字符")
    return normalized


def _encode(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _decode_required(envelope: dict[str, Any], key: str) -> bytes:
    value = envelope.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError("同步加密包缺少必要字段")
    return base64.b64decode(value, validate=True)
