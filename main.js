const { Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, requestUrl } = require("obsidian");

const DEFAULT_SETTINGS = {
  serverUrl: "",
  deviceName: "Obsidian plugin",
  pairingCode: "",
  token: "",
  selectedFolders: [],
  knownRevisions: {},
  knownHashes: {},
};
const SYNC_INTERVAL_MS = 3 * 60 * 1000;
const MAX_NOTE_CHARACTERS = 100_000;
const BATCH_SIZE = 50;
const MAX_BATCH_CHARACTERS = 1_000_000;

class ConfirmationModal extends Modal {
  constructor(app, title, message, resolve) {
    super(app);
    this.title = title;
    this.message = message;
    this.resolve = resolve;
    this.accepted = false;
  }

  onOpen() {
    this.contentEl.createEl("h2", { text: this.title });
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("Continue").setCta().onClick(() => {
        this.accepted = true;
        this.close();
      }));
  }

  onClose() {
    this.contentEl.empty();
    this.resolve(this.accepted);
  }
}

function confirmAction(app, title, message) {
  return new Promise((resolve) => new ConfirmationModal(app, title, message, resolve).open());
}

function versionParts(version) {
  return String(version || "0.0.0")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function isOlderVersion(candidate, current) {
  const left = versionParts(candidate);
  const right = versionParts(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) {
      return (left[index] || 0) < (right[index] || 0);
    }
  }
  return false;
}

