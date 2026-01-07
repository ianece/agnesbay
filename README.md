# Agnes Bay — GitHub Pages site

This repository contains a minimal static site scaffold ready for GitHub Pages.

How to publish

- Option A — Repo named `yourusername.github.io`:
  1. Create a repository named `yourusername.github.io` on GitHub.
  2. Push this project to the repo's `main` branch.
  3. The site will be available at `https://yourusername.github.io`.

- Option B — Any repo (use Pages from branch):
  1. Push to your repository.
  2. In GitHub, go to Settings → Pages and choose the branch `main` (root).

Quick commands

```bash
git init
git add .
git commit -m "Initial site"
git remote add origin git@github.com:yourusername/yourrepo.git
git branch -M main
git push -u origin main
```

Custom domain

Add a `CNAME` file with your domain name (no protocol) to enable a custom domain.
