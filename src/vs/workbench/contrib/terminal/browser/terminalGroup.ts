/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TERMINAL_VIEW_ID } from '../common/terminal.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IDisposable, Disposable, dispose, toDisposable } from '../../../../base/common/lifecycle.js';
import { Orientation } from '../../../../base/browser/ui/splitview/splitview.js';
import { Grid, IView as IGridView, Direction as GridDirection, Sizing as GridSizing } from '../../../../base/browser/ui/grid/grid.js';
import { isHorizontal, IWorkbenchLayoutService, Position } from '../../../services/layout/browser/layoutService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ITerminalInstance, Direction, ITerminalGroup, ITerminalInstanceService, ITerminalConfigurationService, SplitDirection } from './terminal.js';
import { ViewContainerLocation, IViewDescriptorService } from '../../../common/views.js';
import { IShellLaunchConfig, ITerminalTabLayoutInfoById, TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { TerminalStatus } from './terminalStatusList.js';
import { getWindow } from '../../../../base/browser/dom.js';
import { getPartByLocation } from '../../../services/views/browser/viewsService.js';
import { asArray } from '../../../../base/common/arrays.js';
import { hasKey, isNumber, type SingleOrMany } from '../../../../base/common/types.js';

const enum Constants {
	/**
	 * The minimum size in pixels of a split pane.
	 */
	SplitPaneMinSize = 80,
	/**
	 * The number of cells the terminal gets added or removed when asked to increase or decrease
	 * the view size.
	 */
	ResizePartCellCount = 4
}

/**
 * Converts a terminal SplitDirection to Grid Direction.
 */
function splitDirectionToGridDirection(splitDirection: SplitDirection): GridDirection {
	switch (splitDirection) {
		case SplitDirection.Right:
			return GridDirection.Right;
		case SplitDirection.Down:
			return GridDirection.Down;
	}
}

/**
 * A terminal pane that can be used within a Grid layout.
 * Implements IGridView to be compatible with the Grid component.
 */
class TerminalSplitPane implements IGridView {
	readonly element: HTMLElement;

	private _minimumWidth: number = Constants.SplitPaneMinSize;
	private _minimumHeight: number = Constants.SplitPaneMinSize;
	private _maximumWidth: number = Number.MAX_VALUE;
	private _maximumHeight: number = Number.MAX_VALUE;

	get minimumWidth(): number { return this._minimumWidth; }
	get minimumHeight(): number { return this._minimumHeight; }
	get maximumWidth(): number { return this._maximumWidth; }
	get maximumHeight(): number { return this._maximumHeight; }

	private readonly _onDidChange = new Emitter<{ width: number; height: number } | undefined>();
	readonly onDidChange: Event<{ width: number; height: number } | undefined> = this._onDidChange.event;

	constructor(readonly instance: ITerminalInstance) {
		this.element = document.createElement('div');
		this.element.className = 'terminal-split-pane';
		this.instance.attachToElement(this.element);
	}

	layout(width: number, height: number): void {
		if (!width || !height) {
			return;
		}
		this.instance.layout({ width, height });
	}

	dispose(): void {
		this._onDidChange.dispose();
	}
}

/**
 * A container that manages terminal instances in a grid layout,
 * allowing splits in both horizontal and vertical directions.
 */
class TerminalGridContainer extends Disposable {
	private _grid: Grid<TerminalSplitPane> | undefined;
	private _terminalToPane: Map<ITerminalInstance, TerminalSplitPane> = new Map();
	private _width: number = 0;
	private _height: number = 0;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		private readonly _container: HTMLElement,
		private _orientation: Orientation
	) {
		super();
		this._width = this._container.offsetWidth;
		this._height = this._container.offsetHeight;
	}

	get orientation(): Orientation {
		return this._orientation;
	}

	/**
	 * Adds a terminal instance to the grid.
	 * @param instance The terminal instance to add
	 * @param referenceInstance Optional reference instance to split from
	 * @param splitDirection The direction to split (defaults to panel-based orientation)
	 */
	split(instance: ITerminalInstance, referenceInstance?: ITerminalInstance, splitDirection?: SplitDirection): void {
		const pane = new TerminalSplitPane(instance);
		this._terminalToPane.set(instance, pane);

		if (!this._grid) {
			// First terminal - create the grid with this pane
			this._grid = new Grid(pane);
			this._container.appendChild(this._grid.element);
			this._register(this._grid);
		} else {
			// Find the reference pane to split from
			const referencePane = referenceInstance
				? this._terminalToPane.get(referenceInstance)
				: this._getLastPane();

			if (referencePane) {
				// Determine direction: use explicit direction or default based on orientation
				const direction = splitDirection
					? splitDirectionToGridDirection(splitDirection)
					: (this._orientation === Orientation.HORIZONTAL ? GridDirection.Right : GridDirection.Down);

				this._grid.addView(pane, GridSizing.Distribute, referencePane, direction);
			}
		}

		this._layout();
		this._onDidChange.fire();
	}

	/**
	 * Removes a terminal instance from the grid.
	 */
	remove(instance: ITerminalInstance): void {
		const pane = this._terminalToPane.get(instance);
		if (!pane || !this._grid) {
			return;
		}

		// Grid doesn't allow removing the last view, so we need to check
		if (this._terminalToPane.size > 1) {
			this._grid.removeView(pane, GridSizing.Distribute);
		}

		instance.detachFromElement();
		this._terminalToPane.delete(instance);
		pane.dispose();

		this._onDidChange.fire();
	}

	/**
	 * Gets the size of a terminal's pane.
	 */
	getPaneSize(instance: ITerminalInstance): number {
		const pane = this._terminalToPane.get(instance);
		if (!pane || !this._grid) {
			return 0;
		}
		const size = this._grid.getViewSize(pane);
		// Return the primary dimension based on current orientation
		return this._orientation === Orientation.HORIZONTAL ? size.width : size.height;
	}

	/**
	 * Resizes a pane in the given direction.
	 */
	resizePane(instance: ITerminalInstance, direction: Direction, amount: number): void {
		const pane = this._terminalToPane.get(instance);
		if (!pane || !this._grid) {
			return;
		}

		const currentSize = this._grid.getViewSize(pane);
		const isHorizontalResize = direction === Direction.Left || direction === Direction.Right;

		// Determine if we should grow or shrink
		const shouldShrink = direction === Direction.Left || direction === Direction.Up;
		const delta = shouldShrink ? -amount : amount;

		if (isHorizontalResize) {
			this._grid.resizeView(pane, {
				width: Math.max(Constants.SplitPaneMinSize, currentSize.width + delta),
				height: currentSize.height
			});
		} else {
			this._grid.resizeView(pane, {
				width: currentSize.width,
				height: Math.max(Constants.SplitPaneMinSize, currentSize.height + delta)
			});
		}
	}

	/**
	 * Resizes all panes to match the given relative sizes.
	 * Note: This is a simplified implementation for backward compatibility.
	 */
	resizePanes(relativeSizes: number[]): void {
		if (!this._grid || this._terminalToPane.size <= 1) {
			return;
		}

		// Get total available size
		const totalSize = this._orientation === Orientation.HORIZONTAL ? this._width : this._height;

		// Apply sizes to panes in order
		const panes = Array.from(this._terminalToPane.values());
		for (let i = 0; i < panes.length && i < relativeSizes.length; i++) {
			const pane = panes[i];
			const size = totalSize * relativeSizes[i];
			const currentSize = this._grid.getViewSize(pane);

			if (this._orientation === Orientation.HORIZONTAL) {
				this._grid.resizeView(pane, { width: size, height: currentSize.height });
			} else {
				this._grid.resizeView(pane, { width: currentSize.width, height: size });
			}
		}
	}

	/**
	 * Updates the layout dimensions.
	 */
	layout(width: number, height: number): void {
		this._width = width;
		this._height = height;
		this._layout();
	}

	private _layout(): void {
		if (this._grid && this._width && this._height) {
			this._grid.layout(this._width, this._height);
		}
	}

	/**
	 * Changes the default orientation for new splits.
	 * Note: This doesn't re-layout existing terminals, just affects new splits.
	 */
	setOrientation(orientation: Orientation): void {
		this._orientation = orientation;
		// The grid maintains its structure - we just change the default for new splits
	}

	private _getLastPane(): TerminalSplitPane | undefined {
		const panes = Array.from(this._terminalToPane.values());
		return panes.length > 0 ? panes[panes.length - 1] : undefined;
	}

	/**
	 * Gets a pane by terminal instance.
	 */
	getPane(instance: ITerminalInstance): TerminalSplitPane | undefined {
		return this._terminalToPane.get(instance);
	}

	/**
	 * Distributes all pane sizes evenly.
	 */
	equalizePanes(): void {
		if (this._grid) {
			this._grid.distributeViewSizes();
		}
	}
}

