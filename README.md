# Day & Age AI Gurus

Sync Markdown notes from selected Obsidian folders with your Day & Age AI Gurus account.

## Requirements

- Obsidian 1.5.0 or newer.
- A Day & Age AI Gurus account with workspace access.
- A working HTTPS address for your Day & Age AI Gurus app.
- An internet connection for pairing and syncing.

Day & Age AI Gurus workspace access is currently invite-only.

## Installation

This plugin is not yet listed in Obsidian's Community Plugins directory.

Once approved, open Settings → Community plugins, search for
"Day & Age AI Gurus", install it, and enable it.

For manual testing on a device where you can access your vault's plugin
directory:

1. Download main.js and manifest.json from the matching GitHub release.
2. Place both files directly inside:
   .obsidian/plugins/day-age-ai-gurus/
3. Open Obsidian → Settings → Community plugins.
4. Turn off Restricted mode if prompted, then enable Day & Age AI Gurus.

Manual installation on iOS depends on access to the vault's hidden
.obsidian directory. If you cannot access that directory, use the
Community Plugins listing once it is available.

## Connect your account

1. Open the plugin settings in Obsidian.
2. Enter your Day & Age AI Gurus app's HTTPS base URL.
3. In the Day & Age AI Gurus app, open Integrations → Obsidian.
4. Create a pairing code.
5. Enter that code in the plugin and select Connect within ten minutes.
6. Choose the folders you want to sync.

Keep pairing codes and device tokens private.

## Sync behavior

Only selected folders are uploaded.

The plugin attempts to sync when Obsidian opens, returns to the
foreground, detects that the device is online again, and every three
minutes while Obsidian is running.

Mobile operating systems may pause background work. Pending edits retry
when Obsidian is active and online.

If a local edit conflicts with a newer cloud copy, the plugin saves the
local text in a timestamped .dayage-conflict-...md file before updating
the original note with the cloud copy.

Local note deletions are not mirrored to the cloud. Removing a folder
from the selection deletes its cloud copies but keeps local notes.
Disconnecting through the app revokes paired devices and deletes synced
cloud copies.

## Privacy and network use

The plugin sends pairing and sync requests over HTTPS to the Day & Age
AI Gurus server you configure.

Selected notes are encrypted at rest on the server. When relevant to
your chat request, excerpts may be sent to Anthropic to help answer it.
Unrelated notes are not sent. Note contents are not logged by the API.

## Upgrades

Plugin settings are stored separately from the plugin code. Replacing
the plugin files preserves the configured app URL, paired device token,
selected folders, and sync history.

When a settings migration is required, the plugin requests confirmation.

## Mobile verification

The plugin is intended for desktop, iOS, and Android. Automated
API-mock tests cover pairing, folder filtering, retry behavior, conflict
copies, and settings migration.

Physical-device verification on iOS and Android is not yet complete.
Do not treat this release as mobile-verified.

## License

MIT. See LICENSE.