async function hashText(text) {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function normalizeFolderScope(path) {
  return path === "/" || path === "" ? "" : path.replace(/^\/+|\/+$/g, "");
}

function isInFolders(path, folders) {
  return folders.some((folder) => {
    const scope = normalizeFolderScope(folder);
    return scope ? path.startsWith(`${scope}/`) : !path.includes("/");
  });
}

function scopeCoversFolder(scope, folder) {
  const normalizedScope = normalizeFolderScope(scope);
  const normalizedFolder = normalizeFolderScope(folder);
  if (!normalizedScope) return !normalizedFolder;
  return normalizedFolder === normalizedScope || normalizedFolder.startsWith(`${normalizedScope}/`);
}

function cloudNoteCountText(count) {
  return Number.isFinite(count)
    ? `Cloud currently has ${count} synced Markdown note${count === 1 ? "" : "s"}.`
    : "Cloud note count is unavailable until the Day & Age app is updated.";
}

function normalizedServerUrl(value) {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("Use an HTTPS server URL.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Enter only the app's base URL, without credentials or query parameters.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

module.exports = class DayAgeAIGurusPlugin extends Plugin {
  async onload() {
    const storedSettings = await this.loadData();
    const hadStoredSettings = storedSettings && Object.keys(storedSettings).length > 0;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings || {});
    const currentVersion = this.manifest.version;
    const previousVersion = this.settings.pluginVersion || (hadStoredSettings ? "0.1.0" : currentVersion);
    if (isOlderVersion(previousVersion, currentVersion)) {
      const accepted = await confirmAction(this.app, "Update plugin settings",
        `Day & Age AI Gurus ${currentVersion} needs to update its settings format. Your server, device, selected folders, and sync history will be preserved. No vault notes will be changed. Continue?`,
      );
      if (accepted) {
        this.settings.pluginVersion = currentVersion;
        await this.saveSettings();
        new Notice("Day & Age AI Gurus settings were updated. Your existing connection and sync history were preserved.");
      } else {
        this.migrationPending = true;
        this.syncStatus = "Settings update pending. Your existing settings are unchanged.";
      }
    } else if (!this.settings.pluginVersion) {
      this.settings.pluginVersion = currentVersion;
      await this.saveSettings();
    }
    this.syncInProgress = false;
    this.syncRequested = false;
    this.syncSuccessRequested = false;
    this.pendingFolderSelection = null;
    this.folderSavePromise = null;
    this.activeSyncDone = null;
    this.syncedNoteCount = null;
    if (!this.migrationPending) {
      this.syncStatus = this.settings.token ? "Waiting to sync." : "Not connected.";
    }
    this.lastSyncError = "";
    this.addSettingTab(new DayAgeSettingTab(this.app, this));
    this.addCommand({
      id: "sync-selected-folders",
      name: "Sync selected folders now",
      callback: () => this.syncVault(true),
    });
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.token) void this.syncVault(false);
    });
    this.registerInterval(window.setInterval(() => {
      if (this.settings.token) void this.syncVault(false);
    }, SYNC_INTERVAL_MS));
    this.registerDomEvent(window, "online", () => {
      if (this.settings.token) void this.syncVault(false);
    });
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible" && this.settings.token) {
        void this.syncVault(false);
      }
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  setSyncStatus(message) {
    this.syncStatus = message;
    if (this.syncStatusEl) this.syncStatusEl.textContent = message;
    if (this.syncCountEl) this.syncCountEl.textContent = cloudNoteCountText(this.syncedNoteCount);
  }

  async api(path, options = {}) {
    let baseUrl;
    try {
      baseUrl = normalizedServerUrl(this.settings.serverUrl);
    } catch (error) {
      throw new Error(error.message || "Enter a valid HTTPS server URL.");
    }
    const headers = { "Content-Type": "application/json" };
    if (options.token !== null && this.settings.token) {
      headers.Authorization = `Bearer ${this.settings.token}`;
    }
    const request = {
      url: `${baseUrl}${path}`,
      method: options.method || "GET",
      headers,
      throw: false,
    };
    if (options.body !== undefined) request.body = JSON.stringify(options.body);
    const response = await requestUrl(request);
    if (response.status < 200 || response.status >= 300) {
      const detail = response.json && typeof response.json.detail === "string"
        ? response.json.detail
        : `Request failed (${response.status}).`;
      if (response.status === 422 && path.endsWith("/settings/folders") &&
        options.body?.selectedFolders?.includes("") && detail.includes("valid vault folders")) {
        throw new Error("This app server is too old to sync vault-root notes. The updated app server must be running; your other folder choices have not been changed.");
      }
      throw new Error(detail);
    }
    return response.json;
  }

  async connect() {
    const code = this.settings.pairingCode.trim();
    if (!code) throw new Error("Enter the one-time pairing code from the web app.");
    const result = await this.api("/api/obsidian/pairings/consume", {
      method: "POST",
      token: null,
      body: { code, deviceName: this.settings.deviceName },
    });
    this.settings.token = result.token;
    this.settings.deviceName = result.deviceName;
    this.settings.pairingCode = "";
    this.settings.knownRevisions = {};
    this.settings.knownHashes = {};
    await this.saveSettings();
    const remoteSettings = await this.api("/api/obsidian/settings");
    this.settings.selectedFolders = remoteSettings.selectedFolders || [];
    this.syncedNoteCount = Number.isFinite(remoteSettings.syncedNoteCount)
      ? remoteSettings.syncedNoteCount
      : null;
    await this.saveSettings();
    this.setSyncStatus("Connected. Choose folders to sync.");
    this.lastSyncError = "";
    new Notice("Day & Age AI Gurus is connected.");
  }

  async disconnectDevice() {
    await this.api("/api/obsidian/device", { method: "DELETE" });
    this.settings.token = "";
    this.settings.selectedFolders = [];
    this.settings.knownRevisions = {};
    this.settings.knownHashes = {};
    this.syncedNoteCount = null;
    await this.saveSettings();
    this.setSyncStatus("Not connected.");
    this.lastSyncError = "";
    new Notice("This Obsidian device has been disconnected.");
  }

  async setFolders(folders) {
    if (!this.settings.token) throw new Error("Connect the plugin before choosing folders.");
    const scopes = [...new Set(folders.map(normalizeFolderScope))].sort();
    const normalized = scopes.filter((folder) =>
      !scopes.some((parent) => parent && parent !== folder && scopeCoversFolder(parent, folder)),
    );
    const previous = this.pendingFolderSelection ?? this.settings.selectedFolders;
    const removed = previous.some((folder) =>
      !normalized.some((scope) => scopeCoversFolder(scope, folder)),
    );
    if (removed && !await confirmAction(this.app, "Stop syncing this folder?",
      "This removes cloud copies of notes no longer selected for sync. Local vault notes stay unchanged. Continue?")) {
      return false;
    }
    this.pendingFolderSelection = normalized;
    this.setSyncStatus("Saving folder selection…");
    try {
      if (!this.folderSavePromise) {
        this.folderSavePromise = this.flushFolderSaveQueue()
          .finally(() => { this.folderSavePromise = null; });
      }
      await this.folderSavePromise;
      if (this.settings.selectedFolders.length && !this.syncInProgress) void this.syncVault(false);
    } catch (error) {
      this.pendingFolderSelection = null;
      this.setSyncStatus(`Folder selection was not saved: ${error instanceof Error ? error.message : "Try again."}`);
      throw error;
    }
    return true;
  }

  async flushFolderSaveQueue() {
    let finalSelection = this.settings.selectedFolders;
    while (this.pendingFolderSelection !== null) {
      // Finish a running sync before changing its server-side scope.
      if (this.activeSyncDone) await this.activeSyncDone;
      const requested = this.pendingFolderSelection;
      this.pendingFolderSelection = null;
      const result = await this.api("/api/obsidian/settings/folders", {
        method: "PUT",
        body: { selectedFolders: requested },
      });
      this.settings.selectedFolders = (result.selectedFolders || requested).map(normalizeFolderScope);
      if (Number.isFinite(result.syncedNoteCount)) {
        this.syncedNoteCount = result.syncedNoteCount;
      }
      this.forgetOutOfScopeSyncState(this.settings.selectedFolders);
      await this.saveSettings();
      finalSelection = this.settings.selectedFolders;
    }
    this.setSyncStatus(finalSelection.length
      ? `Folder selection saved. ${cloudNoteCountText(this.syncedNoteCount)} Syncing…`
      : "No folders selected.");
  }

  forgetOutOfScopeSyncState(folders) {
    for (const path of Object.keys(this.settings.knownHashes)) {
      if (!isInFolders(path, folders)) {
        delete this.settings.knownHashes[path];
        delete this.settings.knownRevisions[path];
      }
    }
    for (const path of Object.keys(this.settings.knownRevisions)) {
      if (!isInFolders(path, folders)) delete this.settings.knownRevisions[path];
    }
  }

  async ensureParentFolder(path) {
    const segments = path.split("/").slice(0, -1);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async preserveConflict(path, content) {
    const base = path.replace(/\.md$/i, "");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let conflictPath = `${base}.dayage-conflict-${stamp}.md`;
    let suffix = 1;
    while (this.app.vault.getAbstractFileByPath(conflictPath)) {
      conflictPath = `${base}.dayage-conflict-${stamp}-${suffix}.md`;
      suffix += 1;
    }
    await this.ensureParentFolder(conflictPath);
    await this.app.vault.create(conflictPath, content);
    new Notice(`A sync conflict was saved as ${conflictPath}.`);
  }

  async applyRemoteUpdate(update) {
    const file = this.app.vault.getAbstractFileByPath(update.path);
    let localContent = null;
    if (file instanceof TFile) localContent = await this.app.vault.cachedRead(file);
    const localHash = localContent === null ? null : await hashText(localContent);
    const knownHash = this.settings.knownHashes[update.path] || "";
    const remoteHash = await hashText(update.content);
    const hasUnsentLocalEdit = localHash !== null && localHash !== knownHash && localHash !== remoteHash;

    if (hasUnsentLocalEdit || update.conflict) {
      if (localContent !== null && localHash !== remoteHash) {
        await this.preserveConflict(update.path, localContent);
      }
    }
    if (file instanceof TFile) {
      if (localHash !== remoteHash) await this.app.vault.modify(file, update.content);
    } else {
      await this.ensureParentFolder(update.path);
      await this.app.vault.create(update.path, update.content);
    }
    this.settings.knownRevisions[update.path] = update.revision;
    this.settings.knownHashes[update.path] = remoteHash;
    await this.saveSettings();
  }

  async runSyncRequest(changes) {
    const response = await this.api("/api/obsidian/sync", {
      method: "POST",
      body: {
        notes: changes,
        knownRevisions: this.settings.knownRevisions,
      },
    });
    let downloadedCount = 0;
    for (const update of response.updates || []) {
      if (!isInFolders(update.path, this.settings.selectedFolders)) continue;
      await this.applyRemoteUpdate(update);
      downloadedCount += 1;
    }
    if (Number.isFinite(response.syncedNoteCount)) {
      this.syncedNoteCount = response.syncedNoteCount;
    }
    return {
      hasMore: Boolean(response.hasMore),
      downloadedCount,
    };
  }

  async syncVault(showSuccess = false) {
    if (!this.settings.token || this.migrationPending) return;
    if (this.folderSavePromise) return;
    if (this.syncInProgress) {
      this.syncRequested = true;
      this.syncSuccessRequested = this.syncSuccessRequested || showSuccess;
      return;
    }
    this.syncInProgress = true;
    let finishSync;
    this.activeSyncDone = new Promise((resolve) => { finishSync = resolve; });
    try {
      const remoteSettings = await this.api("/api/obsidian/settings");
      this.settings.selectedFolders = (remoteSettings.selectedFolders || []).map(normalizeFolderScope);
      if (Number.isFinite(remoteSettings.syncedNoteCount)) {
        this.syncedNoteCount = remoteSettings.syncedNoteCount;
      }
      this.setSyncStatus(`Checking ${this.settings.selectedFolders.length} selected folder scope${this.settings.selectedFolders.length === 1 ? "" : "s"}…`);
      this.forgetOutOfScopeSyncState(this.settings.selectedFolders);
      await this.saveSettings();
      const folders = this.settings.selectedFolders;
      if (!folders.length) {
        this.setSyncStatus("Choose at least one folder in plugin settings.");
        return;
      }

      const changes = [];
      const scopedFiles = this.app.vault.getMarkdownFiles().filter((file) => isInFolders(file.path, folders));
      let skippedOversized = 0;
      for (const file of scopedFiles) {
        const content = await this.app.vault.cachedRead(file);
        if (content.length > MAX_NOTE_CHARACTERS) {
          skippedOversized += 1;
          continue;
        }
        const localHash = await hashText(content);
        const knownHash = this.settings.knownHashes[file.path] || "";
        if (localHash === knownHash) continue;
        changes.push({
          path: file.path,
          content,
          baseRevision: this.settings.knownRevisions[file.path] || 0,
          clientModifiedAt: new Date(file.stat.mtime).toISOString(),
        });
      }

      let batches = [];
      let downloadedCount = 0;
      let hasMoreRemoteUpdates = false;
      let batch = [];
      let batchCharacters = 0;
      for (const change of changes) {
        if (batch.length && (batch.length >= BATCH_SIZE ||
          batchCharacters + change.content.length > MAX_BATCH_CHARACTERS)) {
          batches.push(batch);
          batch = [];
          batchCharacters = 0;
        }
        batch.push(change);
        batchCharacters += change.content.length;
      }
      if (batch.length) batches.push(batch);
      if (!batches.length) batches = [[]];
      for (const batch of batches) {
        let result = await this.runSyncRequest(batch);
        downloadedCount += result.downloadedCount;
        let pages = 0;
        while (result.hasMore && pages < 100) {
          result = await this.runSyncRequest([]);
          downloadedCount += result.downloadedCount;
          pages += 1;
        }
        hasMoreRemoteUpdates = hasMoreRemoteUpdates || result.hasMore;
      }
      const skippedText = skippedOversized ? ` Skipped ${skippedOversized} oversized note${skippedOversized === 1 ? "" : "s"}.` : "";
      const pendingText = hasMoreRemoteUpdates ? " More cloud notes remain; tap Sync now to continue." : "";
      const cloudSummary = Number.isFinite(this.syncedNoteCount)
        ? `${this.syncedNoteCount} Markdown notes`
        : "cloud note count unavailable until the Day & Age app is updated";
      this.setSyncStatus(
        `Sync complete: ${cloudSummary} in ${folders.length} selected folder scope${folders.length === 1 ? "" : "s"}. Scanned ${scopedFiles.length}; uploaded ${changes.length}; received ${downloadedCount}.${skippedText}${pendingText}`,
      );
      this.lastSyncError = "";
      if (showSuccess) {
        new Notice(Number.isFinite(this.syncedNoteCount)
          ? `Synced ${this.syncedNoteCount} Markdown notes from the selected folders.`
          : "Selected Obsidian folders were synced.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed.";
      this.setSyncStatus(`Sync issue: ${message}`);
      if (message !== this.lastSyncError) new Notice(`Day & Age Obsidian sync: ${message}`);
      this.lastSyncError = message;
    } finally {
      this.syncInProgress = false;
      this.activeSyncDone = null;
      finishSync();
      if (this.syncRequested && this.settings.token) {
        const requestedShowSuccess = this.syncSuccessRequested;
        this.syncRequested = false;
        this.syncSuccessRequested = false;
        void this.syncVault(requestedShowSuccess);
      }
    }
  }
};

class DayAgeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Day & Age AI Gurus" });
    containerEl.createEl("p", {
      text: "Only folders you select are synced. Cloud copies are encrypted at rest. Relevant excerpts may be sent to Anthropic when a Guru uses them to answer you.",
      cls: "setting-item-description",
    });
    this.plugin.syncStatusEl = containerEl.createEl("p", {
      text: this.plugin.syncStatus,
      cls: "setting-item-description",
    });
    this.plugin.syncCountEl = containerEl.createEl("p", {
      text: cloudNoteCountText(this.plugin.syncedNoteCount),
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("App server URL")
      .setDesc("Use your HTTPS Day & Age AI Gurus app URL.")
      .addText((text) => text
        .setPlaceholder("https://your-app.example")
        .setValue(this.plugin.settings.serverUrl)
        .setDisabled(Boolean(this.plugin.settings.token))
        .onChange(async (value) => {
          this.plugin.settings.serverUrl = value.trim().replace(/\/+$/, "");
          await this.plugin.saveSettings();
        }));

    if (!this.plugin.settings.token) {
      new Setting(containerEl)
        .setName("Device name")
        .setDesc("A label to recognize this Obsidian installation.")
        .addText((text) => text
          .setValue(this.plugin.settings.deviceName)
          .onChange(async (value) => {
            this.plugin.settings.deviceName = value.trim().slice(0, 80) || "Obsidian plugin";
            await this.plugin.saveSettings();
          }));
      new Setting(containerEl)
        .setName("One-time pairing code")
        .setDesc("Create this code in the Integrations page of the web app.")
        .addText((text) => text
          .setValue(this.plugin.settings.pairingCode)
          .onChange(async (value) => {
            this.plugin.settings.pairingCode = value.trim();
            await this.plugin.saveSettings();
          }))
        .addButton((button) => button
          .setButtonText("Connect")
          .setCta()
          .onClick(async () => {
            try {
              await this.plugin.connect();
              this.display();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : "Connection failed.");
            }
          }));
    } else {
      new Setting(containerEl)
        .setName(`Connected as ${this.plugin.settings.deviceName}`)
        .setDesc("Each Obsidian installation should be paired separately.")
        .addButton((button) => button
          .setButtonText("Disconnect this device")
          .setWarning()
          .onClick(async () => {
            try {
              await this.plugin.disconnectDevice();
              this.display();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : "Disconnect failed.");
            }
          }));

      containerEl.createEl("h3", { text: "Folders to sync" });
      containerEl.createEl("p", {
        text: "Each folder switch includes every subfolder inside it. Only top-level folders are listed to keep this screen manageable. Root-level notes are a separate choice. Turning a folder off removes its cloud copies, never your local notes.",
        cls: "setting-item-description",
      });
      const knownScopes = [
        ...this.app.vault.getAllLoadedFiles()
          .filter((item) => item instanceof TFolder).map((folder) => normalizeFolderScope(folder.path)),
        ...this.plugin.settings.selectedFolders.map(normalizeFolderScope),
      ];
      const folderPaths = ["", ...new Set(knownScopes.filter(Boolean).map((path) => path.split("/")[0]))]
        .sort((left, right) => left.localeCompare(right));
      let selected = new Set(this.plugin.settings.selectedFolders.map(normalizeFolderScope));
      const folderToggles = [];
      let refreshingControls = false;
      const refreshFolderToggles = () => {
        refreshingControls = true;
        try {
          for (const item of folderToggles) {
            const included = [...selected].some((scope) => scopeCoversFolder(item.path, scope));
            item.toggle.setValue(included);
            if (item.path) {
              item.setting.setDesc(included && !selected.has(item.path)
                ? "Some subfolders are selected. Turn off to clear them; turn back on to include the whole folder."
                : "Includes all subfolders. Turning this off excludes the entire folder.");
            }
          }
        } finally {
          refreshingControls = false;
        }
      };
      const saveSelection = async (next, toggle, previousValue) => {
        selected = next;
        refreshFolderToggles();
        try {
          const changed = await this.plugin.setFolders([...selected]);
          if (!changed) {
            selected = new Set(this.plugin.settings.selectedFolders.map(normalizeFolderScope));
            toggle.setValue(previousValue);
            refreshFolderToggles();
            return;
          }
          selected = new Set(this.plugin.settings.selectedFolders.map(normalizeFolderScope));
          refreshFolderToggles();
        } catch (error) {
          selected = new Set(this.plugin.settings.selectedFolders.map(normalizeFolderScope));
          toggle.setValue(previousValue);
          refreshFolderToggles();
          new Notice(error instanceof Error ? error.message : "Folder selection could not be saved.");
        }
      };

      new Setting(containerEl)
        .setName("Select all")
        .setDesc("Sync all Markdown notes in this vault, including root-level notes and nested folders.")
        .addButton((button) => button
          .setButtonText("Select all")
          .onClick(async () => {
            if (!await confirmAction(this.app, "Sync every folder?",
              "This syncs every Markdown note in the vault, including root-level notes, to your encrypted cloud copy. Attachments are not included.")) return;
            try {
              const changed = await this.plugin.setFolders(folderPaths);
              if (changed) {
                selected = new Set(this.plugin.settings.selectedFolders.map(normalizeFolderScope));
                refreshFolderToggles();
              }
            } catch (error) {
              new Notice(error instanceof Error ? error.message : "Folder selection could not be saved.");
            }
          }));

      for (const path of folderPaths) {
        const setting = new Setting(containerEl).setName(path || "Vault root notes");
        if (!path) setting.setDesc("Markdown notes stored directly in the vault root.");
        else setting.setDesc("Includes all subfolders. Turning this off excludes the entire folder.");
        let toggle;
        setting.addToggle((component) => {
          toggle = component;
          return component
            .setValue(selected.has(path))
            .onChange((enabled) => {
              if (refreshingControls) return;
              const previousValue = !enabled;
              const next = new Set([...selected].filter((scope) => !scopeCoversFolder(path, scope)));
              if (enabled) next.add(path);
              return saveSelection(next, component, previousValue);
            });
        });
        folderToggles.push({ path, toggle, setting });
      }
      refreshFolderToggles();
      new Setting(containerEl)
        .setName("Sync now")
        .setDesc("The plugin also checks for changes when Obsidian opens and every three minutes while it is open.")
        .addButton((button) => button
          .setButtonText("Sync now")
          .onClick(() => void this.plugin.syncVault(true)));
    }
  }
}
