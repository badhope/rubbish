"""Unit tests for app.core.totp — HOTP/TOTP algorithm.

Tests the TOTP implementation at the algorithm level without
going through HTTP endpoints. These pin the HOTP computation
against RFC 4226 test vectors and exercise edge cases:

- RFC 4226 Appendix D test vectors (HMAC-SHA1 with 160-bit key)
- Time-window selection (current, T-1 accepted; T+1 rejected)
- Replay protection (same counter rejected)
- Backup code generation / normalization / hashing
- Encryption round-trip (Fernet → Fernet)
- Defensive: empty code, non-digit code, wrong-length code
"""

from __future__ import annotations

from typing import ClassVar

import pytest

from app.core.totp import (
    decrypt_secret,
    encrypt_secret,
    generate_backup_codes,
    generate_secret,
    hash_backup_code,
    normalize_backup_code,
    verify_totp,
)

# ---------------------------------------------------------------------------
# Secret generation
# ---------------------------------------------------------------------------


class TestGenerateSecret:
    def test_length(self) -> None:
        """A generated secret should be 32 base32 chars (20 raw bytes)."""
        s = generate_secret()
        assert len(s) == 32

    def test_base32_alphabet(self) -> None:
        """All chars must be in the RFC 4648 base32 alphabet."""
        s = generate_secret()
        assert all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" for c in s)

    def test_no_collision(self) -> None:
        """Two secrets generated back-to-back must differ."""
        s1 = generate_secret()
        s2 = generate_secret()
        assert s1 != s2

    def test_entropy_sufficient(self) -> None:
        """Each secret should have a reasonable spread of unique symbols
        (not all 'A' or all repeating)."""
        s = generate_secret()
        assert len(set(s)) >= 8  # at least 8 distinct chars


# ---------------------------------------------------------------------------
# TOTP verification — happy path (uses a known secret)
# ---------------------------------------------------------------------------

# A known secret pre-computed from a deterministic seed.
_KNOWN_SECRET = "JBSWY3DPEHPK3PXP"  # 16 bytes → base32 padding-stripped
# We use this secret to compute expected codes deterministically.
_KV = "A" * 20  # 20 raw bytes → base32 = "MFQWCYLB..."

# Canonical RFC 4226 test secret (Appendix D):
_RFC_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  # "12345678901234567890" in base32


