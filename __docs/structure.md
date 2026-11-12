# nedwork — MASTER STRUCTURE & OPERATIONS (public edition)
version 2.4-public · derived from the private v2.4 (2026-11-12)
A single-VM self-hosted stack: reverse proxy, ~13 Docker stacks, push-backup to a laptop, and a hand-rolled WebSocket relay.

> **This is a sanitized copy.** Every identifier that maps the real network has been replaced with a placeholder. The operational copy — with real addresses, accounts and paths — stays private and is never committed.

| placeholder | replaces |
|---|---|
| `<PUBLIC_IP>` | the WAN address |
| `<LAN_SUBNET>` | the home LAN |
| `<SERVER_LAN_IP>` / `<LAPTOP_LAN_IP>` | the two hosts |
| `<ADMIN_USER>` / `<BACKUP_USER>` / `<STATUS_USER>` | local accounts |
| `<ADMIN_EMAIL>` | the operator's address |

---

## 0. How to work on this system (the round convention)

Every interaction is exactly ONE type — never mixed ambiguously:

| type | meaning |
|---|---|
| **Question** | plain text, asks for a decision that lives in the owner's head (preferences, plans, yes/no) |
| **[ASK]** | read-only commands → run them, paste the output back. Nothing changes. |
| **[EXEC]** | commands that change something. Only sent when the change is fully specified and safe. |

Rules:
- NEVER ask-then-execute in one round (an answer might veto the execute).
- [EXEC] MAY append verification [ASK]s at the end. This is the only legal mix.
- Never ask a question a command can answer (sizes, versions, statuses, logs → [ASK], always).
- Every command block gets a header comment; [ASK] blocks state expectations ("want 401") so output is self-checked.
- Risky executes carry guards (abort unless reality matches expectations). Executes are idempotent where possible. Secrets via `read -rsp`, never typed into chat.
- Every change is only "done" once its verification output has been pasted and matches expectations.
- **A started container is not a ready service.** `docker compose up -d` returns before the app binds — probe in a retry loop, never a single curl.
- Ask blocks must not reveal sensitive data — most important for SQL; if sensitive output is required, ask explicitly.
- **Doc currency rule:** whenever anything MAJOR changes — a stack added/removed · an IP or DNS change · a backup-flow or script change · a hardware change · an incident with a fix — an updated master doc (version bump + timeline row) is produced in the SAME session and shipped. Minor drift (sizes, uptimes, container versions) does NOT trigger a rewrite; it waits for the next audit. The status page + logs are always the live truth.
- **Copies:** the repo copy is the edit source but is **gitignored on purpose** — it is NOT version-controlled and is no safer than the other two. The canonical live copies are on the server and on the backup host. "Shipped" = md5s match on all three.

---

## 1. Big picture

```
                 Internet  (DNS A-records per subdomain → <PUBLIC_IP>, ports 80+443 only)
                    │
             Home router  LAN <LAN_SUBNET>
                    │
     ┌──────────────┴───────────────────────────┐
     ▼                                          ▼
  SERVER (physical, Proxmox host)          LAPTOP "backupbox"
     └─ VM "nedwork" <SERVER_LAN_IP>          <LAPTOP_LAN_IP> (WiFi)
        Ubuntu + Docker                      backup target only
        ← ALL services live here             SSD: OS · HDD: /srv/backups
```

Rules that fall out of this:
1. **One entry point:** nginx-proxy is the only thing the internet talks to. Apps are `expose:`-only, never `ports:` (exception: qbittorrent 6881 tcp/udp for peers).
2. **One app = one subdomain = one folder** under `~/docker/`.
3. **Push backup:** the SERVER connects to the LAPTOP nightly. The laptop is dumb on purpose (ssh + rsync + one rotation script) so changing backup targets = changing one IP in one script.
4. Only docker data is backed up — not the VM, not Proxmox. Movies/shows excluded by decision.
5. **One process per container.** A container needing a second long-running process gets a second service, never a backgrounded child.

---

## 2. Machines

### server — "nedwork" (VM on Proxmox host)
- IP `<SERVER_LAN_IP>` (router-reserved) · user `<ADMIN_USER>` (sudo) · from Windows: `ssh nedwork`
- Ubuntu 26.04.1 LTS · kernel RUNNING 7.0.0-31 — **reboot pending: 7.0.0-34 + 7.0.0-38 installed** · Docker 29.7.2 · Compose v5.5.0
- uptime ≈ 49 d (boot ≈ 2026-09-24; computed 2026-11-12 — the 4th reboot is still pending)
- disk `/` 343 GB: 144 GB used (44 %, measured 2026-10-26 — not re-measured after the 2026-11-12 rebuilds)
- **9 docker networks** (custom: nginx-proxy, nginx-proxy-stack_default, paperless_default, rallly_default, fluxer_fluxer, librechat_librechat-internal + bridge/host/none)
- **50 running / 52 total** (2026-10-26). The 2 exited are one-shot inits, Exited 0: `rallly-s3-init`, `fluxer-seaweedfs-init` (normal)
- **14 dirs under `~/docker/`** (13 stacks + `app/` scratch)
- reboots are SAFE and proven (3×): every container has `restart: unless-stopped`. A 4th reboot is pending.

