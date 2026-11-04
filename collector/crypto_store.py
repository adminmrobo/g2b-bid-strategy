# -*- coding: utf-8 -*-
"""비밀번호 기반 암호화 저장.

형식: b"G2B1" + salt(16) + iv(12) + AES-256-GCM(gzip(JSON))
키:   PBKDF2-HMAC-SHA256(password, salt, 250,000회) → 32바이트
브라우저(docs/app.js)의 WebCrypto 복호화와 같은 형식이다.
"""
import gzip
import hashlib
import json
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

MAGIC = b"G2B1"
ITER = 250_000
_key_cache = {}


def _key(password, salt):
    k = (password, salt)
    if k not in _key_cache:
        kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER)
        _key_cache[k] = kdf.derive(password.encode("utf-8"))
    return _key_cache[k]


def encrypt_obj(obj, password, salt=None):
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    gz = gzip.compress(raw, compresslevel=9, mtime=0)
    salt = salt or os.urandom(16)
    iv = os.urandom(12)
    ct = AESGCM(_key(password, salt)).encrypt(iv, gz, None)
    return MAGIC + salt + iv + ct


def decrypt_obj(blob, password):
    if blob[:4] != MAGIC:
        raise ValueError("형식이 다른 파일")
    salt, iv, ct = blob[4:20], blob[20:32], blob[32:]
    gz = AESGCM(_key(password, salt)).decrypt(iv, ct, None)
    return json.loads(gzip.decompress(gz).decode("utf-8"))


def digest(obj):
    raw = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def write_if_changed(path, obj, password, manifest, meta=None, key=None):
    """내용이 바뀐 경우에만 다시 암호화해 쓴다(매번 새 salt라 그냥 쓰면 git 이력이 불어남)."""
    h = digest(obj)
    rel = key or path.replace("\\", "/")
    if manifest.get(rel, {}).get("h") == h and os.path.exists(path):
        manifest[rel].update(meta or {})
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(encrypt_obj(obj, password))
    manifest[rel] = {"h": h, **(meta or {})}
    return True


def read(path, password):
    with open(path, "rb") as f:
        return decrypt_obj(f.read(), password)
