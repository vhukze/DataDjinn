import unittest

from app.git_sync.sync_crypto import decrypt_sync_payload, encrypt_sync_payload


class SyncCryptoTests(unittest.TestCase):
    def setUp(self) -> None:
        self.passphrase = "DataDjinn-同步口令-2026"
        self.payload = {
            "connections": [
                {
                    "name": "生产达梦库",
                    "password": "数据库密码-秘密",
                    "ssh_password": "SSH-密码",
                    "ssh_passphrase": "私钥口令",
                }
            ],
            "settings": {
                "theme": "dark",
                "ai_configs": [{"api_key": "sk-sensitive", "model": "gpt-test"}],
            },
        }

    def test_round_trips_sensitive_utf8_payload(self) -> None:
        envelope = encrypt_sync_payload(self.payload, self.passphrase)

        self.assertEqual(decrypt_sync_payload(envelope, self.passphrase), self.payload)
        self.assertNotIn("数据库密码-秘密", str(envelope))
        self.assertNotIn("sk-sensitive", str(envelope))

    def test_same_payload_uses_random_salt_and_nonce(self) -> None:
        first = encrypt_sync_payload(self.payload, self.passphrase)
        second = encrypt_sync_payload(self.payload, self.passphrase)

        self.assertNotEqual(first["salt"], second["salt"])
        self.assertNotEqual(first["nonce"], second["nonce"])
        self.assertNotEqual(first["ciphertext"], second["ciphertext"])

    def test_rejects_wrong_passphrase(self) -> None:
        envelope = encrypt_sync_payload(self.payload, self.passphrase)

        with self.assertRaisesRegex(ValueError, "口令错误.*已损坏"):
            decrypt_sync_payload(envelope, "错误口令-长度足够")

    def test_rejects_tampered_ciphertext(self) -> None:
        envelope = encrypt_sync_payload(self.payload, self.passphrase)
        ciphertext = envelope["ciphertext"]
        envelope["ciphertext"] = ("A" if ciphertext[0] != "A" else "B") + ciphertext[1:]

        with self.assertRaisesRegex(ValueError, "口令错误.*已损坏"):
            decrypt_sync_payload(envelope, self.passphrase)

    def test_rejects_short_passphrase(self) -> None:
        with self.assertRaisesRegex(ValueError, "至少需要 8 个字符"):
            encrypt_sync_payload(self.payload, "short")


if __name__ == "__main__":
    unittest.main()
