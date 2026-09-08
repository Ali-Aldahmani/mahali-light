def test_health_shape(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert "database" in body["data"]
    assert body["data"]["service"] == "mahali-ml-future"
    assert body["data"]["role"] == "future_ml_only"
    assert "jwt" not in str(body).lower()
    assert "secret" not in str(body).lower()


def test_no_pos_v2_duplicate(client):
    res = client.get("/api/v2/forecast/reorder")
    assert res.status_code == 404
