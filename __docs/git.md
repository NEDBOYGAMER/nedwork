# Before starting to code!!!

```bash
git pull
```

# How to Push Your Changes

Follow these steps whenever you want to push your work to the repository.

## 1. Check Your Changes

Review the files you have modified and make sure everything is working correctly.

```bash
git status
```

## 2. Stage the Files You Want to Commit

Add only the files you want to include in this commit.

```bash
git add flask_app/auth
```

You can also add multiple files at once:

```bash
git add flask_app/auth path/to/another/file path/to/file3
```

## 3. Create a Commit

Create a commit with a clear and meaningful message describing what you changed.

```bash
git commit -m "Add user authentication"
```

Example commit messages:

- `Add user authentication validation`
- `Fix login redirect bug`
- `Update dashboard styling`

## 4. Pull the Latest Changes

Before pushing, rebase your branch onto the latest remote changes.

```bash
git pull --rebase
```

## 5. Resolve Merge Conflicts (If Any)

If Git reports merge conflicts:

1. Open the project in Visual Studio Code.

   ```bash
   code .
   ```

2. Resolve each conflict by choosing or editing the correct code.
3. Save all files.
4. Stage the resolved files:

   ```bash
   git add <resolved-file>
   ```

5. Continue the rebase:

   ```bash
   git rebase --continue
   ```

Repeat until the rebase is complete.

## 6. Verify Everything

Run your application and make sure everything still works as expected.

Optionally, check the repository status again:

```bash
git status
```

## 7. Push Your Changes

Once everything is clean and working, push your commit.

```bash
git push
```

---

## Quick Reference

```bash
git status
git add <files>
git commit
git pull --rebase
# Resolve conflicts if necessary
git push
```

---

# Deploying to nedwork.ch

Deploying is the operator's job (agent sessions never push — that rule
exists because deploys happen from the server, not the dev machine). The
flow below exists because one stale-code incident happened: 33 modified +
untracked files sat uncommitted on 2026-11-01, the server kept serving old
code, and console/gate fixes didn't ship. **A commit is the smallest unit
that can deploy.**

## 1. Local: commit before you think about deploying

```bash
git status            # anything uncommitted?
git add <files>
git commit -m "..."
```

The server can only ever run what you've committed (see the "Never push"
rule in `AGENTS.md`). Uncommitted work is invisible to deployment.

## 2. Server: pull the new commit

```bash
ssh nedwork
cd ~/docker/nedwork/app        # the app source is a git repo on the server
git pull                       # get the committed state
```

The live database is `nedwork/data/app.db` (bind-mounted, WAL mode) —
pulling does **not** touch it. `instance/` inside the repo is runtime
junk on the server; never delete/replace `data/`.

## 3. Server: rebuild + restart the container

The `Dockerfile` runs `waitress-serve --call app:create_app` on port 8000,
and `app.py`'s `db.create_all()` + `permissions.ensure_all()` bootstrap
fires at import — i.e. on container start. So restarting the container is
what applies schema/migration-free seeds:

```bash
cd ~/docker/nedwork           # where the compose file lives
docker compose build          # bakes in the new committed code
docker compose up -d          # recreate the container
docker compose logs --tail 20 # confirm clean boot (or check the failure)
```

## 4. Post-deploy smoke

- Ctrl+Shift+R on https://nedwork.ch (flushes the cached JS/CSS; a hard
  refresh is required or you'll test old assets).
- Log in and confirm the admin console renders + one version-sensitive
  page (e.g. the events site or a feature you just changed).
- Watch for schema drift: if the boot output says a migration is needed,
  run `flask db upgrade` inside the container before using the site.

## Rollback (if a deploy is bad)

```bash
ssh nedwork
cd ~/docker/nedwork/app
git log --oneline -5           # find the previous good commit
git checkout <good-sha>        # or: git revert <bad-sha>
cd ~/docker/nedwork
docker compose build && docker compose up -d
```
