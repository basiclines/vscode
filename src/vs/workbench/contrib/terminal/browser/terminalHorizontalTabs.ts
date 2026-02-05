/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, dispose } from '../../../../base/common/lifecycle.js';
import { ITerminalGroupService, ITerminalGroup, ITerminalInstance, ITerminalEditingService } from './terminal.js';
import * as dom from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { getIconId, getColorClass } from './terminalIcon.js';
import { Action } from '../../../../base/common/actions.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IContextMenuService, IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IMenu, IMenuService, MenuId } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { openContextMenu } from './terminalContextMenu.js';
import { localize } from '../../../../nls.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { createSingleCallFunction } from '../../../../base/common/functional.js';

const $ = dom.$;

interface ITabEntry {
	group: ITerminalGroup;
	element: HTMLElement;
	labelElement: HTMLElement;
	disposables: DisposableStore;
}

export class TerminalHorizontalTabs extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _tabsContainer: HTMLElement;
	private readonly _scrollable: DomScrollableElement;
	private readonly _tabs: ITabEntry[] = [];
	private readonly _tabsListMenu: IMenu;

	private readonly _onDidRequestClose = this._register(new Emitter<ITerminalGroup>());
	readonly onDidRequestClose: Event<ITerminalGroup> = this._onDidRequestClose.event;

	get element(): HTMLElement { return this._container; }

	constructor(
		@ITerminalGroupService private readonly _terminalGroupService: ITerminalGroupService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@ITerminalEditingService private readonly _terminalEditingService: ITerminalEditingService,
	) {
		super();

		// Create container structure
		this._container = $('.terminal-horizontal-tabs-container');
		this._tabsContainer = $('.terminal-horizontal-tabs');

		// Create scrollable wrapper
		this._scrollable = this._register(new DomScrollableElement(this._tabsContainer, {
			horizontal: ScrollbarVisibility.Auto,
			vertical: ScrollbarVisibility.Hidden,
			useShadows: false,
		}));
		this._container.appendChild(this._scrollable.getDomNode());

		// Create context menu
		this._tabsListMenu = this._register(menuService.createMenu(MenuId.TerminalTabContext, contextKeyService));

		// Subscribe to group changes
		this._register(this._terminalGroupService.onDidChangeGroups(() => this._render()));
		this._register(this._terminalGroupService.onDidChangeActiveGroup(() => this._updateActiveTab()));
		this._register(this._terminalGroupService.onDidChangeInstances(() => this._render()));

		// Poll for editing state changes (for right-click > Rename)
		let lastEditingInstanceId: number | undefined;
		const checkEditingState = () => {
			const editingInstance = this._terminalEditingService.getEditingTerminal();
			const currentId = editingInstance?.instanceId;
			if (currentId !== lastEditingInstanceId && editingInstance) {
				lastEditingInstanceId = currentId;
				// Find the tab entry for this instance
				for (const tab of this._tabs) {
					const firstInstance = tab.group.terminalInstances[0];
					if (firstInstance?.instanceId === editingInstance.instanceId) {
						this._showRenameInputBox(tab.labelElement, editingInstance, tab.disposables);
						break;
					}
				}
			} else if (!editingInstance) {
				lastEditingInstanceId = undefined;
			}
		};
		const targetWindow = dom.getWindow(this._container);
		const intervalId = targetWindow.setInterval(checkEditingState, 100);
		this._register({ dispose: () => targetWindow.clearInterval(intervalId) });

		// Initial render
		this._render();
	}

	private _render(): void {
		// Clear existing tabs
		this._clearTabs();

		// Create a tab for each group
		const groups = this._terminalGroupService.groups;
		for (let i = 0; i < groups.length; i++) {
			const group = groups[i];
			this._createTab(group, i);
		}

		// Update active state
		this._updateActiveTab();

		// Update scrollbar
		this._scrollable.scanDomNode();
	}

	private _createTab(group: ITerminalGroup, index: number): void {
		const disposables = new DisposableStore();
		const tabElement = $('.terminal-tab');
		tabElement.draggable = true;
		tabElement.setAttribute('role', 'tab');
		tabElement.setAttribute('data-index', String(index));

		// Get first instance for icon/label
		const firstInstance = group.terminalInstances[0];
		if (!firstInstance) {
			return;
		}

		// Icon
		const iconElement = $('.terminal-tab-icon');
		const iconId = this._instantiationService.invokeFunction(getIconId, firstInstance);
		const colorClass = getColorClass(firstInstance);
		if (iconId) {
			iconElement.classList.add(...ThemeIcon.asClassNameArray({ id: iconId }));
		} else {
			iconElement.classList.add(...ThemeIcon.asClassNameArray(Codicon.terminal));
		}
		if (colorClass) {
			iconElement.classList.add(colorClass);
		}
		tabElement.appendChild(iconElement);

		// Label
		const labelElement = $('.terminal-tab-label');
		labelElement.textContent = this._getGroupLabel(group);
		tabElement.appendChild(labelElement);

		// Split count (if more than one terminal in group)
		if (group.terminalInstances.length > 1) {
			const countElement = $('.terminal-tab-count');
			countElement.textContent = `(${group.terminalInstances.length})`;
			tabElement.appendChild(countElement);
		}

		// Subscribe to title changes
		for (const instance of group.terminalInstances) {
			disposables.add(instance.onTitleChanged(() => {
				labelElement.textContent = this._getGroupLabel(group);
			}));
		}

		// Close button
		const closeContainer = $('.terminal-tab-close');
		const closeAction = new Action('terminal.closeTab', '', ThemeIcon.asClassName(Codicon.close), true, async () => {
			this._closeGroup(group);
		});
		const actionBar = disposables.add(new ActionBar(closeContainer, {}));
		actionBar.push(closeAction, { icon: true, label: false });
		tabElement.appendChild(closeContainer);

		// Click handler - switch to this group
		disposables.add(dom.addDisposableListener(tabElement, dom.EventType.CLICK, (e: MouseEvent) => {
			if (e.target !== closeContainer && !closeContainer.contains(e.target as Node)) {
				e.preventDefault();
				this._terminalGroupService.setActiveGroupByIndex(index);
			}
		}));

		// Double-click to rename (on the whole tab, except close button)
		disposables.add(dom.addDisposableListener(tabElement, dom.EventType.DBLCLICK, (e: MouseEvent) => {
			if (e.target === closeContainer || closeContainer.contains(e.target as Node)) {
				return;
			}
			if (!firstInstance) {
				return;
			}

			e.preventDefault();
			e.stopPropagation();

			// Show inline input box for renaming
			this._showRenameInputBox(labelElement, firstInstance, disposables);
		}));

		// Context menu
		disposables.add(dom.addDisposableListener(tabElement, dom.EventType.CONTEXT_MENU, (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();

			// Set this instance as active for context menu
			if (firstInstance) {
				this._terminalGroupService.setActiveInstance(firstInstance);
			}

			openContextMenu(dom.getWindow(tabElement), e, firstInstance, this._tabsListMenu, this._contextMenuService);
		}));

		// Middle click to close
		disposables.add(dom.addDisposableListener(tabElement, dom.EventType.AUXCLICK, (e: MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
				e.stopPropagation();
				this._closeGroup(group);
			}
		}));

		this._tabsContainer.appendChild(tabElement);
		this._tabs.push({ group, element: tabElement, labelElement, disposables });
	}

	private _getGroupLabel(group: ITerminalGroup): string {
		const firstInstance = group.terminalInstances[0];
		if (!firstInstance) {
			return 'Terminal';
		}
		return firstInstance.title || 'Terminal';
	}

	private _closeGroup(group: ITerminalGroup): void {
		// Close all instances in the group
		for (const instance of [...group.terminalInstances]) {
			instance.dispose();
		}
	}

	private _updateActiveTab(): void {
		const activeGroupIndex = this._terminalGroupService.activeGroupIndex;
		for (let i = 0; i < this._tabs.length; i++) {
			const tab = this._tabs[i];
			tab.element.classList.toggle('active', i === activeGroupIndex);
			tab.element.setAttribute('aria-selected', String(i === activeGroupIndex));
		}
	}

	private _clearTabs(): void {
		for (const tab of this._tabs) {
			tab.disposables.dispose();
			tab.element.remove();
		}
		this._tabs.length = 0;
	}

	layout(width: number): void {
		this._scrollable.scanDomNode();
	}

	refresh(): void {
		this._render();
	}

	private _showRenameInputBox(labelElement: HTMLElement, instance: ITerminalInstance, tabDisposables: DisposableStore): void {
		const value = instance.title || '';

		// Get label width before hiding to maintain tab size
		const labelWidth = labelElement.offsetWidth;

		// Hide the label
		labelElement.style.display = 'none';

		// Create input box container with same width as label
		const inputContainer = dom.$('.terminal-tab-rename-input');
		inputContainer.style.width = `${Math.max(labelWidth, 50)}px`; // minimum 50px
		labelElement.parentElement?.insertBefore(inputContainer, labelElement.nextSibling);

		const inputBox = new InputBox(inputContainer, this._contextViewService, {
			validationOptions: {
				validation: (inputValue) => {
					if (!inputValue || inputValue.trim().length === 0) {
						return null; // Empty is allowed, resets to default
					}
					return null;
				}
			},
			ariaLabel: localize('terminalInputAriaLabel', "Type terminal name. Press Enter to confirm or Escape to cancel."),
			inputBoxStyles: defaultInputBoxStyles
		});
		inputBox.element.style.height = '22px';
		inputBox.element.style.width = '100%';
		inputBox.value = value;
		inputBox.focus();
		inputBox.select({ start: 0, end: value.length });

		const done = createSingleCallFunction(async (success: boolean) => {
			const newValue = inputBox.value;
			inputBox.dispose();
			inputContainer.remove();
			labelElement.style.display = '';
			if (success && newValue !== value) {
				await instance.rename(newValue);
			}
		});

		const toDispose = [
			inputBox,
			dom.addDisposableListener(inputBox.inputElement, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					e.stopPropagation();
					done(true);
				} else if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					done(false);
				}
			}),
			dom.addDisposableListener(inputBox.inputElement, dom.EventType.BLUR, () => {
				done(true);
			})
		];

		tabDisposables.add({ dispose: () => dispose(toDispose) });
	}

	override dispose(): void {
		this._clearTabs();
		super.dispose();
	}
}
