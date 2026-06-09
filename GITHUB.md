# Push this repo to GitHub

Follow these steps once on your Windows machine (from the project folder).

## 1. Prerequisites

- [Git for Windows](https://git-scm.com/download/win) installed (`git --version` in PowerShell).
- A [GitHub](https://github.com) account.
- Decide how you will authenticate to GitHub:
  - **SSH** (recommended long-term): you use `git@github.com:USER/REPO.git` and a key pair.
  - **HTTPS**: you use `https://github.com/USER/REPO.git` and a [Personal Access Token (classic)](https://github.com/settings/tokens) instead of a password when Git asks for credentials.

## 2. Create an empty repository on GitHub

1. Log in to GitHub → **New repository** (green button or [github.com/new](https://github.com/new)).
2. Choose a name (e.g. `dota2chipetracker`).
3. Leave **Add a README** unchecked if you already have a `README.md` here (avoids a merge conflict on first push).
4. Create the repository.

Copy the remote URL GitHub shows (SSH or HTTPS).

## 3. Initialize Git locally (this project folder)

Open PowerShell **in** your clone directory, for example:

```powershell
cd C:\Users\User\Projects\dota2chipetracker
git init
git add .
git status
```

Confirm `git status` does **not** list `.env`, `node_modules`, or build artifacts (they are in `.gitignore`). `pnpm-lock.yaml` **should** be staged so installs are reproducible.

```powershell
git commit -m "Initial commit"
git branch -M main
```

## 4. Connect to GitHub and push

Replace `YOUR_USER` and `YOUR_REPO` with your GitHub username and repository name.

**SSH:**

```powershell
git remote add origin git@github.com:YOUR_USER/YOUR_REPO.git
git push -u origin main
```

If `git push` fails with “Permission denied (publickey)”, add an SSH key to GitHub: [Adding a new SSH key to your GitHub account](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account).

**HTTPS:**

```powershell
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

When prompted for password, paste a **Personal Access Token** with `repo` scope, not your GitHub account password.

## 5. Later changes

```powershell
git add .
git commit -m "Describe your change"
git push
```

## 6. Optional: private repo and secrets

- Mark the repository **Private** on GitHub if you do not want the code public.
- Never commit `.env` or real database passwords. Use `.env.example` as documentation only.

## 7. Deploy from GitHub

After the repo is on GitHub, use [DEPLOY.md](./DEPLOY.md) on your home server (clone + Docker) or the Windows script `scripts/deploy-home-server.ps1` from your PC.