// Keep the old SplitPaneContainer for reference during migration
class SplitPaneContainer extends Disposable {
	private readonly _gridContainer: TerminalGridContainer;
	private _children: ITerminalInstance[] = [];

	private _onDidChange: Event<number | undefined> = Event.None;
	get onDidChange(): Event<number | undefined> { return this._onDidChange; }

	get orientation(): Orientation {
		return this._gridContainer.orientation;
	}

	constructor(
		_container: HTMLElement,
		orientation: Orientation,
	) {
		super();
		this._gridContainer = this._register(new TerminalGridContainer(_container, orientation));
	}

	split(instance: ITerminalInstance, index: number, splitDirection?: SplitDirection): void {
		// Find the reference instance (the one before the new index)
		const referenceInstance = index > 0 && this._children.length > 0
			? this._children[Math.min(index - 1, this._children.length - 1)]
			: undefined;

		this._gridContainer.split(instance, referenceInstance, splitDirection);

		// Track in children array at the right position
		if (index >= this._children.length) {
			this._children.push(instance);
		} else {
			this._children.splice(index, 0, instance);
		}
	}

	resizePane(index: number, direction: Direction, amount: number): void {
		const instance = this._children[index];
		if (instance) {
			this._gridContainer.resizePane(instance, direction, amount);
		}
	}