### laptop — "backupbox"
- IP `<LAPTOP_LAN_IP>` (WiFi `wlp2s0`, DHCP-reserved — if it ever drifts: suspect WiFi MAC randomization)
- user `<BACKUP_USER>` (sudo) · Ubuntu 26.04.1 · kernel 7.0.0-30
- backup disk: `/dev/sdb1` ext4, label `backups`, fstab `nofail` → `/srv/backups`, 916 GB, **72 GB used (8 %)** (2026-10-26) — all snapshot slots exist
- power: lid-close ignored (`logind.conf.d/99-no-suspend.conf`), suspend/hibernate masked → can sit closed, MUST be powered on at 02:30 UTC
- what the server may do there: ssh key login + passwordless sudo for EXACTLY `/usr/bin/rsync` and `/usr/local/bin/rotate-backup.sh`
- ⚠ consequence: any *other* `sudo` on the laptop needs a password and therefore a TTY — `ssh -t`, not plain `ssh`
- `systemctl is-system-running` = `degraded`: the only failed unit is the already-masked `systemd-networkd-wait-online.service`. Cosmetic.

---

## 3. Stack inventory (sizes 2026-10-26)

| folder | URL | size | database | backed up |
|---|---|---|---|---|
| immich | photos.* | 47 G | postgres (PINNED `14-vectorchord0.4.3-pgvectors0.2.0`) → pg_dumpall | YES |
| nextcloud | cloud.* | 18 G | mariadb 10.6 → full dump (maintenance mode ON for the seconds it takes) | YES |
| librechat | chat.* | 492 M | **mongo 7** (data in folder) | **NO — not in STACKS** |
| openwebui | ai.* | 907 M | sqlite inside data/ | YES |
| paperless | paperless.* | 114 M | postgres 17 → pg_dumpall | YES |
| rallly | polls.* | 68 M | postgres 18 + garage (S3, attachments) → pg_dumpall + folder rsync | YES |
| nedwork (Flask site) | (apex) | 53 M | sqlite — LIVE `nedwork/data/app.db` (WAL) → `sqlite3 .backup` since 2026-11-12 · 2 containers: app (waitress) + relay (stateless) | YES + DB dump |
| arr-stack (qbt/sonarr/radarr/prowlarr) | qbt/sonarr/radarr/prowlarr.* | 50 M | their own sqlite/xml in config/ | NO (by decision) |
| vaultwarden | password.* | 3.9 M | sqlite `data/db.sqlite3` → `sqlite3 .backup` | YES |
| nginx-proxy-stack | (the proxy) | 1.5 M | — (certs, vhost.d, acme, html) | YES |
| jellyfin | movies.* | 708 K | sqlite in config/ | NO (by decision) |
| stirling-pdf | pdf.* | 316 K | none (401 to anonymous curl = its own login page — normal) | YES |
| fluxer | dc.* | 76 K* | **postgres 16 in a NAMED VOLUME** — the "fluxer sqlite" step is still dead | folder only |
| app/ | — | 4 K | — (empty scratch) | — |

*fluxer = **25 containers** (24 up + `seaweedfs-init` one-shot, Exited 0). The stack DIR is only 76 K because the real data lives in **7 named docker volumes**: `fluxer_postgres-data` (DB) · `fluxer_seaweedfs-data` (**uploaded files / S3 buckets — irreplaceable**) · `fluxer_meilisearch-data` (rebuildable) · `fluxer_valkey-data` + `fluxer_nats-data` (cache/queue, ephemeral) · `fluxer_edge-data` + `fluxer_edge-config` (Caddy state/config). `Caddyfile` is a bind mount. 16 volumes total on the host (9 active, ~884 MB). Volumes = NOT backed up.

Excluded from backup by decision: `jellyfin` + `arr-stack` (re-downloadable media pipeline).

---

## 4. Folder tree (server)

