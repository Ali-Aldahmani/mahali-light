"""Permission keys required by slice 01. Full 104-key catalog stays in Express."""

SLICE_01_PERMISSIONS = {
    "analytics.view_reorder": "GET forecast reorder + annual plan",
    "analytics.view_dashboard": "GET analytics kpis + sparkline",
    "analytics.view_peaks": "GET analytics peak-hours",
    "analytics.view_seasonality": "GET analytics product-seasonality",
}

# Effective permission algorithm is identical to Express loadUserContext:
# role_permissions UNION grants MINUS denies (user_permissions.granted=false).