	resizePanes(relativeSizes: number[]): void {
		this._gridContainer.resizePanes(relativeSizes);
	}

	getPaneSize(instance: ITerminalInstance): number {
		return this._gridContainer.getPaneSize(instance);
	}

	remove(instance: ITerminalInstance): void {
		const index = this._children.indexOf(instance);
		if (index !== -1) {
			this._children.splice(index, 1);
		}
		this._gridContainer.remove(instance);
	}

	layout(width: number, height: number): void {
		this._gridContainer.layout(width, height);
	}

	setOrientation(orientation: Orientation): void {
		this._gridContainer.setOrientation(orientation);
	}

	equalizePanes(): void {
		this._gridContainer.equalizePanes();
	}
}

export class TerminalGroup extends Disposable implements ITerminalGroup {
	private _terminalInstances: ITerminalInstance[] = [];
	private _splitPaneContainer: SplitPaneContainer | undefined;
	private _groupElement: HTMLElement | undefined;
	private _panelPosition: Position = Position.BOTTOM;
	private _terminalLocation: ViewContainerLocation = ViewContainerLocation.Panel;
	private _instanceDisposables: Map<number, IDisposable[]> = new Map();

	private _activeInstanceIndex: number = -1;

	get terminalInstances(): ITerminalInstance[] { return this._terminalInstances; }

	private _hadFocusOnExit: boolean = false;
	get hadFocusOnExit(): boolean { return this._hadFocusOnExit; }

	private _initialRelativeSizes: number[] | undefined;
	private _visible: boolean = false;

	private readonly _onDidDisposeInstance: Emitter<ITerminalInstance> = this._register(new Emitter<ITerminalInstance>());
	readonly onDidDisposeInstance = this._onDidDisposeInstance.event;
	private readonly _onDidFocusInstance: Emitter<ITerminalInstance> = this._register(new Emitter<ITerminalInstance>());
	readonly onDidFocusInstance = this._onDidFocusInstance.event;
	private readonly _onDidChangeInstanceCapability: Emitter<ITerminalInstance> = this._register(new Emitter<ITerminalInstance>());
	readonly onDidChangeInstanceCapability = this._onDidChangeInstanceCapability.event;
	private readonly _onDisposed: Emitter<ITerminalGroup> = this._register(new Emitter<ITerminalGroup>());
	readonly onDisposed = this._onDisposed.event;
	private readonly _onInstancesChanged: Emitter<void> = this._register(new Emitter<void>());
	readonly onInstancesChanged = this._onInstancesChanged.event;
	private readonly _onDidChangeActiveInstance = this._register(new Emitter<ITerminalInstance | undefined>());
	readonly onDidChangeActiveInstance = this._onDidChangeActiveInstance.event;
	private readonly _onPanelOrientationChanged = this._register(new Emitter<Orientation>());
	readonly onPanelOrientationChanged = this._onPanelOrientationChanged.event;