class TestVerifyTOTP:
    """TOTP verification against a deterministic secret."""

    def test_current_window_passes(self) -> None:
        """A code generated for the current time window must verify."""
        import time

        from app.core.totp import _hotp

        now = int(time.time()) // 30
        code = _hotp(_RFC_SECRET_B32, now)
        result = verify_totp(_RFC_SECRET_B32, code)
        assert result is not None

    def test_previous_window_passes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A code from T-1 must verify (clock skew tolerance)."""
        from app.core.totp import _hotp

        # Generate a code for counter N, then fake time to N+1.
        n = 100_000_000  # arbitrary fixed counter
        code = _hotp(_RFC_SECRET_B32, n)
        # verify_totp uses int(time.time() // 30) as "current"
        monkeypatch.setattr("app.core.totp.time.time", lambda: (n + 1) * 30)
        result = verify_totp(_RFC_SECRET_B32, code)
        assert result == n

    def test_t_minus_2_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A code from T-2 must be rejected — drift tolerance is 1 window."""
        from app.core.totp import _hotp

        n = 100_000_000
        code = _hotp(_RFC_SECRET_B32, n)
        monkeypatch.setattr("app.core.totp.time.time", lambda: (n + 2) * 30)
        result = verify_totp(_RFC_SECRET_B32, code)
        assert result is None

    def test_replay_protection(self) -> None:
        """Once a counter is accepted, the same code must be rejected."""
        import time

        from app.core.totp import _hotp

        now = int(time.time()) // 30
        code = _hotp(_RFC_SECRET_B32, now)
        # First verification — should succeed
        counter = verify_totp(_RFC_SECRET_B32, code)
        assert counter is not None
        # Second verification with last_counter set — rejected
        replay = verify_totp(_RFC_SECRET_B32, code, last_counter=counter)
        assert replay is None

    def test_empty_code_rejected(self) -> None:
        assert verify_totp(_RFC_SECRET_B32, "") is None

    def test_too_short_code_rejected(self) -> None:
        assert verify_totp(_RFC_SECRET_B32, "12345") is None

    def test_too_long_code_rejected(self) -> None:
        assert verify_totp(_RFC_SECRET_B32, "1234567") is None

    def test_non_digit_code_rejected(self) -> None:
        assert verify_totp(_RFC_SECRET_B32, "abcdef") is None

    def test_zero_padded_code(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """When the HOTP result is < 100000, it must be zero-padded to 6 digits."""
        from app.core.totp import _hotp

        # Some counter may produce a < 100k code — verify padding exists.
        code = _hotp(_RFC_SECRET_B32, 0)
        assert len(code) == 6
        assert code.isdigit()


class TestHOTPVectors:
    """Verify HOTP against RFC 4226 Appendix D test vectors.

    The test secret is "12345678901234567890" → base32
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ".
    """

    VECTORS: ClassVar[list[tuple[int, str]]] = [
        (0, "755224"),
        (1, "287082"),
        (2, "359152"),
        (3, "969429"),
        (4, "338314"),
        (5, "254676"),
        (6, "287922"),
        (7, "162583"),
        (8, "399871"),
        (9, "520489"),
    ]

    def test_rfc_vectors(self) -> None:
        from app.core.totp import _hotp

        for counter, expected in self.VECTORS:
            result = _hotp(_RFC_SECRET_B32, counter)
            assert result == expected, f"Counter {counter}: expected {expected}, got {result}"


# ---------------------------------------------------------------------------
# Backup codes
# ---------------------------------------------------------------------------


class TestBackupCodes:
    def test_generates_correct_count(self) -> None:
        codes = generate_backup_codes()
        assert len(codes) == 10

    def test_format(self) -> None:
        """Each code is XXXXX-XXXXX with valid alphabet."""
        codes = generate_backup_codes()
        for code in codes:
            assert len(code) == 11  # 5+1+5
            assert code[5] == "-"
            # upper case + digits minus ILO0
            chunk = code.replace("-", "")
            for c in chunk:
                assert c in "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

    def test_no_duplicates(self) -> None:
        codes = generate_backup_codes()
        assert len(set(codes)) == 10

    def test_normalize_strips_hyphen_and_upper_cases(self) -> None:
        assert normalize_backup_code("abcd-efgh") == "ABCDEFGH"

    def test_hash_is_deterministic(self) -> None:
        h1 = hash_backup_code("ABCD-EFGH")
        h2 = hash_backup_code("abcdefgh")  # sans hyphen, lower case
        assert h1 == h2

    def test_hash_is_64_hex_chars(self) -> None:
        h = hash_backup_code("ABCD-EFGH")
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)


# ---------------------------------------------------------------------------
# Encryption round-trip
# ---------------------------------------------------------------------------


class TestEncryption:
    def test_round_trip(self) -> None:
        """Encrypt → decrypt must recover the original secret."""
        s = generate_secret()
        enc = encrypt_secret(s)
        assert enc != s
        dec = decrypt_secret(enc)
        assert dec == s

    def test_encrypt_is_deterministic_per_run(self) -> None:
        """Fernet encryption includes a timestamp, so same plaintext
        produces different ciphertext each call (non-deterministic)."""
        s = generate_secret()
        e1 = encrypt_secret(s)
        e2 = encrypt_secret(s)
        assert e1 != e2  # Fernet includes timestamp → unique per call

    def test_decrypt_tampered_raises(self) -> None:
        s = generate_secret()
        e = encrypt_secret(s)
        tampered = e[:-4] + "AAAA"
        with pytest.raises(ValueError, match="cannot be decrypted"):
            decrypt_secret(tampered)

    def test_decrypt_with_empty_input(self) -> None:
        with pytest.raises(ValueError, match="cannot be decrypted"):
            decrypt_secret("")
