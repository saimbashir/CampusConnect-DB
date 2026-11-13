# Publish CampusConnect to its own public repository

Recommended GitHub repository name: `CampusConnect-DB`.

1. Create a new **Public** GitHub repository, with no README/License/.gitignore initialization.
2. Extract this ZIP; open a terminal inside its `CampusConnect` folder.
3. Run:

```bash
git init
git branch -M main
git add .
git commit -m "feat: publish CampusConnect database showcase"
git remote add origin https://github.com/YOUR_USERNAME/CampusConnect-DB.git
git push -u origin main
```

Replace `YOUR_USERNAME`. If this chat's GitHub connector is connected and the empty repository already exists, it may be used to upload the release source for you instead.

**Do not include local** `.db`, `.db-wal`, `.db-shm`, `.env`, actual user records, or private exports. Only the clean source and fictional preview images belong on GitHub.