	constructor(
		private _container: HTMLElement | undefined,
		shellLaunchConfigOrInstance: IShellLaunchConfig | ITerminalInstance | undefined,
		@ITerminalConfigurationService private readonly _terminalConfigurationService: ITerminalConfigurationService,
		@ITerminalInstanceService private readonly _terminalInstanceService: ITerminalInstanceService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();
		if (shellLaunchConfigOrInstance) {
			this.addInstance(shellLaunchConfigOrInstance);
		}
		if (this._container) {
			this.attachToElement(this._container);
		}
		this._onPanelOrientationChanged.fire(this._terminalLocation === ViewContainerLocation.Panel && isHorizontal(this._panelPosition) ? Orientation.HORIZONTAL : Orientation.VERTICAL);
		this._register(toDisposable(() => {
			if (this._container && this._groupElement) {
				this._groupElement.remove();
				this._groupElement = undefined;
			}
		}));
	}

	addInstance(shellLaunchConfigOrInstance: IShellLaunchConfig | ITerminalInstance, parentTerminalId?: number, splitDirection?: SplitDirection): void {
		let instance: ITerminalInstance;
		// if a parent terminal is provided, find it
		// otherwise, parent is the active terminal
		const parentIndex = parentTerminalId ? this._terminalInstances.findIndex(t => t.instanceId === parentTerminalId) : this._activeInstanceIndex;
		if (hasKey(shellLaunchConfigOrInstance, { instanceId: true })) {
			instance = shellLaunchConfigOrInstance;
		} else {
			instance = this._terminalInstanceService.createInstance(shellLaunchConfigOrInstance, TerminalLocation.Panel);
		}
		if (this._terminalInstances.length === 0) {
			this._terminalInstances.push(instance);
			this._activeInstanceIndex = 0;
		} else {
			this._terminalInstances.splice(parentIndex + 1, 0, instance);
		}
		this._initInstanceListeners(instance);

		if (this._splitPaneContainer) {
			this._splitPaneContainer.split(instance, parentIndex + 1, splitDirection);
		}

		this._onInstancesChanged.fire();
	}

	override dispose(): void {
		this._terminalInstances = [];
		this._onInstancesChanged.fire();
		this._splitPaneContainer?.dispose();
		super.dispose();
	}

	get activeInstance(): ITerminalInstance | undefined {
		if (this._terminalInstances.length === 0) {
			return undefined;
		}
		return this._terminalInstances[this._activeInstanceIndex];
	}

	getLayoutInfo(isActive: boolean): ITerminalTabLayoutInfoById {
		const instances = this.terminalInstances.filter(instance => isNumber(instance.persistentProcessId) && instance.shouldPersist);
		const totalSize = instances.map(t => this._splitPaneContainer?.getPaneSize(t) || 0).reduce((total, size) => total += size, 0);
		return {
			isActive: isActive,
			activePersistentProcessId: this.activeInstance ? this.activeInstance.persistentProcessId : undefined,
			terminals: instances.map(t => {
				return {
					relativeSize: totalSize > 0 ? this._splitPaneContainer!.getPaneSize(t) / totalSize : 0,
					terminal: t.persistentProcessId || 0
				};
			})
		};
	}

	private _initInstanceListeners(instance: ITerminalInstance) {
		this._instanceDisposables.set(instance.instanceId, [
			instance.onDisposed(instance => {
				this._onDidDisposeInstance.fire(instance);
				this._handleOnDidDisposeInstance(instance);
			}),
			instance.onDidFocus(instance => {
				this._setActiveInstance(instance);
				this._onDidFocusInstance.fire(instance);
			}),
			instance.capabilities.onDidChangeCapabilities(() => this._onDidChangeInstanceCapability.fire(instance)),
		]);
	}

	private _handleOnDidDisposeInstance(instance: ITerminalInstance) {
		this._removeInstance(instance);
	}

	removeInstance(instance: ITerminalInstance) {
		this._removeInstance(instance);
	}

	private _removeInstance(instance: ITerminalInstance) {
		const index = this._terminalInstances.indexOf(instance);
		if (index === -1) {
			return;
		}

		const wasActiveInstance = instance === this.activeInstance;
		this._terminalInstances.splice(index, 1);

		// Adjust focus if the instance was active
		if (wasActiveInstance && this._terminalInstances.length > 0) {
			const newIndex = index < this._terminalInstances.length ? index : this._terminalInstances.length - 1;
			this.setActiveInstanceByIndex(newIndex);
			// TODO: Only focus the new instance if the group had focus?
			this.activeInstance?.focus(true);
		} else if (index < this._activeInstanceIndex) {
			// Adjust active instance index if needed
			this._activeInstanceIndex--;
		}

		this._splitPaneContainer?.remove(instance);

		// Fire events and dispose group if it was the last instance
		if (this._terminalInstances.length === 0) {
			this._hadFocusOnExit = instance.hadFocusOnExit;
			this._onDisposed.fire(this);
			this.dispose();
		} else {
			this._onInstancesChanged.fire();
		}

		// Dispose instance event listeners
		const disposables = this._instanceDisposables.get(instance.instanceId);
		if (disposables) {
			dispose(disposables);
			this._instanceDisposables.delete(instance.instanceId);
		}
	}

