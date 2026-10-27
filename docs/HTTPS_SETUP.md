# HTTPS on the shop network

From this release, every till and phone opens the POS at **`https://SERVER_IP`**, for example `https://192.168.1.100`. Plain `http://SERVER_IP` redirects there. The API no longer answers plain-HTTP requests from other machines, so passwords and sign-in tokens can't be read off the shop network (authentication audit AUTH-01).

The shop server makes its own certificate. Browsers don't know it, so each device has to be told once to trust it. Until then the browser shows "Your connection isn't private".

## How it fits together

```text
Till / phone ──HTTPS :443──► web-tls (Caddy)
                               ├── /api, /files, /socket.io ──► express-api
                               └── everything else           ──► nextjs
Till / phone ──HTTP :80────► web-tls ──► redirect to https://
```

- The certificate is created on the first start of `web-tls` and kept in the `web_tls` Docker volume, at `/certs/cert.pem`. It lasts 10 years and names `SERVER_IP`, `127.0.0.1` and `localhost`.
- The API port (3000) is published on the server PC only (`127.0.0.1`), for scripts and troubleshooting.
- Set `SERVER_IP` in `.env` **before** the first start. If the server's IP changes later, see "New IP address" below.

## 1. Copy the certificate off the server

On the server PC, in the repository folder:

```powershell
docker compose cp web-tls:/certs/cert.pem .\shop-certificate.crt
```

Put `shop-certificate.crt` on a USB stick, or a shared folder the tills can read. It holds no secret: the private key stays on the server.

## 2. Trust it on each Windows till

1. Double-click `shop-certificate.crt`, then **Install Certificate…**
2. Store location: **Local Machine**, then **Next** (needs an administrator).
3. **Place all certificates in the following store**, then **Browse…**, then **Trusted Root Certification Authorities**, then **OK**, then **Next**, then **Finish**.
4. Close every browser window and open `https://SERVER_IP` again. The padlock shows with no warning.

Or in an administrator PowerShell on the till:

```powershell
Import-Certificate -FilePath .\shop-certificate.crt -CertStoreLocation Cert:\LocalMachine\Root
```

Chrome and Edge use the Windows store. Firefox keeps its own: in Firefox open `about:config` and set `security.enterprise_roots.enabled` to `true`.

## 3. Trust it on phones

**Android:** copy the file to the phone, then **Settings**, **Security**, **More security settings**, **Install from device storage** (the wording varies by maker), **CA certificate**, pick the file.

**iPhone / iPad:** AirDrop or email the file to the device and open it. Then **Settings**, **General**, **VPN & Device Management**, install the profile. Then **Settings**, **General**, **About**, **Certificate Trust Settings**, and switch on full trust for it.

## 4. Check

- `https://SERVER_IP` opens with a padlock and no warning on each device.
- Sign in, and the status dot in the header turns green (live updates connected).
- On the server PC: `Invoke-WebRequest -Uri "http://127.0.0.1:3000/api/health" -UseBasicParsing` returns 200.

If a till shows "This connection isn't secure. Open the POS at https://…", it is still using an old `http://SERVER_IP:3000` bookmark or shortcut. Replace it with `https://SERVER_IP`.

## New IP address

The certificate names the IP it was made for. After changing `SERVER_IP`:

```powershell
docker compose stop web-tls
docker compose run --rm --entrypoint sh web-tls -c "rm -f /certs/cert.pem /certs/key.pem"
docker compose up -d web-tls
```

Then repeat steps 1–3 on every device, and remove the old certificate from each one.

## Using the shop's own certificate

If the shop has a certificate from its own or a company authority, copy its `cert.pem` and `key.pem` into the `web_tls` volume (`/certs`) in place of the generated ones and restart `web-tls`. Devices that already trust that authority need no step 2 or 3.

## Turning it off

`REQUIRE_HTTPS=false` in `.env` lets the API answer plain HTTP from other machines again. Use it only on a single PC that is not on a network.
