# NET//ETHER — Claude Code Context

## App Identity
- Current version: v6.0.0
- Product name: NET-ETHER
- appId: com.bromanenterprises.net-ether
- Install path: C:\Program Files\Broman Enterprises\NET-ETHER\
- Entry points: main.js / preload.js / src/index.html

## Build Commands
- `dev.bat` — runs Electron directly, no install needed, use for testing
- `build.bat` — produces NSIS installer in dist\, no pause/timeout, exits 0

## Versioning Rules (suite-wide, no exceptions)
- Every zip gets a version bump. Patch fix = patch, new feature = minor.
- Update package.json, README.md, folder name, and zip name together.
- Zip command:
  zip -qr outputs/NET-ETHER-vX.XX.zip NET-ETHER-vX.XX/ --exclude "*/dist/*" --exclude "*/node_modules/*" --exclude "*.7z" --exclude "*.exe" --exclude "*.msi"

## Stale Ref Check (run before every zip)
grep -rn "NET-CTRL|net-ctrl|netctrl|NET-HUD|net-hud|ETHERNET|net-ethernet|netethernet" across *.js *.json *.html *.bat *.md *.nsh
Zero stale refs allowed. Verify installer.nsh exe matches NET-ETHER.exe and registry keys use net-ether appId.

## Architecture — Critical Rules
- CSS drag: `-webkit-app-region: drag` on .titlebar — NEVER revert to IPC drag (causes window expansion at >100% DPI scaling)
- GPU cache fix: `app.setPath('userData')` required when running as Administrator
- Fonts: Orbitron + Share Tech Mono, bundled locally in assets/fonts/ — never CDN
- Window startup sizing must use DPI-aware logical pixels

## Theme Engine
- RGB channel CSS triplets: `--ar/ag/ab` (accent), `--bgr/bgg/bgb` (background), `--lr/lg/lb` (lowlight)
- Six presets per app, localStorage persistence
- localStorage key: `net-ether-theme`
- Identity color: green-cyan

## Known Patterns & Fixes
- VPN adapters: filtered via wmic description cross-reference
- Disconnected static adapter IP: registry GUID fallback
  HKLM\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{GUID}
- DHCP vs static badge: registry EnableDHCP as ground truth (not adapter state)

## Suite Context
This app is part of the NET// suite by Broman Enterprises, SSP Division.
Other apps: NET//DHCP (amber), NET//DEPLOYER (cyan), NET//AUDIO (deep red), NET//IMPORT.
All share the same theme engine architecture, icon family DNA, titlebar/drag/DPI behavior.
Install pattern: C:\Program Files\Broman Enterprises\NET-{APPNAME}\
Registry appId pattern: net-{appname}

## Icon
- Square rounded-corner format, dark background, orbital rings, node dots, corner bracket accents
- Icon file: assets/icon.ico
- Must be proper 6-size ICO (16-256, 32-bit RGBA) — Pillow's .ico writer is broken for multi-size, use raw binary packing

## Do Not
- Do not revert titlebar drag to IPC moveDelta/setPosition
- Do not load fonts from CDN
- Do not leave stale NET-CTRL/NET-HUD/ETHERNET refs in any file
- Do not skip version bump on any build
