/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- CommonJS JavaScript is bundled into Obsidian release assets; TypeScript's JS audit cannot resolve require() module boundaries reliably. */

const { t } = require('./i18n');

class SettingsFolderMethods {
    _renderFolderTree(containerEl, settingsKey, counterKey, countLabel) {
        const allFolders = this._getAllFolders();
        const selected = new Set(this._sortFolders(this.plugin.settings[settingsKey] || []));
        const countClass = settingsKey === 'refreshFolders' ? 'ag-count-whitelist' : 'ag-count-blacklist';
        const isWhitelist = settingsKey === 'refreshFolders';
        const listName = isWhitelist ? t(this.plugin, 'folder_list_whitelist') : t(this.plugin, 'folder_list_blacklist');
        const counterName = isWhitelist ? t(this.plugin, 'folder_list_blacklist') : t(this.plugin, 'folder_list_whitelist');

        if (allFolders.length === 0) {
            containerEl.createEl('div', {
                text: t(this.plugin, 'folder_no_folders'),
                cls: 'setting-item-description'
            });
            return;
        }

        const folderContainer = containerEl.createDiv({ cls: 'understory-tree-container' });
        folderContainer.createEl('div', {
            text: isWhitelist ? t(this.plugin, 'folder_whitelist_hint') : t(this.plugin, 'folder_blacklist_hint'),
            cls: 'setting-item-description understory-spacing-after-sm'
        });

        const actionRow = folderContainer.createDiv({ cls: 'understory-folder-actions' });
        const selectAllButton = actionRow.createEl('button', { text: t(this.plugin, 'folder_select_all') });
        selectAllButton.type = 'button';
        selectAllButton.addClass('understory-folder-action-button');
        selectAllButton.addEventListener('click', async () => {
            const selectable = allFolders.filter((folder) => !this._isFolderBlockedByCounter(folder, counterKey));
            this.plugin.settings[settingsKey] = this._sortFolders(selectable);
            await this.plugin.saveSettings();
            this.display();
        });

        const clearButton = actionRow.createEl('button', { text: t(this.plugin, 'folder_clear_all') });
        clearButton.type = 'button';
        clearButton.addClass('understory-folder-action-button');
        clearButton.addEventListener('click', async () => {
            this.plugin.settings[settingsKey] = [];
            await this.plugin.saveSettings();
            this.display();
        });

        for (const node of this._buildFolderTree(allFolders)) {
            this._renderFolderNode(folderContainer, node, selected, settingsKey, counterKey, listName, counterName, 0);
        }

        containerEl.createEl('div', {
            text: t(this.plugin, 'folder_count', { label: countLabel, selected: selected.size, total: allFolders.length }),
            cls: `setting-item-description understory-spacing-before-xs ${countClass}`
        });
    }

    _buildFolderTree(folders) {
        const root = { children: new Map() };

        for (const folder of folders) {
            const parts = this._normalizeFolderPath(folder).split('/').filter((part) => part);
            let node = root;
            const pathParts = [];

            for (const part of parts) {
                pathParts.push(part);
                const path = pathParts.join('/');
                if (!node.children.has(part)) {
                    node.children.set(part, {
                        name: part,
                        path,
                        children: new Map(),
                    });
                }
                node = node.children.get(part);
            }
        }

        const sortNodes = (nodes) => [...nodes].sort((a, b) => a.name.localeCompare(b.name)).map((node) => ({
            ...node,
            children: sortNodes(node.children.values()),
        }));

        return sortNodes(root.children.values());
    }

