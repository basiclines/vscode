/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Combined glob pattern for agents (uses brace expansion)
 */
const AGENT_PATTERN = '.{agents,github/agents}/*.{md,yml,yaml}';

/**
 * Tree item representing a file
 */
class FileItem extends vscode.TreeItem {
	constructor(public readonly uri: vscode.Uri) {
		const filename = path.basename(uri.fsPath);
		super(filename, vscode.TreeItemCollapsibleState.None);

		this.tooltip = uri.fsPath;
		this.command = {
			command: 'vscode.open',
			title: 'Open File',
			arguments: [uri]
		};

		// Icon based on file extension
		this.iconPath = new vscode.ThemeIcon(
			filename.endsWith('.md') ? 'markdown' : 'file-code'
		);
	}
}

/**
 * Tree data provider for Agents
 */
export class AgentsProvider implements vscode.TreeDataProvider<FileItem> {

	private _onDidChangeTreeData = new vscode.EventEmitter<FileItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: FileItem): vscode.TreeItem {
		return element;
	}

	async getChildren(): Promise<FileItem[]> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.commands.executeCommand('setContext', 'agentsSkills.agentsLoaded', true);
			return [];
		}

		// Single glob search with combined pattern
		const files = await vscode.workspace.findFiles(
			new vscode.RelativePattern(workspaceFolders[0], AGENT_PATTERN),
			null,
			100 // max results
		);

		const items = files.map(file => new FileItem(file));
		items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));

		// Set context key after loading completes
		vscode.commands.executeCommand('setContext', 'agentsSkills.agentsLoaded', true);

		return items;
	}
}
