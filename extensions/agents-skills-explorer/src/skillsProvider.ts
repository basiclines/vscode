/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Combined glob patterns for skills (run in parallel)
 */
const SKILL_PATTERNS = [
	'.{agents/skills,github/skills}/*/SKILL.{md,yml,yaml}',
	'.github/instructions/*.{md,yml,yaml}'
];

/**
 * Tree item representing a file
 */
class FileItem extends vscode.TreeItem {
	constructor(public readonly uri: vscode.Uri) {
		const filename = path.basename(uri.fsPath);
		const parentDir = path.basename(path.dirname(uri.fsPath));
		
		// For SKILL.md files, show the parent folder name (skill name)
		const displayName = filename.toUpperCase().startsWith('SKILL.')
			? parentDir
			: filename;
		
		super(displayName, vscode.TreeItemCollapsibleState.None);

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
 * Tree data provider for Skills
 */
export class SkillsProvider implements vscode.TreeDataProvider<FileItem> {

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
			vscode.commands.executeCommand('setContext', 'agentsSkills.skillsLoaded', true);
			return [];
		}

		const folder = workspaceFolders[0];

		// Run searches in parallel
		const searchPromises = SKILL_PATTERNS.map(pattern =>
			vscode.workspace.findFiles(
				new vscode.RelativePattern(folder, pattern),
				null,
				100
			)
		);

		const results = await Promise.all(searchPromises);
		const files = results.flat();

		const items = files.map(file => new FileItem(file));
		items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));

		// Set context key after loading completes
		vscode.commands.executeCommand('setContext', 'agentsSkills.skillsLoaded', true);

		return items;
	}
}
