# Releasing Bytecra POS

## Version bump

```bash
# Bug fix: 1.0.0 → 1.0.1
npm version patch

# Feature: 1.0.0 → 1.1.0
npm version minor

# Breaking change: 1.0.0 → 2.0.0
npm version major
```

## Publish to GitHub

```bash
git push origin main --tags
```

Pushing a tag matching `v*.*.*` (for example `v1.0.1`) triggers the **Build & Release** workflow, which:

1. Builds the React frontend
2. Packages the Windows NSIS installer
3. Uploads `release/*.exe` and `latest.yml` to GitHub Releases

Pushes to `main` without a tag still produce a **30-day** workflow artifact (no public release).

## Manual release

GitHub → Actions → **Build & Release** → **Run workflow** → enter version.

## Code signing (optional)

Add repository secrets:

| Secret | Description |
|--------|-------------|
| `CSC_LINK` | Base64-encoded `.pfx` certificate |
| `CSC_KEY_PASSWORD` | Certificate password |

Without signing, Windows may show “Unknown publisher”; users can choose **More info → Run anyway** for internal deployments.

## Local build

```bash
npm ci
npm run build
npm run build:electron
```

Installer output: `release/BytecraPOS-Setup-<version>.exe`
