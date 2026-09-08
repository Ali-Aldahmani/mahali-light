from app.shared.permissions import SLICE_01_PERMISSIONS


def test_only_slice_keys_are_wired():
    assert set(SLICE_01_PERMISSIONS) == {
        "analytics.view_reorder",
        "analytics.view_dashboard",
        "analytics.view_peaks",
        "analytics.view_seasonality",
    }