```
~/docker/
├── nginx-proxy-stack/          ← THE proxy + SSL — the only stack that owns the network
│   ├── docker-compose.yml      (nginx-proxy + acme-companion)
│   ├── certs/                  folder-per-domain: 16 domains
│   ├── acme/                   acme.sh account + renewal state (don't touch)
│   ├── html/                   ACME webroot + html/serverstatus/ ← rendered status page
│   ├── vhost.d/                per-domain overrides + serverstatus.htpasswd
│   └── nginx-upload-limit.conf (mounted as zzz_*.conf) — client_max_body_size 20g;
├── immich/            data/ (upload ~34 G, encoded-video, thumbs, backups) · postgres/ (DB)
│                      model-cache/ · docker-compose.yml
├── nextcloud/         html/ (~13 G) · db/ (mariadb) · redis/ · docker-compose.yml
├── librechat/         compose + mongo data (492 M)
├── rallly/            compose + postgres/garage data (68 M)
├── paperless/         docker-compose.yml (paperless + paperless-db + paperless-broker) + data
├── openwebui/         data/ (~907 M, incl. webui.db sqlite) · docker-compose.yml   [NO ollama]
├── nedwork/           app/ (Flask source, git repo)
│                      ├── __docs/          structure.md (private, gitignored) + architecture.md (this file)
│                      ├── flask_app/ws/    server.py · db.py · notify_channel.py
│                      │                    · tierforge_room.py · __init__.py
│                      ├── flask_app/apps/tierforge/websocket.py  ← thin wrapper → run_server
│                      ├── flask_app/static/js/components/notificationHub.js
│                      └── Dockerfile       CMD = waitress-serve ONLY (relay removed 2026-11-12)
│                      data/ → /app/instance — THE live DB: data/app.db (+ -wal/-shm)
│                             + app.db.bak-premigrate-* · app.db.bak-tasks-recreate — KEEP
├── vaultwarden/       .env (ADMIN_TOKEN, chmod 600) · data/ (db.sqlite3) · docker-compose.yml
├── stirling-pdf/      docker-compose.yml
├── fluxer/            docker-compose.yml (25 services) · Caddyfile (bind) — REAL data in named volumes
├── jellyfin/          config/ · cache/ · media/  ← SHARED MEDIA TREE (see §7)
├── arr-stack/         config/{qbittorrent,sonarr,radarr,prowlarr}/
└── app/               4 K scratch (empty)
```

On the laptop:
```
/srv/backups/
├── daily.0/  daily.1/  weekly.0/  weekly.1/  monthly.0/  monthly.1/     ← 6 slots (2+2+2)
│     └── each is a COMPLETE browsable snapshot:
│         docker/<stack>/…            10 stacks (incl. rallly, NOT librechat)
│         staging/db-dumps/           immich-pg_dumpall.sql · nextcloud-mariadb-all.sql ·
│                                     paperless-pg_dumpall.sql · rallly-pg_dumpall.sql ·
│                                     vaultwarden-db.sqlite3 · nedwork-app.sqlite3
│         staging/meta/               docker ps/inspect/images/networks/volumes (blueprint)
├── BACKUP-SYSTEM.md · BACKUP-SYSTEM.html (historical) · RESTORE.txt · lost+found
└── structure.md            ← shipped copy (md5-matched with server + repo)
```
NOTE: `staging/db-dumps/` + `staging/meta/` are root-owned → browsing them from the laptop needs `sudo` **and a TTY** (`ssh -t`). Normal.

---

## 5. Naming conventions (follow exactly)

| thing | convention | examples |
|---|---|---|
| subdomain | `<app>.<domain>`, lowercase | cloud, photos, ai, chat, polls, pdf, password, dc |
| folder | `~/docker/<app-or-stack>/` | nextcloud/, arr-stack/ |
| compose file | always `docker-compose.yml` in that folder | — |
| container_name | stack-prefixed, multi-service stacks | nextcloud, nextcloud-db, immich-ml |
| data | bind mounts `./<name>:/container/path` next to the compose file | ./db:/var/lib/mysql |
| service worker | separate service in the same stack, never `&`-backgrounded in a CMD | websocket (relay) |
| TZ | `Europe/Zurich` everywhere | — |

**Unit of deployment = one folder per stack.** Update/backup/remove = touch only that folder. The backup's `STACKS=` list uses exactly these folder names. (fluxer is the known exception — named volumes.)

---

## 6. Reverse proxy — how any subdomain goes live

