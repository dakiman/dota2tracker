# Deploy FriendTracker (home server)

Use this document as **context in Cursor** while you have an **SSH session** to the server open in another terminal. It assumes the stack is **PostgreSQL + API + nginx (Vue SPA)** via **Docker Compose**, as defined in `docker-compose.yml`.

## Target layout

| Service | Container | Host ports (default) |
|--------|-----------|----------------------|
| Web (nginx, proxies `/api/*` to API) | `web` | **80** |
| API (Hono) | `api` | **3000** (direct); browser should use **80** + `/api/...` |
| PostgreSQL | `db` | **5474** |

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

The API auto-runs Drizzle migrations on startup, so no manual migration step is needed after deploying. If you need to run migrations manually from **your dev machine** (with `pnpm` installed), point at the server’s Postgres (port **5474** must be reachable from your PC—LAN only is typical):

**PowerShell (Windows):**

```powershell
cd C:\path\to\dota2chipetracker
pnpm install
$env:DATABASE_URL = "postgresql://friendtracker:your-long-random-secret@192.168.100.253:5474/friendtracker"
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

## One-command deploy on Linux (Compose + migrations)

From the repo root (after `.env` exists with `DB_PASSWORD`):

```bash
chmod +x scripts/local-deploy.sh
./scripts/local-deploy.sh
```

This runs `docker compose up -d --build`, waits for Postgres, then `drizzle-kit migrate` inside the API container.

## Run next to `dakis-server` (shared Cloudflare tunnel)

One directory up, `dakis-server/docker-compose.yml` **includes** this file, so a single command starts Open WebUI, Worldmonitor, Netdata, **cloudflared**, and this stack:

```bash
cd /path/to/dakis-server
docker compose up -d --build
```

Then run migrations once (from repo root here or after `docker compose exec` into `api`—same as [First-time database](#first-time-database-run-migrations)).

The Postgres volume is pinned to **`dota2tracker_pgdata`**, so data is the same whether you run Compose from **`dakis-server`** or from **`dota2tracker`** alone.

**Port note:** `web` publishes host **80**. If something else on the machine already uses 80, change the `web` ports mapping in `docker-compose.yml` (for example `"8088:80"`) and use that port below for the tunnel origin.

## Cloudflare Tunnel (expose to the internet)

With the stack up, nginx listens on host port **80** (unless you remapped it). Your home server already runs **cloudflared** with `network_mode: host`, so you do **not** need a second tunnel container—only a new route in [Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → your tunnel → **Public Hostname** → **Add**:

- **Subdomain** (example): `dota2tracker` (or any hostname you own on that zone)
- **Service type**: HTTP
- **URL**: `http://127.0.0.1:80` (use `127.0.0.1:8088` if you remapped `web` as above)

One origin is enough: nginx proxies `/api/` to the API container.

**Quick test (ephemeral URL, separate from your named tunnel):**

```bash
cloudflared tunnel --url http://127.0.0.1:80
```

**Hardening (optional):** if you only need access via the tunnel—not the LAN—map the web port to loopback in `docker-compose.yml`, e.g. `"127.0.0.1:80:80"`, so nginx is not reachable from other machines on the network.

## Troubleshooting (quick)

- **`permission denied` while connecting to Docker** (even as root): on some hosts `/var/run/docker.sock` is mis-owned (e.g. `nobody:nogroup`). Fix with `sudo chown root:docker /var/run/docker.sock && sudo chmod 660 /var/run/docker.sock` and ensure your user is in the `docker` group, or use `sudo docker compose ...` if sudo works.
- **`permission denied` while connecting to Docker** (normal case): use `sudo docker compose ...` or add user to `docker` group and re-login.
- **Port 80 already in use**: stop the other service or change the `web` ports mapping in `docker-compose.yml` (e.g. `"8080:80"`).
- **API errors / empty data**: confirm migrations ran; check `docker compose logs api` and `docker compose logs db`.
- **Firewall**: allow TCP **80** (and **5432** only if you need DB access from other machines—prefer restricting 5432 to LAN or VPN).

## Files that matter for deploy

- `docker-compose.yml` – services, env, ports.
- `apps/web/nginx.conf` – SPA + **`/api/`** → `http://api:3000`.
- `apps/api/Dockerfile`, `apps/web/Dockerfile` – production images.
