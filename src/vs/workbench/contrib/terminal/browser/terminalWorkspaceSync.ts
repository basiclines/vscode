/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { ITerminalInstance, ITerminalService } from './terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { IExplorerService } from '../../files/browser/files.js';

/**
 * Syncs the workspace folders to match the terminal's current working directory
 * when a terminal gains focus. This enables a terminal-first workflow where
 * the workspace follows the terminal's location.
 */
export class TerminalWorkspaceSyncContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'terminal.workspaceSync';

	// Track folders that were added by this contribution (folder URI string -> Set of terminal IDs using it)
	private readonly _addedFolders = new Map<string, Set<number>>();

	constructor(
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IWorkspaceEditingService private readonly _workspaceEditingService: IWorkspaceEditingService,
		@IExplorerService private readonly _explorerService: IExplorerService
	) {
		super();

		// Listen to terminal focus events
		this._register(this._terminalService.onDidFocusInstance(instance => {
			this._syncWorkspaceToTerminal(instance);
		}));

		// Listen to terminal dispose events to remove folders
		this._register(this._terminalService.onDidDisposeInstance(instance => {
			this._removeTerminalFromTracking(instance);
		}));

		// On startup, sync workspace to current terminals
		this._initializeWorkspaceFromTerminals();
	}

	private async _initializeWorkspaceFromTerminals(): Promise<void> {
		// Wait a bit for terminals to be ready
		await new Promise(resolve => setTimeout(resolve, 1000));

		// Collect all current terminal cwds
		const terminalCwds = new Set<string>();
		for (const terminal of this._terminalService.instances) {
			if (terminal.cwd) {
				terminalCwds.add(URI.file(terminal.cwd).toString());
			}
		}

		// Get current workspace folders
		const workspaceFolders = this._workspaceContextService.getWorkspace().folders;

		// Remove workspace folders that don't match any terminal
		const foldersToRemove: URI[] = [];
		for (const folder of workspaceFolders) {
			const folderUriStr = folder.uri.toString();
			if (!terminalCwds.has(folderUriStr)) {
				foldersToRemove.push(folder.uri);
			}
		}

		if (foldersToRemove.length > 0) {
			try {
				await this._workspaceEditingService.removeFolders(foldersToRemove);
			} catch {
				// Silently ignore errors
			}
		}

		// Add folders for terminals that aren't in workspace yet
		for (const terminal of this._terminalService.instances) {
			if (terminal.cwd) {
				const cwdUri = URI.file(terminal.cwd);
				const existingFolder = this._workspaceContextService.getWorkspaceFolder(cwdUri);
				if (!existingFolder) {
					try {
						await this._workspaceEditingService.addFolders([{ uri: cwdUri }]);
						this._trackTerminalFolder(terminal.instanceId, cwdUri.toString());
					} catch {
						// Silently ignore errors
					}
				} else {
					this._trackTerminalFolder(terminal.instanceId, cwdUri.toString());
				}
			}
		}

		// Focus the first terminal to trigger reveal
		const firstTerminal = this._terminalService.instances[0];
		if (firstTerminal?.cwd) {
			try {
				await this._explorerService.select(URI.file(firstTerminal.cwd), true);
			} catch {
				// Ignore errors
			}
		}
	}

	private async _syncWorkspaceToTerminal(instance: ITerminalInstance): Promise<void> {
		const cwd = instance.cwd;
		if (!cwd) {
			return;
		}

		const cwdUri = URI.file(cwd);
		const cwdUriString = cwdUri.toString();

		// First, collect all current terminal cwds
		const allTerminalCwds = new Set<string>();
		for (const terminal of this._terminalService.instances) {
			if (terminal.cwd) {
				allTerminalCwds.add(URI.file(terminal.cwd).toString());
			}
		}

		// Remove folders that were added by us but no longer have any terminal pointing to them
		const foldersToRemove: URI[] = [];
		for (const [folderUriStr] of this._addedFolders) {
			if (!allTerminalCwds.has(folderUriStr)) {
				foldersToRemove.push(URI.parse(folderUriStr));
				this._addedFolders.delete(folderUriStr);
			}
		}

		if (foldersToRemove.length > 0) {
			try {
				await this._workspaceEditingService.removeFolders(foldersToRemove);
			} catch {
				// Silently ignore errors
			}
		}

		// Check if the focused terminal's folder is already in the workspace
		const existingFolder = this._workspaceContextService.getWorkspaceFolder(cwdUri);
		if (existingFolder) {
			// Track this terminal as using this folder
			this._trackTerminalFolder(instance.instanceId, cwdUriString);
			// Reveal in explorer
			try {
				await this._explorerService.select(cwdUri, true);
			} catch {
				// Ignore errors
			}
			return;
		}

		// Add the folder to the workspace
		try {
			await this._workspaceEditingService.addFolders([{ uri: cwdUri }]);
			// Track that we added this folder
			this._trackTerminalFolder(instance.instanceId, cwdUriString);
			// Reveal the newly added folder
			await this._explorerService.select(cwdUri, true);
		} catch {
			// Silently ignore errors
		}
	}

	private _trackTerminalFolder(terminalId: number, folderUri: string): void {
		let terminals = this._addedFolders.get(folderUri);
		if (!terminals) {
			terminals = new Set();
			this._addedFolders.set(folderUri, terminals);
		}
		terminals.add(terminalId);
	}

	private _removeTerminalFromTracking(instance: ITerminalInstance): void {
		// Remove this terminal from all folder tracking
		for (const [, terminalIds] of this._addedFolders) {
			terminalIds.delete(instance.instanceId);
			// If no terminals use this folder anymore, it will be cleaned up on next focus
		}
	}
}

