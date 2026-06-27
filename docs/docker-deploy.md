# Docker Deployment

This deployment runs the Python daemon in Docker. There is no Node daemon,
systemd service, npm install step, or `dist/cli.js` in the active runtime.

## Files

- `Dockerfile` installs the Python package and starts `crypto-agent-py daemon`.
- `docker-compose.yml` runs the Python daemon, mounts durable data, and exposes
  the IPC socket through `./runtime/crypto-agent.sock`.
- `.dockerignore` excludes secrets, databases, runtime sockets, caches, and
  build artifacts.

## First Deploy

```bash
cp .env.example .env
printf "\nCRYPTO_AGENT_UID=%s\nCRYPTO_AGENT_GID=%s\n" "$(id -u)" "$(id -g)" >> .env
mkdir -p data runtime

docker compose up -d --build
docker compose ps
docker compose logs --tail=80 crypto-agent
```

## Runtime Paths

- Database: `./data/crypto_agent.db`
- IPC socket: `./runtime/crypto-agent.sock`
- Container command:

```bash
crypto-agent-py daemon \
  --database-path /data/crypto_agent.db \
  --socket-path /run/crypto-agent/crypto-agent.sock \
  --environment production \
  --init-db
```

## Health And Smoke

```bash
docker compose exec crypto-agent \
  crypto-agent-py-client \
  --socket-path /run/crypto-agent/crypto-agent.sock \
  health

docker compose exec crypto-agent \
  crypto-agent-py-client \
  --socket-path /run/crypto-agent/crypto-agent.sock \
  smoke \
  --profile-path /app/agents/residents/btc-eth-researcher/AGENT.md
```

Use `--destructive` on the smoke command only when intentionally resetting the
container database.
