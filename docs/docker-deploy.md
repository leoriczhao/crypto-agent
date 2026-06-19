# Docker Deployment

This deployment runs the daemon in Docker. The Ink CLI can be run with
`docker compose exec crypto-agent node dist/cli.js` or from the host by pointing
`CRYPTO_AGENT_SOCK` at the mounted runtime socket.

## Files

- `Dockerfile` builds TypeScript and prunes dev dependencies.
- `docker-compose.yml` runs `node dist/daemon.js`.
- `.dockerignore` keeps local databases, secrets, and build output out of the image.

## First Deploy

```bash
cp .env.example .env
$EDITOR .env

printf "\nCRYPTO_AGENT_UID=%s\nCRYPTO_AGENT_GID=%s\n" "$(id -u)" "$(id -g)" >> .env
mkdir -p data runtime

docker compose up -d --build
docker compose ps
docker compose logs --tail=80 crypto-agent
```

## Runtime Paths

- Database: `./data/crypto_agent.db`
- Auto-compact transcripts: `./data/transcripts`
- IPC socket: `./runtime/crypto-agent.sock`
- PID file: `./runtime/crypto-agent.pid`

The compose file overrides these paths so container rebuilds do not reset
SQLite state and the socket path is stable across container users.