- nginx-proxy (network `nginx-proxy`, 172.19.0.0/16) + acme-companion live in `nginx-proxy-stack`. Start this stack FIRST after any clean boot — it owns the network. 23 containers are members, incl. `fluxer-edge-1` and `nedwork-websocket`.
- A web app joins the network as `external: true` and sets `VIRTUAL_HOST` + `ACME_HOST`. DNS A record must exist first.
- `VIRTUAL_PORT=<http port>` ONLY when a container exposes more than one port (nginx-proxy can't guess → 502). qbittorrent is the known case.
- **Per-domain overrides:** `vhost.d/<full-domain>`. **4 files:** `ai.*`, `chat.*`, `movies.*`, the apex domain + `serverstatus.htpasswd`. Changes: `docker exec nginx-proxy nginx -t && docker exec nginx-proxy nginx -s reload`.
- **The apex vhost carries three blocks:** the `/serverstatus/` location + basic auth, and **two** exact WebSocket locations.
- Global upload cap: `nginx-upload-limit.conf`, `client_max_body_size 20g;`.
- Certs: `certs/<domain>/`, **16 domains** (nearest expiry Dec 7 2026: dc, paperless, password, pdf). Oddity: one orphan cert with no vhost.d entry and no container — don't delete anything in certs/.
- DNS = one A record per subdomain → `<PUBLIC_IP>`. RISK: ISP IP change breaks every record. Consider DDNS someday.

### The two WebSocket locations

Both point at the same upstream, each with its own exact path — **never a `/ws/` prefix** (a prefix would swallow future Flask routes):

```nginx
# TierForge rooms — unauthenticated capability-token rooms
location = /apps/tierforge/ws {
    resolver 127.0.0.11 valid=10s ipv6=off;
    set $ws_upstream nedwork-websocket:5001;
    proxy_pass http://$ws_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

# Notifications — authenticated (cookie + Origin), same upstream
location = /ws/notifications {  ...identical except the path...  }
```

- The runtime `resolver` keeps `nginx -t` independent of the relay's lifecycle — a stopped relay can't break proxy reloads.
- Port 5001 is **never published** and has **no `VIRTUAL_HOST`** — the relay is an upstream, not a site.
- Verified through the public proxy: `101 Switching Protocols` + correct `Sec-WebSocket-Accept` (TierForge) and `401` for an anonymous upgrade (notifications).

---

## 7. The shared media tree (hardlink economy — do not touch)

jellyfin, qbittorrent, sonarr, radarr all mount **the same host path identically**:
`~/docker/jellyfin/media` → `/media` inside each container.

Identical layout everywhere lets Sonarr/Radarr HARDLINK finished downloads into the library (instant, zero extra disk). Different paths per container → fallback to COPY → doubles disk. NEVER change these mounts.

- sub-tree: `media/movies/` · `media/series/` · `media/torrents/{movies,tv}`
- ownership: uid/gid **1000:1000** (drwxrwxr-x)
- arr-stack compose: `PUID=1000` / `PGID=1000` / `TZ=Europe/Zurich` on all 4 services
- jellyfin (official image) sets only `TZ` — media still owned 1000:1000.

---

## 8. Data & volumes philosophy

| rule | why |
|---|---|
| bind mounts `./`, never named volumes | data visible on host, stack self-contained, backup = rsync of one folder |
| ⚠ fluxer CONFIRMED to break this rule | DB + uploaded files in named volumes → invisible to the backup |
| data lives next to its compose file | backup/restore/move = copy one folder |
| never `docker compose down -v` | muscle-memory killer around named volumes (fluxer) |
| DB passwords are baked in at first init | postgres/mariadb only create users on EMPTY data dirs. Changing a password without wiping = classic `SQLSTATE[HY000] [1045]`. This is WHY we dump databases instead of trusting file copies |
| a second container may read a live SQLite DB | bind the **directory** rw (WAL needs `-shm`), `PRAGMA query_only=ON`, short transactions |
| movies not backed up | re-downloadable by design |

---

## 9. Backup system (the heart)

### nightly flow — 02:30 UTC
`/usr/local/sbin/docker-backup.sh` (v3.3 since 2026-09-29, + nedwork dump since 2026-11-12) via systemd `docker-backup.timer` (Persistent=true — a server that was off replays at next boot):

1. `flock` — parallel runs impossible
2. DB dumps → **`/var/backups/docker-backup/db-dumps/`**
   *(there is NO `staging/` component in the server path. `staging/` exists only inside laptop snapshots.)*
   - immich: `pg_dumpall` from inside immich-db
   - paperless: `pg_dumpall` from paperless-db (waits for postgres readiness first)
   - rallly: `pg_dumpall` from rallly-db
   - vaultwarden: `sqlite3 .backup` of `data/db.sqlite3`
   - **nedwork: `sqlite3 .backup` of the LIVE `nedwork/data/app.db`**
   - fluxer: **still a DEAD step** — `sqlite3 .backup` of `data/fluxer.db`, which does not exist. Real DB = postgres in a named volume
   - librechat: **not dumped and not synced** — not in `STACKS` at all
3. nextcloud: maintenance mode ON → `mariadb-dump --all-databases --single-transaction` → OFF
4. laptop: `rotate-backup.sh prepare` → creates `/srv/backups/tmp.new`
5. rsync all **10 stacks** (immich nextcloud nedwork openwebui nginx-proxy-stack paperless stirling-pdf fluxer vaultwarden rallly) → `tmp.new/docker/<stack>/` with `--link-dest=/srv/backups/daily.0/docker/<stack>` → unchanged files become hardlinks (delta runs 25–65 s; first full run 22 min)
6. rsync `db-dumps/` + `meta/` → `tmp.new/staging/`
7. `ready` completeness check (a stack that fails to arrive aborts the run)
8. `commit daily` (daily.0→daily.1, tmp.new→daily.0) — atomic; old snapshots never touched on failure
9. Sunday → `commit weekly` · 1st of month → `commit monthly`
10. `record_run`: append row (UTC ts · status · duration) to the history TSV + call the renderer.

Failure anywhere → cleanup trap: maintenance OFF, tmp.new aborted, **error mail sent**, existing snapshots untouched.

### 9a. The nedwork sqlite dump

The live DB is WAL-mode and written continually, so a file copy is not a backup. The block mirrors the vaultwarden one:

```bash
if [ -f ~/docker/nedwork/data/app.db ]; then
  log "dumping nedwork sqlite"
  sqlite3 ~/docker/nedwork/data/app.db \
    ".backup $STAGING/db-dumps/nedwork-app.sqlite3"
else
  log "nedwork: no sqlite db yet, skipping"
fi
```

`.backup` uses SQLite's online backup API — consistent while the app keeps running, WAL included. Verified: `integrity_check` = ok · 14 rows · row sha identical between dump and live.
Optional hardening not applied: `.timeout 60000` before `.backup` (waits for the app's write lock instead of failing on busy).

### retention
2 daily / 2 weekly (Sundays) / 2 monthly (1sts) via `/usr/local/bin/rotate-backup.sh` on the laptop = **6 slots**. Every snapshot is a FULL copy; rotation + `cp -al` hardlinks keep 6 snapshots at ~67 GB real, not 6×.

### trust chain
server root key → backupbox `~<BACKUP_USER>/.ssh/authorized_keys` (exactly 1 key). Passwordless sudo there is limited to rsync + rotate-backup.sh by design — hence `ssh -t` for anything else.

### verification status
- **restore drill 2026-08-31 PASSED**: immich into a throwaway postgres (66 tables, 4 844 assets) · nextcloud into a throwaway mariadb (163 tables, 4 649 filecache rows) · random file md5s MATCH · ~60 GB pulled back over LAN in ~26 min.
- **2026-11-12 manual run** (after the dump block was added): start 19:16:08 → end 19:16:37, **SUCCESS**, all 10 stacks + dumps synced, snapshot committed. Dump verified as in §9a. **NB:** the run rotates daily.0→daily.1 — a manual run is not free.

---

## 10. Status page — `https://<domain>/serverstatus/`

- **basic auth: user `<STATUS_USER>`** + password in `nginx-proxy-stack/vhost.d/serverstatus.htpasswd` (change = the 3-line openssl block; the htpasswd file is inside the backup).
- rendered by `/usr/local/sbin/backup-status.sh` (v3.2) every 30 min (`backup-status-render.timer`, runs as root) + at the end of every backup run.
- shows: overall pill · last run (local + UTC + age + duration) · next scheduled run · server vitals (disk/ram/load/uptime/containers/health) · backup host live state + disk + per-snapshot ages · run history · app commits (read from the LOCAL git repo = what is actually deployed) · collapsible users card (live count from the app DB).
- times: local timezone primary, grey UTC second.
- pill logic: **bad** if last run failed · **warn** if backup host unreachable / any disk ≥ 80 % / no run for > 26 h · else **ok**.

---

## 11. Error mail

- msmtp → smtp.gmail.com:587 TLS · from/to `<ADMIN_EMAIL>`
- Gmail APP password (not the login password!) in `/etc/msmtp-password` (root, 600) — never in chat or history. A wrong/normal password gives `535 BadCredentials`.
- sent ONLY when a backup run fails. Path tested OK 2026-08-31.
- test anytime: `printf 'To: <ADMIN_EMAIL>\nSubject: test\n\nhi\n' | sudo msmtp -t`

---

## 12. Routine operations

### quick health check (server, 30 s)
```bash
sudo tail -5 /var/log/docker-backup.log
systemctl list-timers --no-pager | grep -E 'docker-backup|backup-status'
docker ps --filter health=unhealthy
cat /var/run/reboot-required* 2>/dev/null || echo "no reboot required"
```
### quick health check (laptop)
```bash
ls /srv/backups ; df -h /srv/backups | tail -1
```
### manual backup run
```bash
sudo /usr/local/sbin/docker-backup.sh   # expect SUCCESS + snapshot list (no "usage:" line)
```
### reboots
`sudo reboot` on either machine — safe, proven. Server off at 02:30 → run replays at boot (Persistent). Laptop off at 02:30 → that run fails (mail arrives), next night proceeds. After OS updates on the server: reboot (kernel changes otherwise lie dormant).
### update a stack
```bash
cd ~/docker/<stack> && docker compose pull && docker compose up -d && docker compose logs --tail 20
```
Read release notes first. Immich: never skip versions backwards, update mobile apps first. **Never skip the backup-integration step.**
### deploy an app-image change (no registry involved — the server builds)
```bash
cd ~/docker/nedwork
git -C app pull --rebase
docker compose build                 # builds BOTH services, both from ./app
docker compose up -d                 # recreates the whole stack (~10 s downtime)
docker compose ps -a                 # -a: a crashed container drops out of plain ps
```
Then probe in a retry loop — `up -d` returns before the app binds.
### optional cleanup
`docker builder prune` · `docker image prune`.

---

## 13. Canonical recipe — add a NEW service (complete, incl. backup)

```bash
# 1. DNS: A record <name>.<domain> → <PUBLIC_IP>

# 2. folder + compose (multi-service stacks name containers stack-prefixed)
mkdir -p ~/docker/<name> && cd ~/docker/<name>
# write docker-compose.yml (+ .env with secrets, chmod 600 .env)

# 3. start + check
docker compose up -d && docker compose ps

# 4. cert is automatic; force retry if needed
docker restart nginx-proxy-acme && docker logs -f nginx-proxy-acme --tail 20

# 5. optional per-domain nginx tweaks
#    ~/docker/nginx-proxy-stack/vhost.d/<name>.<domain> → nginx -t → reload

# 6. BACKUP INTEGRATION (the step librechat skipped):
#    - add <name> to STACKS=(…) in /usr/local/sbin/docker-backup.sh
#    - has a DB? copy the matching dump block: postgres pg_dumpall,
#      sqlite .backup, mariadb, mongodump
#    - on the laptop the `ready` check picks the new stack up automatically

# 7. prove it: sudo /usr/local/sbin/docker-backup.sh
#    then: curl https://<name>.<domain>/  + status page
#          + ls /srv/backups/daily.0/docker/ | grep <name>
```

**If the service also needs a long-running worker (WebSocket, queue consumer, scheduler):**
make it a **second service in the same compose file**, same image, explicit `command:` (not `entrypoint:`), `expose:` only, no `VIRTUAL_HOST`, `restart: unless-stopped`. Never `&`-background it in the app's CMD.

---

## 14. Restore

- **A server gone:** fresh Ubuntu VM → install docker → recreate the admin user → pull `daily.0/docker/` from the laptop → `chown` → compose up per stack (DB data dirs come back inside the snapshot).
- **B one stack broken:** compose down → rsync `daily.1/docker/<stack>/` back → compose up.
- **C DB corrupted:** wipe ONLY the db data dir → start DB container → **wait for real readiness** (mysqladmin lies during first boot) → replay dump → start app. "role already exists" errors during pg replay are harmless.
- **D app sqlite:** `daily.0/staging/db-dumps/nedwork-app.sqlite3` → stop the app → drop it back to `nedwork/data/app.db` (remove stale `-wal`/`-shm`) → start.
- drill-proven 2026-08-31 (immich + nextcloud, counts + md5 verified).
- laptop-side: `staging/` is root-owned — `ssh -t` + `sudo`.

---

## 15. Environment variable conventions per stack type

| stack type | always set | notes |
|---|---|---|
| any web app | `VIRTUAL_HOST`, `ACME_HOST`, `TZ=Europe/Zurich` | routing + certs |
| multi-port container | `VIRTUAL_PORT=<http port>` | nginx-proxy guesses wrong otherwise |
| DB containers | passwords + healthcheck | password identical in app + db; frozen at init |
| LinuxServer.io images (*arr, qbt) | `PUID=1000`/`PGID=1000` + `TZ` | matches the host user |
| behind-proxy apps | trust-proxy headers (`PROXY_FIX_X_FOR=1`, `IMMICH_TRUSTED_PROXIES`, `FLUXER_TRUST_CLIENT_IP_HEADER`) | so logs show real client IPs |
| relay / worker service | `TZ`, port var only | **no** `VIRTUAL_HOST`, **no** `ports:` |
| PHP/Nextcloud | upload/memory limits | ⚠ Apache wants PLAIN BYTES not `G` (`AH00526`) |

---

## 16. Known quirks & landmines (battle-tested unless marked)

| landmine | symptom | fix / rule |
|---|---|---|
| container name = another network's alias | a service can't reach `db` | name DB services uniquely (`paperless_db`) |
| mysqladmin ping during mariadb first boot | "ready" but import denied | wait until a real `SELECT 1` works |
| pg_dumpall replay | `ERROR: role "postgres" already exists` | harmless |
| plain-text ADMIN_TOKEN notice (vaultwarden) | log noise | cosmetic |
| proxy 502 | target container down/starting | check `docker ps`, give health checks time |
| **502 right after `compose up -d`** | site briefly down, then fine | nginx-proxy holds the old container IP until docker-gen regenerates. Transient — retry |
| **`TLS error: tlsv1 unrecognized name`** | curl fails during a recreate | nginx-proxy has no `server_name` block for that instant. Transient |
| **a started container is not a ready service** | `8000 closed`, empty logs, 502 | `up -d` returns before the app binds. Probe in a retry loop |
| **`sh -c "python … & exec waitress-serve"` in a CMD** | a second, unsupervised process in the app container; extra port open on `nginx-proxy` | one process per container |
| **`sudo` on the backup host for anything but rsync** | `sudo: A terminal is required to authenticate` | passwordless sudo is limited by design; use `ssh -t` |
| **`set -e` + `x=$(curl …)`** | block aborts on the first failed probe, later checks never run | `x=$(curl … \|\| echo ERR)` inside loops |
| **`LINES` / `COLUMNS` as script variables** | a correct value silently becomes the terminal height | bash owns those names — use `NLINES` |
| ghcr / docker.io pull failures | `denied` / token timeout | transient — retry |
| Gmail rejects real password | 535 BadCredentials | ONLY an app password works |
| laptop just rebooted, pam_nologin | connection closed | wait ~60 s |
| networkd-wait-online timeout | boot "degraded" | masked on the backup host → permanent cosmetic `degraded` |
| `docker compose logs X` → "no such service" | wrong identifier | use the SERVICE name, not container_name |
| occ asks "Password cannot be empty!" | non-interactive exec | `docker exec -it` |
| DNS propagation lag | acme "no valid A records" though dig works | wait 5–10 min, `docker restart nginx-proxy-acme` |
| router DNS cache on Windows PC | ERR_NAME_NOT_RESOLVED only on PC | `ipconfig /flushdns` (unverified) |
| router forwards only 80/443 | torrents don't seed well | accepted |
| Immich postgres image is PINNED | wrong tag = DB won't start | only change tags per immich's DB upgrade notes |
| v3 renderer contract is `render`-only | history TSV froze, false "no backup" warn | the backup script owns its bookkeeping. `\|\| true` hides dead bookkeeping |
| running the Flask app on the HOST | empty `app/instance/app.db` appears; "the DB can't be empty" | the live DB is the MOUNTED path (`docker inspect … .Mounts`) |
| deploying a stack without backup integration | runs fine for weeks, silently absent from every snapshot | check `STACKS=` + dump block + `ls /srv/backups/daily.0/docker/` |
| **assuming the dump path has `staging/`** | `ls` fails, "backup missing" panic | server path is `/var/backups/docker-backup/db-dumps/`. `staging/` is laptop-only |
| **a backup that exits 0** | says nothing about the data | read the file: `integrity_check` + row count + sha |

---

## 17. Known issues / open items (state 2026-11-12)

1. **fluxer data sits in named volumes — CONFIRMED unbacked.** 25 containers, 7 named volumes (`fluxer_postgres-data` = DB · `fluxer_seaweedfs-data` = uploaded files, the irreplaceable part · meilisearch = rebuildable · valkey/nats = ephemeral · edge-data/edge-config = Caddy state). The backup's fluxer step logs "no sqlite db yet, skipping" — still dead. **Highest-value open item.** Fix options: (a) `pg_dumpall` from the postgres container + bring `seaweedfs-data` under rsync, or (b) migrate the compose to bind mounts.
2. **Backup gaps.** (a) **librechat (492 M incl. mongo) is still NOT in `STACKS=`** — add it + a `mongodump --archive` block. (b) **~~rallly has no DB dump~~ RESOLVED** — the 2026-11-12 run log shows `dumping rallly postgres` and `rallly-pg_dumpall.sql` in `db-dumps/`.
3. **Server reboot pending.** Running 7.0.0-31; 7.0.0-34 + 7.0.0-38 installed; `/var/run/reboot-required` present. Reboots proven safe (3×) — schedule one.
4. **The master doc has three copies, none version-controlled.** Repo copy (gitignored), server copy, laptop copy. All three have been missing at some point — the repo copy is a convenience, NOT a durable backup, because git never carries it.
5. **Orphan cert** for a subdomain with no vhost.d entry and no container. Probably a removed experiment. Identify before touching; certs are never deleted.
6. **Stale `app/instance/app.db`** (root-owned, empty schema — host-run leftover) — removal still pending. Also in `data/`: two dated `.bak-*` files — KEEP for now.
7. **Backup host `degraded`** — the only failed unit is the already-masked `systemd-networkd-wait-online.service`. Cosmetic.
8. **`pdf.*` → 401 to anonymous curl:** Stirling-PDF's own login. Working as intended.
9. **~~history TSV frozen~~ FIXED 2026-09-29** (`record_run()`). Missing rows stay missing (not fabricated).
10. **renderer REMOTE_CMD lacks `exit 0`** — likely moot. Keep queued, act only if it misbehaves.
11. **~~monthly.1 missing~~ RESOLVED 2026-10-01.**
12. **Reminder/deadline scans still have no server-side scheduler.** They run inside the REST list/unread endpoints; since 2026-11-12 the client hub calls them on a **5-minute tick** (was 60 s / 12 s), so reminders can fire up to 5 min later. Accepted for now. Correct fix = a server-side scheduler with `flock` + idempotency.
13. **`/events/api/notifications*` aliases are deprecated but still live.** Kept for one deploy cycle, then remove them and re-grep for consumers.
14. **The Dockerfile `CMD` change (2026-11-12) is a local modification on the server** — `app/Dockerfile` is git-tracked. It must be mirrored into the owner's local repo before the next `git pull`, or the pull conflicts. The compose change (`entrypoint:` → `command:`) is server-only, not tracked.

---

## 18. Document map — what exists where

| file | where | what |
|---|---|---|
| **`structure.md`** (private) | repo `__docs/` (gitignored) · server `~/` · laptop `/srv/backups/` | THE master, with real identifiers. Never committed |
| **`architecture.md`** (this file) | repo `__docs/` | public edition — same content, identifiers replaced |
| `apps.md` | repo `__docs/` | per-app notes |
| `RESTORE.md` / `RESTORE.txt` | server `/usr/local/share/` · laptop `/srv/backups/` | disaster restore recipes (drill-proven) |
| `BACKUP-SYSTEM.md` + `.html` | server `~/` · laptop `/srv/backups/` | historical explanation — superseded |
| live state | status page + `/var/log/docker-backup.log` + the history TSV | the truth, always fresher than any doc |

---

## 19. Timeline

| date | event |
|---|---|
| 2026-08-31 | system built: backup host wiped→Ubuntu, HDD formatted/mounted, key exchange, backup + rotation scripts + timers, first full run (22 min), restore DRILL passed, error mail proven |
| 2026-09-01 | first automatic run + first monthly.0 |
| 2026-09-02 | docs shipped, logrotate, kernel reboot — everything survived |
| 2026-09-06 | first weekly.0 |
| 2026-09-08 | paperless + stirling-pdf + fluxer + vaultwarden added; backup extended (4 dumps, ready-check); db-alias landmine found + fixed; one FAILED run |
| 2026-09-19 | status page v3 + basic auth; two regressions discovered |
| 2026-09-24 | full audit → master file v2.1; fixes queued |
| 2026-09-29 | bookkeeping FIXED (`record_run()`); users card added; stale host `app.db` logged |
| 2026-10-01 | first monthly rotation → monthly.1; all slots live |
| 2026-10-22 | nextcloud updated → 34-apache |
| 2026-10-24 | **rallly deployed** (postgres 18 + garage S3; added to STACKS; manual run same day) |
| 2026-10-25 | **librechat deployed** (mongo 7; NOT backup-integrated) · immich → v3.3.5 · app: "tasks site first iteration" |
| 2026-10-26 | full live re-audit → **v2.2**. master doc missing on both machines (re-shipped); librechat unbacked; reboot pending; fluxer volumes confirmed; upload limit 20g; media tree verified; disk 44 % |
| 2026-11-10 | **WebSocket relay deployed (TierForge).** Relay moved to `apps/tierforge/websocket.py`; LiveCursor dropped; new `websocket` service (expose 5001, no VIRTUAL_HOST); `location = /apps/tierforge/ws`; verified `101` + correct `Sec-WebSocket-Accept`. Relay stateless → no backup/DNS/cert change. v2.3 re-shipped |
| 2026-11-12 | **Notification channel deployed.** Shared relay package `flask_app/ws/`; `apps/tierforge/websocket.py` reduced to a wrapper; `app.py` dev boot starts it; `notificationHub.js` replaces three pollers (60 s/12 s) with one socket + 5-min scan tick + REST catch-up; `/events/api/notifications*` deprecated. Auth on `/ws/notifications` only: cookie + Origin, pre-accept, 60 s session revalidation → `4401`; TierForge path unchanged. `./data:/app/instance` (rw) added to the relay service; **Dockerfile CMD reduced to waitress only** — the app container had been running a second, unsupervised relay with 5001 open on `nginx-proxy` (found + fixed same session); compose `entrypoint:` → `command:`. nginx: exact `location = /ws/notifications`. **Backup: `nedwork-app.sqlite3` dump added**, verified integrity ok + 14 rows + matching sha; manual run SUCCESS 19:16:08→19:16:37. Corrections folded in: dump path has no `staging/`, rallly dump exists, 6 slots not 7. This file **v2.4**; public edition derived from it. |
