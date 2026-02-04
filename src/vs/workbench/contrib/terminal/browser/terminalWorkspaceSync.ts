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

/** Debounce delay for workspace sync to prevent race conditions when switching terminals quickly */
const WORKSPACE_SYNC_DEBOUNCE_MS = 200;

/**
 * Syncs the workspace to a single folder matching the terminal's current working directory
 * when a terminal gains focus. This enables a terminal-first workflow where
 * the workspace follows the terminal's location (single folder mode).
 */
export class TerminalWorkspaceSyncContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'terminal.workspaceSync';

	private _syncDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	private _pendingInstance: ITerminalInstance | undefined;

	constructor(
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IWorkspaceEditingService private readonly _workspaceEditingService: IWorkspaceEditingService,
		@IExplorerService private readonly _explorerService: IExplorerService
	) {
		super();

		// Listen to terminal focus events with debouncing
		this._register(this._terminalService.onDidFocusInstance(instance => {
			this._debouncedSyncWorkspaceToTerminal(instance);
		}));

		// On startup, sync workspace to first terminal
		this._initializeWorkspaceFromTerminals();
	}

	private _debouncedSyncWorkspaceToTerminal(instance: ITerminalInstance): void {
		// Cancel any pending sync
		if (this._syncDebounceTimer) {
			clearTimeout(this._syncDebounceTimer);
		}

		// Store the instance to sync
		this._pendingInstance = instance;

		// Schedule the sync after debounce delay
		this._syncDebounceTimer = setTimeout(() => {
			if (this._pendingInstance) {
				this._syncWorkspaceToTerminal(this._pendingInstance);
				this._pendingInstance = undefined;
			}
		}, WORKSPACE_SYNC_DEBOUNCE_MS);
	}

	private async _initializeWorkspaceFromTerminals(): Promise<void> {
		// Wait a bit for terminals to be ready
		await new Promise(resolve => setTimeout(resolve, 1000));

		// Use the first terminal's cwd as the workspace
		const firstTerminal = this._terminalService.instances[0];
		if (firstTerminal?.cwd) {
			await this._setWorkspaceToFolder(URI.file(firstTerminal.cwd));
		}
	}

	private async _syncWorkspaceToTerminal(instance: ITerminalInstance): Promise<void> {
		const cwd = instance.cwd;
		if (!cwd) {
			return;
		}

		await this._setWorkspaceToFolder(URI.file(cwd));
	}

	private async _setWorkspaceToFolder(folderUri: URI): Promise<void> {
		const currentFolders = this._workspaceContextService.getWorkspace().folders;

		// Check if already at this single folder
		if (currentFolders.length === 1 && currentFolders[0].uri.toString() === folderUri.toString()) {
			// Just reveal in explorer
			try {
				await this._explorerService.select(folderUri, true);
			} catch {
				// Ignore errors
			}
			return;
		}

		// Use updateFolders to atomically replace all folders with the new one
		// This avoids extension host issues from removing all folders
		try {
			await this._workspaceEditingService.updateFolders(
				0, // start index
				currentFolders.length, // delete all existing folders
				[{ uri: folderUri }] // add the new folder
			);
			// Reveal in explorer
			await this._explorerService.select(folderUri, true);
		} catch {
			// Silently ignore errors
		}
	}

	override dispose(): void {
		if (this._syncDebounceTimer) {
			clearTimeout(this._syncDebounceTimer);
		}
		super.dispose();
	}
}

