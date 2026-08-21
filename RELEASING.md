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

**Do not attach:** `win-unpacked/` (that's the whole Electron runtime),
`builder-debug.yml`, `latest.yml`, or `*.blockmap` (those two are for
electron-updater, which this project doesn't use).

**About the MSI.** `package.json` declares an `msi` target, but `build.bat`
deliberately builds only `--win nsis portable` — the msi was dropped to save
build time. That's why neither 6.0.0 nor 6.1.0 shipped one. The workflow mirrors
`build.bat`, so it doesn't build or expect an msi either.

To bring it back you need **both**: add `msi` to the electron-builder args in
`.github/workflows/release.yml`, and uncomment the `dist/NET-ETHER-Setup-*.msi`
line in the upload step. Changing only one of the two will fail the job.

---

## Cutting a new release

```bash
# 1. Bump "version" in package.json, e.g. 6.1.1
git add package.json
git commit -m "chore: bump to 6.1.1"

# 2. Tag it. The tag is what triggers the build.
git tag v6.1.1
git push origin main --tags
```

That's it. GitHub Actions builds on a Windows runner and attaches both files to
the release automatically. Watch it under the **Actions** tab; takes about
2 minutes.

If the release notes need writing, edit the release afterwards — the assets are
already there.

---

## Backfilling a release that's missing its binaries

**A. Re-run the workflow against the old tag** (nothing to rebuild locally):

1. Actions tab → "Build and attach release binaries" → **Run workflow**
2. Leave the branch as `main`, type the tag in the input box
3. Run

The leading `v` is optional — `6.1.0` and `v6.1.0` both work. A tag that doesn't
exist fails in ~2 seconds and prints the list of tags that do.

This works even on tags that predate the workflow file: GitHub reads the
workflow definition from `main`, and the job checks out the tag's source
separately.

**B. Drag them on by hand** (fastest if you already have `dist/` built):

1. Go to the release page → **Edit** (pencil icon, top right)
2. Drag the two files from `dist/` into the "Attach binaries" box
3. **Update release**

Do one or the other, not both — identical filenames will collide.

---

## Where the downloads live

Public, no login, `curl`-able, safe to link from docs or other projects:

```
https://github.com/mehanem-web/net-ether/releases/download/v6.1.0/NET-ETHER-portable-6.1.0.exe
```

---

## Troubleshooting

Every one of these actually happened while setting this up. If CI goes red,
open the run → click the red step → expand it → read the last few lines. The
answer is almost always right there.

**`git.exe failed with exit code 1`, job dies in ~40s**
Checkout couldn't find the tag. Almost always a typo in the tag input. The
current workflow catches this before building and tells you the valid tags, so
if you're seeing the raw git error, the workflow is out of date.

**`GitHub Personal Access Token is not set ... GH_TOKEN`, job dies after a
successful build**
electron-builder detected CI and tried to publish to GitHub by itself. The build
worked; the publish attempt killed the job before the upload step ran. Fix is
the `--publish never` flag on the electron-builder command — it's already there,
so don't remove it. Setting `GH_TOKEN` to empty does NOT prevent this.

**Job dies ~5 min in, errors mention `msi` / `WiX` / `candle.exe`**
Something re-added the msi target. See the MSI note above.

**Upload step fails with 403**
Repo **Settings → Actions → General → Workflow permissions** got set to
read-only. Flip it to read and write.

**`nothing to commit, working tree clean` when you expected a change**
The file you meant to edit never actually got replaced. Always confirm with
`git status -s` showing `M` before committing.

---

## Keep CI and build.bat in sync

The workflow runs the same `npx electron-builder --win nsis portable` with the
same `CSC_IDENTITY_AUTO_DISCOVERY=false` that `build.bat` sets. If you change
the build args in one, change them in the other — otherwise local builds and
released builds quietly stop matching.

---

## Notes

- **Unsigned builds.** `package.json` sets publisher "Broman Enterprises" but
  there's no certificate, so SmartScreen will warn on download. Same as local
  builds. If a cert ever appears, add `CSC_LINK` and `CSC_KEY_PASSWORD` as repo
  secrets and drop the `CSC_IDENTITY_AUTO_DISCOVERY` line.
- **Size limits.** Repo files cap at 100 MB (hard block). Release assets cap at
  2 GB. The installers are ~100 MB, which is exactly why they belong on the
  release and not in the tree.
