# TradeBreak Desktop

The TradeBreak desktop app for Windows and macOS. It is a secure window around the
TradeBreak web terminal at https://web.tradebreak.com, so desktop users always get
the latest terminal release.

## Download

Get the latest installers from [Releases](https://github.com/makfieej2x/tradebreak-desktop/releases/latest).

The app is not code-signed yet, so your computer will warn you once:

- **Windows:** on "Windows protected your PC", click **More info → Run anyway**.
- **macOS:** open the app once. When macOS blocks it, go to **System Settings → Privacy & Security**,
  scroll down and click **Open Anyway**.

- **Linux (Ubuntu, Mint, Debian):** `sudo apt install ./TradeBreak-<version>-linux-amd64.deb`, then open TradeBreak from the app menu.
  No admin rights? Download the `.tar.gz`, extract it, and run `tradebreak` inside the folder.

## What the app does and doesn't do

- Opens only `web.tradebreak.com` and `dash.tradebreak.com`; every other link opens in your browser.
- Sandboxed, context-isolated pages with no Node.js access, and no other permissions besides
  clipboard writes, notifications and fullscreen.
- Keeps your sign-in in the app's own browser profile, the same protected cookie the web terminal uses.
- Shows a "Can't reach TradeBreak" screen when offline. It never shows cached or placeholder prices.
- Windows updates itself from GitHub Releases. On macOS, updates are downloaded manually until the app is signed.
- Contains no trading logic, market data, keys or secrets.

## Building

Installers are built by GitHub Actions on every push (`.github/workflows/build.yml`).
Pushing a `v*` tag builds them and attaches them to a draft release for review.

```bash
npm install
npm run icon
npm start        # run locally
npm run dist     # build installers for the current OS
```

## Adding code signing later

- macOS: set `mac.identity` to the Developer ID, enable `hardenedRuntime` and notarization,
  and add `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` as repository secrets.
- Windows: add Azure Trusted Signing (`win.azureSignOptions`) and its secrets.

Copyright © TradeBreak. All rights reserved.
