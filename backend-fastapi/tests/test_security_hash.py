import hashlib
import subprocess
from pathlib import Path

from app.core.security import hash_token


def test_sha256_matches_node():
    token = "abc.def.ghi"
    expected = hashlib.sha256(token.encode("utf-8")).hexdigest()
    assert hash_token(token) == expected
    repo = Path(__file__).resolve().parents[2]
    script = (
        "const c=require('crypto');"
        f"process.stdout.write(c.createHash('sha256').update({token!r}).digest('hex'))"
    )
    node = subprocess.run(
        ["node", "-e", script],
        cwd=repo,
        capture_output=True,
        text=True,
        check=False,
    )
    if node.returncode == 0 and node.stdout:
        assert node.stdout == expected
