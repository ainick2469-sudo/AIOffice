"""Local secrets vault helpers.

We store per-agent API keys encrypted-at-rest when possible.

- On Windows, we try DPAPI (CryptProtectData/CryptUnprotectData) tied to the current user.
- If DPAPI is unavailable or fails (or on non-Windows), we fall back to a plaintext-encoded
  value with a loud warning in logs. This keeps the app functional in dev environments.

This module intentionally does not depend on database/runtime modules to avoid import cycles.
"""

from __future__ import annotations

import base64
import ctypes
import logging
import os
from ctypes import wintypes

logger = logging.getLogger("ai-office.secrets")

_PLAINTEXT_WARNED = False


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


def _dpapi_encrypt(data: bytes) -> bytes:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    in_buf = ctypes.create_string_buffer(data)
    in_blob = _DataBlob(len(data), ctypes.cast(in_buf, ctypes.POINTER(ctypes.c_byte)))
    out_blob = _DataBlob()

    if not crypt32.CryptProtectData(
        ctypes.byref(in_blob),
        None,
        None,
        None,
        None,
        0,
        ctypes.byref(out_blob),
    ):
        raise OSError("CryptProtectData failed")

    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        if out_blob.pbData:
            kernel32.LocalFree(out_blob.pbData)


def _dpapi_decrypt(data: bytes) -> bytes:
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    in_buf = ctypes.create_string_buffer(data)
    in_blob = _DataBlob(len(data), ctypes.cast(in_buf, ctypes.POINTER(ctypes.c_byte)))
    out_blob = _DataBlob()

    if not crypt32.CryptUnprotectData(
        ctypes.byref(in_blob),
        None,
        None,
        None,
        None,
        0,
        ctypes.byref(out_blob),
    ):
        raise OSError("CryptUnprotectData failed")

    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        if out_blob.pbData:
            kernel32.LocalFree(out_blob.pbData)


def _encode_plaintext(secret: str) -> str:
    global _PLAINTEXT_WARNED
    if not _PLAINTEXT_WARNED:
        _PLAINTEXT_WARNED = True
        logger.warning(
            "Secrets vault using PLAINTEXT fallback. Keys are stored locally (base64) without encryption."
        )
    return "PLAINTEXT:" + base64.b64encode(secret.encode("utf-8")).decode("ascii")


def encrypt_secret(secret: str) -> str:
    secret = (secret or "").strip()
    if not secret:
        return ""

    force_plaintext = (os.environ.get("AI_OFFICE_SECRETS_FORCE_PLAINTEXT") or "").strip() == "1"
    if force_plaintext:
        return _encode_plaintext(secret)

    if os.name == "nt":
        try:
            blob = _dpapi_encrypt(secret.encode("utf-8"))
            return "DPAPI:" + base64.b64encode(blob).decode("ascii")
        except Exception:
            return _encode_plaintext(secret)

    return _encode_plaintext(secret)


def decrypt_secret(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""

    if value.startswith("DPAPI:"):
        raw = base64.b64decode(value.split(":", 1)[1].encode("ascii"))
        decrypted = _dpapi_decrypt(raw)
        return decrypted.decode("utf-8", errors="replace")

    if value.startswith("PLAINTEXT:"):
        raw = base64.b64decode(value.split(":", 1)[1].encode("ascii"))
        return raw.decode("utf-8", errors="replace")

    # Backwards compatibility: treat unknown prefix as plaintext.
    return value

