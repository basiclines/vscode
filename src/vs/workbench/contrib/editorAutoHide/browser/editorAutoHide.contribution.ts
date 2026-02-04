/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { mainWindow } from '../../../../base/browser/window.js';

const MAX_EDITOR_WIDTH = 1200; // Max width in pixels for ~120 char line wrapping
const MAX_SIDEBAR_WIDTH_NO_EDITOR = 400; // Max sidebar width when no file is open

/**
 * Contribution that automatically hides the editor area and panel when no files are open,
 * giving full space to the terminal in the auxiliary bar.
 */
export class EditorAutoHideContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.editorAutoHide';
	private _isUpdating = false;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super();

		// Listen for changes in visible editors
		this._register(this.editorService.onDidVisibleEditorsChange(() => {
			this._updateLayout();
		}));

		// Also listen to editor close events
		this._register(this.editorService.onDidCloseEditor(() => {
			this._updateLayout();
		}));

		// Listen to part visibility changes to ensure editor stays visible when it should
		this._register(this.layoutService.onDidChangePartVisibility((e) => {
			// Only react to sidebar changes, not our own editor changes
			if (e.partId === Parts.SIDEBAR_PART) {
				this._updateLayout();
			}
		}));

		// Initial check after layout is ready
		setTimeout(() => this._updateLayout(), 100);
	}

	private _updateLayout(): void {
		// Prevent re-entrance
		if (this._isUpdating) {
			return;
		}
		this._isUpdating = true;

		try {
			const hasVisibleEditors = this.editorService.visibleEditors.length > 0;
			const windowWidth = mainWindow.innerWidth;

			// Always hide the panel since terminal is now in auxiliary bar
			this.layoutService.setPartHidden(true, Parts.PANEL_PART);

			if (hasVisibleEditors) {
				// Show editor area when files are opened
				this.layoutService.setPartHidden(false, Parts.EDITOR_PART);

				// Set editor width: 50% of window width, max 1200px
				const targetEditorWidth = Math.min(windowWidth * 0.5, MAX_EDITOR_WIDTH);
				const currentEditorSize = this.layoutService.getSize(Parts.EDITOR_PART);

				this.layoutService.setSize(Parts.EDITOR_PART, {
					width: targetEditorWidth,
					height: currentEditorSize.height
				});
			} else {
				// Hide editor area when no files are open
				this.layoutService.setPartHidden(true, Parts.EDITOR_PART);

				// Set sidebar to smaller width: 25% of window, max 400px
				const targetSidebarWidth = Math.min(windowWidth * 0.25, MAX_SIDEBAR_WIDTH_NO_EDITOR);
				const currentSidebarSize = this.layoutService.getSize(Parts.SIDEBAR_PART);

				this.layoutService.setSize(Parts.SIDEBAR_PART, {
					width: targetSidebarWidth,
					height: currentSidebarSize.height
				});
			}
		} finally {
			this._isUpdating = false;
		}
	}
}

registerWorkbenchContribution2(EditorAutoHideContribution.ID, EditorAutoHideContribution, WorkbenchPhase.AfterRestored);
