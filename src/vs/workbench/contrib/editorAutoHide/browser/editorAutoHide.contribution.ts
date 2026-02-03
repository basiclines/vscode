/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';

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

			// Always hide the panel since terminal is now in auxiliary bar
			this.layoutService.setPartHidden(true, Parts.PANEL_PART);

			if (hasVisibleEditors) {
				// Show editor area when files are opened
				this.layoutService.setPartHidden(false, Parts.EDITOR_PART);
			} else {
				// Hide editor area when no files are open
				this.layoutService.setPartHidden(true, Parts.EDITOR_PART);
			}
		} finally {
			this._isUpdating = false;
		}
	}
}

registerWorkbenchContribution2(EditorAutoHideContribution.ID, EditorAutoHideContribution, WorkbenchPhase.AfterRestored);