    _renderFolderNode(containerEl, node, selected, settingsKey, counterKey, listName, counterName, depth) {
        const hasChildren = node.children.length > 0;
        const blocked = this._isFolderBlockedByCounter(node.path, counterKey);
        const checked = selected.has(node.path);
        const hasSelectedChild = this._nodeHasSelectedDescendant(node, selected);
        const hasBlockedChild = this._nodeHasBlockedDescendant(node, counterKey);
        const openByDefault = depth === 0 && (hasSelectedChild || hasBlockedChild);

        const wrapper = containerEl.createDiv({ cls: 'understory-folder-node' });
        const row = wrapper.createDiv({ cls: 'understory-folder-row' });
        row.title = node.path;
        if (blocked) row.addClass('understory-folder-row--disabled');

        const disclosure = row.createEl('button', { text: hasChildren ? (openByDefault ? '\u25be' : '\u25b8') : '\u25b8' });
        disclosure.type = 'button';
        disclosure.addClass('understory-folder-disclosure');
        if (!hasChildren) disclosure.addClass('understory-folder-disclosure--empty');

        const checkbox = row.createEl('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.indeterminate = !checked && hasSelectedChild;
        checkbox.disabled = blocked;
        checkbox.addClass('understory-folder-checkbox');

        const label = row.createEl('span', { text: node.name, cls: 'understory-folder-label' });
        if (blocked) {
            row.createEl('span', {
                text: t(this.plugin, 'folder_conflicts_with', { listName: counterName }),
                cls: 'understory-folder-status'
            });
        }

        const applySelection = async (enabled) => {
            if (blocked) return;
            this._activeScopeTab = settingsKey === 'refreshFolders' ? 'whitelist' : 'blacklist';
            this._setFolderSelection(settingsKey, counterKey, node.path, enabled);
            await this.plugin.saveSettings();
            this.display();
        };

        checkbox.addEventListener('change', () => {
            applySelection(checkbox.checked);
        });
        label.addEventListener('click', () => {
            if (blocked) return;
            applySelection(!checkbox.checked);
        });

        if (hasChildren) {
            const childrenEl = wrapper.createDiv({ cls: 'understory-folder-children' });
            childrenEl.style.display = openByDefault ? 'block' : 'none';
            disclosure.addEventListener('click', () => {
                const opening = childrenEl.style.display === 'none';
                childrenEl.style.display = opening ? 'block' : 'none';
                disclosure.textContent = opening ? '\u25be' : '\u25b8';
            });
            for (const child of node.children) {
                this._renderFolderNode(childrenEl, child, selected, settingsKey, counterKey, listName, counterName, depth + 1);
            }
        }
    }

    _nodeHasSelectedDescendant(node, selected) {
        return node.children.some((child) => selected.has(child.path) || this._nodeHasSelectedDescendant(child, selected));
    }

    _nodeHasBlockedDescendant(node, counterKey) {
        return node.children.some((child) => this._isFolderBlockedByCounter(child.path, counterKey) || this._nodeHasBlockedDescendant(child, counterKey));
    }

    _setFolderSelection(settingsKey, counterKey, folder, enabled) {
        const current = new Set(this.plugin.settings[settingsKey] || []);
        const counter = new Set(this.plugin.settings[counterKey] || []);
        const allFolders = this._getAllFolders();
        const affected = [folder, ...allFolders.filter((path) => path.startsWith(`${folder}/`))];

        if (enabled) {
            for (const path of affected) current.add(path);
            for (const path of [...counter]) {
                if (affected.some((candidate) => this._pathOverlapsFolder(path, candidate))) {
                    counter.delete(path);
                }
            }
        } else {
            for (const path of affected) current.delete(path);
        }

        this.plugin.settings[settingsKey] = this._sortFolders([...current]);
        this.plugin.settings[counterKey] = this._sortFolders([...counter]);
    }

    _isFolderBlockedByCounter(folder, counterKey) {
        const counter = this.plugin.settings[counterKey] || [];
        return counter.some((path) => this._pathOverlapsFolder(folder, path));
    }

    _sortFolders(folders) {
        return [...new Set(folders.map((path) => this._normalizeFolderPath(path)).filter((path) => path))]
            .sort((a, b) => a.localeCompare(b));
    }

    _pathCoversFolder(folderPath, selectedPath) {
        const folder = this._normalizeFolderPath(folderPath);
        const selected = this._normalizeFolderPath(selectedPath);
        return folder === selected || folder.startsWith(`${selected}/`);
    }

    _pathOverlapsFolder(path, folderPath) {
        const pathNorm = this._normalizeFolderPath(path);
        const folderNorm = this._normalizeFolderPath(folderPath);
        return pathNorm === folderNorm
            || pathNorm.startsWith(`${folderNorm}/`)
            || folderNorm.startsWith(`${pathNorm}/`);
    }

    _normalizeFolderPath(path) {
        return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
    }

    _getAllFolders() {
        const folders = new Set();
        for (const file of this.plugin.app.vault.getMarkdownFiles()) {
            const parts = file.path.split('/').slice(0, -1);
            for (let i = 1; i <= parts.length; i++) {
                const folder = parts.slice(0, i).join('/');
                if (folder) folders.add(folder);
            }
        }
        return [...folders].sort((a, b) => a.localeCompare(b));
    }
}

module.exports = SettingsFolderMethods.prototype;

/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- End CommonJS audit bridge. */
