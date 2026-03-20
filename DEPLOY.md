# Deploy FriendTracker (home server)

Use this document as **context in Cursor** while you have an **SSH session** to the server open in another terminal. It assumes the stack is **PostgreSQL + API + nginx (Vue SPA)** via **Docker Compose**, as defined in `docker-compose.yml`.

## Target layout

| Service | Container | Host ports (default) |
|--------|-----------|----------------------|
| Web (nginx, proxies `/api/*` to API) | `web` | **80** |
| API (Hono) | `api` | **3000** (direct); browser should use **80** + `/api/...` |
| PostgreSQL | `db` | **5432** |

On your LAN: open **`http://<SERVER_IP>/`**. Health check: **`http://<SERVER_IP>/api/health`**.

## Server prerequisites

- Docker Engine and **Docker Compose V2** (`docker compose version`).
- `git`.
- Your Linux user can run Docker **without** sudo (in group `docker`), or prefix compose commands with `sudo`.

Example (Debian/Ubuntu) for adding user to `docker`:

```bash
sudo usermod -aG docker "$USER"
# log out and back in
```

## One-time: clone from GitHub

Replace `YOUR_USER`, `YOUR_REPO`, and the path you prefer.

```bash
cd ~
git clone https://github.com/YOUR_USER/YOUR_REPO.git dota2chipetracker
cd ~/dota2chipetracker
```

SSH clone is fine too: `git clone git@github.com:YOUR_USER/YOUR_REPO.git dota2chipetracker`.

## One-time: production database password

Compose uses `DB_PASSWORD` for Postgres and wires it into `DATABASE_URL` for the API. Default in compose is `devpassword` if unset—**set a strong value for a real server**.

In the project directory on the server:

```bash
cd ~/dota2chipetracker
printf '%s\n' 'DB_PASSWORD=your-long-random-secret' > .env
```

Docker Compose automatically loads `.env` from the project directory for variable substitution in `docker-compose.yml`.

## First deploy (build and start)

```bash
cd ~/dota2chipetracker
docker compose up -d --build
docker compose ps
```

## First-time database: run migrations

The API expects Drizzle migrations applied to Postgres. Easiest from **your dev machine** (with `pnpm` installed), pointing at the server’s Postgres (port **5432** must be reachable from your PC—LAN only is typical):

**PowerShell (Windows):**

```powershell
cd C:\path\to\dota2chipetracker
pnpm install
$env:DATABASE_URL = "postgresql://friendtracker:your-long-random-secret@192.168.100.253:5432/friendtracker"
pnpm --filter api db:migrate
```

Use the same password as in the server’s `.env`. Then seed if you use seed data:

```powershell
pnpm seed
```

(Requires any env vars your `scripts/seed.ts` needs—see `.env.example`.)

## Updates (redeploy after `git push`)

On the server:

```bash
cd ~/dota2chipetracker
git pull
docker compose up -d --build
```

## Deploy from Windows without Git on the server (optional)

From the repo root on your PC:

```powershell
pnpm run deploy:home
```

Or:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-home-server.ps1
```

Defaults: user `dakiman`, host `192.168.100.253`, remote dir `~/dota2chipetracker`. Override:

```powershell
.\scripts\deploy-home-server.ps1 -RemoteUser "you" -RemoteHost "192.168.1.50" -RemoteDir "apps/friendtracker"
```

Requires **SSH key auth** to the server (script uses non-interactive SSH).

## Troubleshooting (quick)

- **`permission denied` while connecting to Docker**: use `sudo docker compose ...` or add user to `docker` group and re-login.
- **Port 80 already in use**: stop the other service or change the `web` ports mapping in `docker-compose.yml` (e.g. `"8080:80"`).
- **API errors / empty data**: confirm migrations ran; check `docker compose logs api` and `docker compose logs db`.
- **Firewall**: allow TCP **80** (and **5432** only if you need DB access from other machines—prefer restricting 5432 to LAN or VPN).

## Files that matter for deploy

- `docker-compose.yml` – services, env, ports.
- `apps/web/nginx.conf` – SPA + **`/api/`** → `http://api:3000`.
- `apps/api/Dockerfile`, `apps/web/Dockerfile` – production images.
