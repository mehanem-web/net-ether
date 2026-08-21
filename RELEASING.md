# Releasing NET//ETHER

Short version: **build output never goes in the repo.** It gets attached to the
GitHub Release as an asset. `.gitignore` already blocks `dist/`, `*.exe`, and
`*.msi` — leave that alone.

---

## What actually ships

Two files out of `dist/`, and nothing else:

| File | What it is |
|---|---|
| `NET-ETHER-Installer-<version>.exe` | NSIS installer, ~100 MB |
| `NET-ETHER-portable-<version>.exe` | Portable, no install, ~100 MB |

**About the MSI.** `package.json` declares an `msi` target, but it hasn't
produced output for 6.0.0 or 6.1.0 — neither release shipped one. The workflow
therefore doesn't expect it. If you ever fix that target, uncomment the
`dist/NET-ETHER-Setup-*.msi` line in `.github/workflows/release.yml`.

**Do not attach:** `win-unpacked/` (that's the whole Electron runtime),
`builder-debug.yml`, `*.blockmap` (only needed for electron-updater, which this
project doesn't use), or anything else in `dist/`.

---

## Cutting a new release (once the workflow is in place)

```bash
# 1. Bump "version" in package.json, e.g. 6.1.1
git add package.json
git commit -m "chore: bump to 6.1.1"

# 2. Tag it. The tag is what triggers the build.
git tag v6.1.1
git push origin main --tags
```

That's it. GitHub Actions builds on a Windows runner and attaches all three
files to the release automatically. Watch it under the **Actions** tab; takes
roughly 5-10 minutes.

If the release notes need writing, edit the release afterwards — the assets are
already there.

---

## Backfilling a release that's missing its binaries

Two ways.

**A. Re-run the workflow against the old tag** (nothing to rebuild locally):

1. Actions tab → "Build and attach release binaries" → **Run workflow**
2. Leave the branch as `main`, type the tag (e.g. `v6.1.0`) in the input box
3. Run

This works even though the old tag predates the workflow file. GitHub reads the
workflow definition from `main`, and the job checks out the tag's source
separately.

**B. Drag them on by hand** (fastest if you already have `dist/` built):

1. Go to the release page → **Edit** (pencil icon, top right)
2. Drag the three files from `dist/` into the "Attach binaries" box
3. **Update release**

---

## First-time setup

Only needed once:

```bash
mkdir -p .github/workflows
# save release.yml into .github/workflows/release.yml
git add .github/workflows/release.yml
git commit -m "ci: build and attach Windows binaries on tag push"
git push
```

---

## Where the downloads live

Once attached, the URL is predictable and public — no login, `curl`-able,
safe to link from docs or other projects:

```
https://github.com/mehanem-web/net-ether/releases/download/v6.1.0/NET-ETHER-portable-6.1.0.exe
```

`releases/latest/download/<filename>` also works if you want a link that always
points at the newest release, though the filename contains the version so it
only helps for fixed names.

---

## Notes

- **Unsigned builds.** `package.json` sets publisher "Broman Enterprises" but
  there's no certificate, so SmartScreen will warn on download. Same as the
  local builds. If a cert ever appears, add `CSC_LINK` and `CSC_KEY_PASSWORD`
  as repo secrets — electron-builder picks them up, no workflow change needed.
- **Size limits.** Repo files cap at 100 MB (hard block). Release assets cap at
  2 GB. The installers are ~100 MB, which is exactly why they belong on the
  release and not in the tree.
