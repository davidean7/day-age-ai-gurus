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
3. Open the plugin settings and enter this **App server URL** exactly: `https://datechguru.app`. This is the app's base URL—do not add `/api`, a sign-in path, or a trailing slash.
4. In the app, open **Integrations → Obsidian → Create pairing code**. Enter the one-time code in the plugin and tap **Connect** within ten minutes.
5. Choose folders to sync. Each top-level switch includes that folder and all its subfolders; the list does not repeat every nested folder. **Vault root notes** controls only Markdown notes outside folders. **Select all** includes both. Turning a folder off clears its entire subtree from the selection, after an in-app confirmation, without deleting local notes. Existing subfolder-only selections are preserved and labeled until you change their parent switch.
6. Tap **Sync now** and wait for **Sync complete**. Compare the scanned and cloud-note counts. Oversized notes (over 100,000 characters) are reported as skipped. Only Markdown notes are synced, not PDFs or other attachments.
7. Ask a Guru to read a specific note by its title or folder/topic. A generic request such as “Can you read my notes?” shows a limited title index and prompts for a note or topic. The bot receives relevant excerpts, not every synced note in every message.

## Release 0.2.4

- Uses Obsidian's own confirmation dialogs, rather than browser dialogs, for mobile folder changes and upgrades.
- Groups the picker by top-level folder, supports turning entire folder groups off, and keeps root-level notes independent.
- Serializes scope changes behind an active sync and splits large uploads by both note count and character count.
- Fixes the unavailable cloud-count display and explains when an old app server rejects root-level sync.
- The companion app-server update searches note titles and folder paths as well as note text, prioritizes specifically named notes even outside the recent-note window, and handles short follow-ups such as “read it.”

**Update both parts:** the plugin release does not update the Day & Age app server. The corresponding server changes must also be running for the new note retrieval behavior and root-note support. Keep the existing pairing; a fresh code is not required for an ordinary upgrade.

For maintainers, keep the repository's `manifest.json`, release tag `0.2.4` (without a `v`), and release-asset manifest version identical. Attach `main.js` and `manifest.json` individually to the GitHub release; uploading only a ZIP is not enough for the community installer.

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

Automated tests exercise pairing, folder filtering and removal, native confirmation dialogs, upload-size limits, sync/save ordering, online retry, conflict copies, and settings migration using Obsidian-compatible API mocks. The companion server has synthetic encrypted-note tests covering sync, scoped retrieval, and prompt handoff without paid AI calls. These do not replace physical-device testing: the revised release still needs iOS retesting and the Android checklist remains untested.
