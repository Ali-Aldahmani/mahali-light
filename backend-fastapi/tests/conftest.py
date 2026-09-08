import os
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-secret-abcdefghijklmnopqrstuvwxyz-32")

from app.core.config import get_settings
from app.db.session import get_db
from app.main import app

get_settings.cache_clear()


@pytest.fixture
def client():
    def _fake_db():
        yield MagicMock()

    app.dependency_overrides[get_db] = _fake_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
