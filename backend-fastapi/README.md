# Future ML / AI service — not the POS backend.

Express (`server/`) is the **permanent** Bytecra POS API (auth, inventory, invoices, Socket.io).

This Python service exists only for future machine-learning workloads (demand models, recommendations, inference). It currently exposes **GET /health** only. It must not duplicate POS REST APIs.

Start optionally:

```bash
docker compose --profile ml up -d
```

Do not point tills or the Next.js app at this process.