	moveInstance(instances: SingleOrMany<ITerminalInstance>, index: number, position: 'before' | 'after'): void {
		instances = asArray(instances);
		const hasInvalidInstance = instances.some(instance => !this.terminalInstances.includes(instance));
		if (hasInvalidInstance) {
			return;
		}
		const insertIndex = position === 'before' ? index : index + 1;
		this._terminalInstances.splice(insertIndex, 0, ...instances);
		for (const item of instances) {
			const originSourceGroupIndex = position === 'after' ? this._terminalInstances.indexOf(item) : this._terminalInstances.lastIndexOf(item);
			this._terminalInstances.splice(originSourceGroupIndex, 1);
		}
		if (this._splitPaneContainer) {
			for (let i = 0; i < instances.length; i++) {
				const item = instances[i];
				this._splitPaneContainer.remove(item);
				this._splitPaneContainer.split(item, index + (position === 'before' ? i : 0));
			}
		}
		this._onInstancesChanged.fire();
	}

	private _setActiveInstance(instance: ITerminalInstance) {
		this.setActiveInstanceByIndex(this._getIndexFromId(instance.instanceId));
	}

	private _getIndexFromId(terminalId: number): number {
		let terminalIndex = -1;
		this.terminalInstances.forEach((terminalInstance, i) => {
			if (terminalInstance.instanceId === terminalId) {
				terminalIndex = i;
			}
		});
		if (terminalIndex === -1) {
			throw new Error(`Terminal with ID ${terminalId} does not exist (has it already been disposed?)`);
		}
		return terminalIndex;
	}

	setActiveInstanceByIndex(index: number, force?: boolean): void {
		// Check for invalid value
		if (index < 0 || index >= this._terminalInstances.length) {
			return;
		}

		const oldActiveInstance = this.activeInstance;
		this._activeInstanceIndex = index;
		if (oldActiveInstance !== this.activeInstance || force) {
			this._onInstancesChanged.fire();
			this._onDidChangeActiveInstance.fire(this.activeInstance);
		}
	}

	attachToElement(element: HTMLElement): void {
		this._container = element;

		// If we already have a group element, we can reparent it
		if (!this._groupElement) {
			this._groupElement = document.createElement('div');
			this._groupElement.classList.add('terminal-group');
		}

		this._container.appendChild(this._groupElement);
		if (!this._splitPaneContainer) {
			this._panelPosition = this._layoutService.getPanelPosition();
			this._terminalLocation = this._viewDescriptorService.getViewLocationById(TERMINAL_VIEW_ID)!;
			const orientation = this._terminalLocation === ViewContainerLocation.Panel && isHorizontal(this._panelPosition) ? Orientation.HORIZONTAL : Orientation.VERTICAL;
			this._splitPaneContainer = this._instantiationService.createInstance(SplitPaneContainer, this._groupElement, orientation);
			this.terminalInstances.forEach(instance => this._splitPaneContainer!.split(instance, this._activeInstanceIndex + 1));
		}
	}

	get title(): string {
		if (this._terminalInstances.length === 0) {
			// Normally consumers should not call into title at all after the group is disposed but
			// this is required when the group is used as part of a tree.
			return '';
		}
		let title = this.terminalInstances[0].title + this._getBellTitle(this.terminalInstances[0]);
		if (this.terminalInstances[0].description) {
			title += ` (${this.terminalInstances[0].description})`;
		}
		for (let i = 1; i < this.terminalInstances.length; i++) {
			const instance = this.terminalInstances[i];
			if (instance.title) {
				title += `, ${instance.title + this._getBellTitle(instance)}`;
				if (instance.description) {
					title += ` (${instance.description})`;
				}
			}
		}
		return title;
	}

	private _getBellTitle(instance: ITerminalInstance) {
		if (this._terminalConfigurationService.config.enableBell && instance.statusList.statuses.some(e => e.id === TerminalStatus.Bell)) {
			return '*';
		}
		return '';
	}

