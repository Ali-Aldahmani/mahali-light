#!/bin/sh
set -e
IP="${SERVER_IP:-127.0.0.1}"
if [ ! -f /certs/cert.pem ] || [ ! -f /certs/key.pem ]; then
	apk add --no-cache openssl >/dev/null
	cat >/tmp/openssl.cnf <<EOF
[req]
distinguished_name = dn
req_extensions     = san
prompt             = no

[dn]
CN = mahali-pos-web
O  = Mahali
C  = AE

[san]
keyUsage           = digitalSignature, keyEncipherment
extendedKeyUsage   = serverAuth
subjectAltName     = IP:${IP}, IP:127.0.0.1, DNS:localhost
EOF
	openssl req -x509 -newkey rsa:2048 \
		-keyout /certs/key.pem -out /certs/cert.pem \
		-days 3650 -nodes -config /tmp/openssl.cnf -extensions san
	rm -f /tmp/openssl.cnf
fi
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
