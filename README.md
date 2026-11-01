# Day and Age AI Gurus

Sync Markdown notes from folders you select to your Day & Age AI Gurus account. A Day & Age AI Gurus account is required, and workspace access is invite-only. The plugin supports Obsidian desktop, iOS, and Android and does not use Node or Electron features at runtime.

## Install

In Obsidian, open **Settings → Community plugins → Browse**, search for **Day and Age AI Gurus**, install it, and enable it. If it does not appear in Browse yet, open the [public listing](https://community.obsidian.md/plugins/day-age-ai-gurus) and select **Add to Obsidian**.

For pre-release testing, install a release package manually. The release ZIP contains the two files Obsidian needs: `manifest.json` and `main.js`. From this plugin's source directory, build it with:

```sh
bash package-release.sh
```

The script prints the ZIP path and SHA-256 checksum. Use the package matching the release version; do not use source snapshots or rename a package from a different version.

1. Unzip the package into your vault at `.obsidian/plugins/day-age-ai-gurus/`. The folder must contain `manifest.json` and `main.js` directly.
2. In Obsidian, open **Settings → Community plugins**, turn off Restricted mode if prompted, and enable **Day & Age AI Gurus**.
3. Open the plugin settings and enter your Day & Age AI Gurus app's HTTPS base URL. (https://datechguru.app)
4. In the app, open **Integrations → Obsidian → Create pairing code**. Enter the one-time code in the plugin and tap **Connect** within ten minutes.
5. Choose folders to sync, or use **Select all** to include every folder and Markdown notes stored directly in the vault root. The settings page shows the number of notes stored in the cloud. The server enforces the selection for every sync request.

### Android

Use a file manager that can access the vault folder, extract the ZIP into the exact plugin directory above, then reopen Obsidian and enable the plugin. If the vault is in a synced folder, wait for the plugin files to finish syncing before enabling it.

### iOS

For a vault in iCloud Drive, use Files to extract the ZIP into the vault's `.obsidian/plugins/day-age-ai-gurus/` folder, then reopen Obsidian and enable it. If the vault is stored in Obsidian's app-only storage and Files cannot access its `.obsidian` folder, install the plugin from the Community Plugins browser in Obsidian instead.

## Sync, account, and network use

The plugin communicates over HTTPS with the Day & Age AI Gurus server you configure. Pairing and sync require a Day & Age AI Gurus account. It syncs when Obsidian opens, when the app returns to the foreground, when the device reports that it is online again, and every three minutes while Obsidian is running. iOS and Android may pause background work; queued edits retry when Obsidian is active and online.

Only selected folders are uploaded. Notes are encrypted at rest on the server. When a note matches your chat request, only relevant excerpts may be sent to Anthropic to answer that request; unrelated notes are not sent. Note contents are not logged by the API.

If a local edit conflicts with a newer cloud copy, the plugin saves the local text to a timestamped `.dayage-conflict-...md` file and updates the original note with the cloud copy. Removing a folder from selection deletes its encrypted cloud copies but leaves local notes unchanged. Local note deletions are not mirrored. Disconnecting from the app revokes paired devices and deletes synced cloud copies.

## Tests

Run the API-mock tests from this plugin's source directory:

```sh
node --test test/plugin.test.js
```

## Upgrades

Obsidian keeps plugin data in the vault, separate from the plugin code. Replacing the plugin files with a newer release preserves the app URL, paired device token, selected folders, and sync history. When a release requires a settings migration, the plugin asks before updating its stored version and clearly states what is preserved. Declining leaves the migration prompt for the next launch.

## Mobile verification status

Automated tests exercise pairing, folder filtering, online retry, conflict copies, and settings migration using Obsidian-compatible API mocks. They do not replace installation and network testing on physical devices. Use [MOBILE-TESTING.md](./MOBILE-TESTING.md) to record iOS and Android results before treating a release as device-verified.
