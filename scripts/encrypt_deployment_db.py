"""Create a separately encrypted SQLCipher copy of the local Luna database."""

from __future__ import annotations

import os
import secrets
import sqlite3
import sys
from pathlib import Path

try:
    from sqlcipher3 import dbapi2 as sqlcipher
except ImportError:
    raise SystemExit(
        "sqlcipher3 não está instalado. Ative o ambiente virtual e instale requirements.txt."
    )


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.getenv("LUNA_DATA_DIR", ROOT / "luna_data")) / "luna_memory.db"
DEPLOY_DIR = ROOT / "luna_data" / "deploy"
DESTINATION = DEPLOY_DIR / "luna_memory.db"
KEY_FILE = DEPLOY_DIR / "luna_db_key.txt"


def main() -> int:
    if not SOURCE.is_file():
        print(f"Banco local não encontrado: {SOURCE}", file=sys.stderr)
        return 1
    if DESTINATION.exists() or KEY_FILE.exists():
        print(
            f"Já existe um arquivo de deploy em {DEPLOY_DIR}. Nada foi sobrescrito.",
            file=sys.stderr,
        )
        return 1

    DEPLOY_DIR.mkdir(parents=True, exist_ok=True)
    key = secrets.token_hex(32)
    source_uri = SOURCE.resolve().as_uri() + "?mode=ro"
    conn = None
    try:
        # Without a key SQLCipher reads the source as ordinary SQLite. The
        # destination attachment receives the new random passphrase.
        conn = sqlcipher.connect(source_uri, uri=True)
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
        conn.execute(
            "ATTACH DATABASE ? AS encrypted KEY ?",
            (str(DESTINATION), key),
        )
        conn.execute("SELECT sqlcipher_export('encrypted')").fetchone()
        conn.execute("DETACH DATABASE encrypted")
        conn.close()
        conn = None

        # Validate that the ciphertext reopens and passes SQLCipher integrity.
        check = sqlcipher.connect(str(DESTINATION))
        check.execute(f"PRAGMA key = '{key}'")
        check_result = check.execute("PRAGMA integrity_check").fetchall()
        if check_result != [("ok",)]:
            raise RuntimeError("A verificação de integridade do SQLCipher falhou.")
        check.close()

        KEY_FILE.write_text(key + "\n", encoding="ascii")
        try:
            os.chmod(KEY_FILE, 0o600)
        except OSError:
            pass  # Windows uses its account ACL rather than POSIX mode bits.
    except Exception:
        if conn is not None:
            conn.close()
        DESTINATION.unlink(missing_ok=True)
        KEY_FILE.unlink(missing_ok=True)
        raise

    print("Cópia criptografada criada:")
    print(f"  Banco: {DESTINATION}")
    print(f"  Chave: {KEY_FILE}")
    print("A chave não foi exibida. Copie-a para LUNA_DB_ENCRYPTION_KEY no .env do servidor.")
    print("Não envie a chave ao GitHub nem a mantenha junto do banco no servidor.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
