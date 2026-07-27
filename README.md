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