	setVisible(visible: boolean): void {
		this._visible = visible;
		if (this._groupElement) {
			this._groupElement.style.display = visible ? '' : 'none';
		}
		this.terminalInstances.forEach(i => i.setVisible(visible));
	}

	split(shellLaunchConfig: IShellLaunchConfig, splitDirection?: SplitDirection): ITerminalInstance {
		const instance = this._terminalInstanceService.createInstance(shellLaunchConfig, TerminalLocation.Panel);
		this.addInstance(instance, shellLaunchConfig.parentTerminalId, splitDirection);
		this._setActiveInstance(instance);
		return instance;
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}

	layout(width: number, height: number): void {
		if (this._splitPaneContainer) {
			// Check if the panel position changed and rotate panes if so
			const newPanelPosition = this._layoutService.getPanelPosition();
			const newTerminalLocation = this._viewDescriptorService.getViewLocationById(TERMINAL_VIEW_ID)!;
			const terminalPositionChanged = newPanelPosition !== this._panelPosition || newTerminalLocation !== this._terminalLocation;
			if (terminalPositionChanged) {
				const newOrientation = newTerminalLocation === ViewContainerLocation.Panel && isHorizontal(newPanelPosition) ? Orientation.HORIZONTAL : Orientation.VERTICAL;
				this._splitPaneContainer.setOrientation(newOrientation);
				this._panelPosition = newPanelPosition;
				this._terminalLocation = newTerminalLocation;
				this._onPanelOrientationChanged.fire(this._splitPaneContainer.orientation);
			}
			this._splitPaneContainer.layout(width, height);
			if (this._initialRelativeSizes && this._visible) {
				this.resizePanes(this._initialRelativeSizes);
				this._initialRelativeSizes = undefined;
			}
		}
	}

	focusPreviousPane(): void {
		const newIndex = this._activeInstanceIndex === 0 ? this._terminalInstances.length - 1 : this._activeInstanceIndex - 1;
		this.setActiveInstanceByIndex(newIndex);
	}

	focusNextPane(): void {
		const newIndex = this._activeInstanceIndex === this._terminalInstances.length - 1 ? 0 : this._activeInstanceIndex + 1;
		this.setActiveInstanceByIndex(newIndex);
	}

	private _getPosition(): Position {
		switch (this._terminalLocation) {
			case ViewContainerLocation.Panel:
				return this._panelPosition;
			case ViewContainerLocation.Sidebar:
				return this._layoutService.getSideBarPosition();
			case ViewContainerLocation.AuxiliaryBar:
				return this._layoutService.getSideBarPosition() === Position.LEFT ? Position.RIGHT : Position.LEFT;
		}
	}

	private _getOrientation(): Orientation {
		return isHorizontal(this._getPosition()) ? Orientation.HORIZONTAL : Orientation.VERTICAL;
	}

	resizePane(direction: Direction): void {
		if (!this._splitPaneContainer) {
			return;
		}

		const isHorizontalResize = (direction === Direction.Left || direction === Direction.Right);

		const groupOrientation = this._getOrientation();

		const shouldResizePart =
			(isHorizontalResize && groupOrientation === Orientation.VERTICAL) ||
			(!isHorizontalResize && groupOrientation === Orientation.HORIZONTAL);

		const font = this._terminalConfigurationService.getFont(getWindow(this._groupElement));
		// TODO: Support letter spacing and line height
		const charSize = (isHorizontalResize ? font.charWidth : font.charHeight);

		if (charSize) {
			let resizeAmount = charSize * Constants.ResizePartCellCount;

			if (shouldResizePart) {

				const position = this._getPosition();
				const shouldShrink =
					(position === Position.LEFT && direction === Direction.Left) ||
					(position === Position.RIGHT && direction === Direction.Right) ||
					(position === Position.BOTTOM && direction === Direction.Down) ||
					(position === Position.TOP && direction === Direction.Up);

				if (shouldShrink) {
					resizeAmount *= -1;
				}

				this._layoutService.resizePart(getPartByLocation(this._terminalLocation), resizeAmount, resizeAmount);
			} else {
				this._splitPaneContainer.resizePane(this._activeInstanceIndex, direction, resizeAmount);
			}

		}
	}

	resizePanes(relativeSizes: number[]): void {
		if (!this._splitPaneContainer) {
			this._initialRelativeSizes = relativeSizes;
			return;
		}

		this._splitPaneContainer.resizePanes(relativeSizes);
	}

	equalizePanes(): void {
		this._splitPaneContainer?.equalizePanes();
	}
}
