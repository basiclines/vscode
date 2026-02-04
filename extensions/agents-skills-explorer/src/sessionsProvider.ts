/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const SESSION_STATE_DIR = path.join(os.homedir(), '.copilot', 'session-state');

interface SessionInfo {
	id: string;
	cwd: string;
	summary: string;
	updatedAt: string;
	path: string;
}

type SessionTreeItem = SessionItem | FileItem;

/**
 * Tree item representing a session
 */
class SessionItem extends vscode.TreeItem {
	constructor(
		public readonly session: SessionInfo
	) {
		super(session.summary || session.id, vscode.TreeItemCollapsibleState.Expanded);
		this.tooltip = `${session.summary}\n${session.id}\nUpdated: ${session.updatedAt}`;
		this.iconPath = new vscode.ThemeIcon('history');
		this.contextValue = 'session';
	}
}

/**
 * Tree item representing a file
 */
class FileItem extends vscode.TreeItem {
	constructor(
		public readonly uri: vscode.Uri,
		public readonly sessionId: string,
		displayName?: string
	) {
		const filename = displayName || path.basename(uri.fsPath);
		super(filename, vscode.TreeItemCollapsibleState.None);

		this.tooltip = uri.fsPath;
		this.command = {
			command: 'vscode.open',
			title: 'Open File',
			arguments: [uri]
		};

		this.iconPath = new vscode.ThemeIcon(
			filename.endsWith('.md') ? 'markdown' : 'file'
		);
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Tree data provider for Sessions
 */
export class SessionsProvider implements vscode.TreeDataProvider<SessionTreeItem> {

	private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

	refresh(): void {
		// Debounce rapid refreshes
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
		}
		this._debounceTimer = setTimeout(() => {
			this._onDidChangeTreeData.fire();
		}, 150);
	}

	getTreeItem(element: SessionTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: SessionTreeItem): Promise<SessionTreeItem[]> {
		if (!element) {
			// Root level - return sessions
			return this._getSessions();
		}

		if (element instanceof SessionItem) {
			// Session level - return plan, files, checkpoints
			return this._getSessionFiles(element.session);
		}

		return [];
	}

	private async _getSessions(): Promise<SessionItem[]> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.commands.executeCommand('setContext', 'agentsSkills.sessionsLoaded', true);
			return [];
		}

		const currentCwd = workspaceFolders[0].uri.fsPath;

		try {
			if (!await fileExists(SESSION_STATE_DIR)) {
				vscode.commands.executeCommand('setContext', 'agentsSkills.sessionsLoaded', true);
				return [];
			}

			const entries = await fs.readdir(SESSION_STATE_DIR, { withFileTypes: true });
			const sessionDirs = entries.filter(d => d.isDirectory()).map(d => d.name);

			const sessions: SessionInfo[] = [];

			for (const sessionId of sessionDirs) {
				const sessionPath = path.join(SESSION_STATE_DIR, sessionId);
				const workspaceYaml = path.join(sessionPath, 'workspace.yaml');
				if (!await fileExists(workspaceYaml)) {
					continue;
				}

				try {
					const content = await fs.readFile(workspaceYaml, 'utf8');
					const cwd = this._parseYamlField(content, 'cwd');
					
					// Match sessions for current workspace
					if (cwd === currentCwd) {
						// Check if session has any files
						const hasFiles = await this._sessionHasFiles(sessionPath);
						if (!hasFiles) {
							continue;
						}

						sessions.push({
							id: sessionId,
							cwd: cwd,
							summary: this._parseYamlField(content, 'summary') || sessionId,
							updatedAt: this._parseYamlField(content, 'updated_at') || '',
							path: sessionPath
						});
					}
				} catch {
					// Skip invalid sessions
				}
			}

			// Sort by updated_at descending (most recent first)
			sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

			vscode.commands.executeCommand('setContext', 'agentsSkills.sessionsLoaded', true);

			return sessions.map(s => new SessionItem(s));
		} catch {
			vscode.commands.executeCommand('setContext', 'agentsSkills.sessionsLoaded', true);
			return [];
		}
	}

	private async _sessionHasFiles(sessionPath: string): Promise<boolean> {
		// Check plan.md
		if (await fileExists(path.join(sessionPath, 'plan.md'))) {
			return true;
		}

		// Check files/ directory has files
		const filesDir = path.join(sessionPath, 'files');
		if (await fileExists(filesDir)) {
			try {
				const entries = await fs.readdir(filesDir);
				if (entries.length > 0) {
					return true;
				}
			} catch {
				// Ignore
			}
		}

		// Check checkpoints/ directory has .md files
		const checkpointsDir = path.join(sessionPath, 'checkpoints');
		if (await fileExists(checkpointsDir)) {
			try {
				const entries = await fs.readdir(checkpointsDir);
				if (entries.some(f => f.endsWith('.md') && f !== 'index.md')) {
					return true;
				}
			} catch {
				// Ignore
			}
		}

		return false;
	}

	private async _getSessionFiles(session: SessionInfo): Promise<FileItem[]> {
		const items: FileItem[] = [];

		// 1. plan.md first
		const planPath = path.join(session.path, 'plan.md');
		if (await fileExists(planPath)) {
			items.push(new FileItem(vscode.Uri.file(planPath), session.id, 'plan.md'));
		}

		// 2. files/ directory
		const filesDir = path.join(session.path, 'files');
		if (await fileExists(filesDir)) {
			try {
				const entries = await fs.readdir(filesDir, { withFileTypes: true });
				const files = entries.filter(f => f.isFile()).map(f => f.name);

				for (const file of files) {
					items.push(new FileItem(
						vscode.Uri.file(path.join(filesDir, file)),
						session.id,
						file
					));
				}
			} catch {
				// Ignore errors
			}
		}

		// 3. checkpoints/ directory
		const checkpointsDir = path.join(session.path, 'checkpoints');
		if (await fileExists(checkpointsDir)) {
			try {
				const entries = await fs.readdir(checkpointsDir, { withFileTypes: true });
				const checkpoints = entries
					.filter(f => f.isFile() && f.name.endsWith('.md') && f.name !== 'index.md')
					.map(f => f.name)
					.sort(); // Sort by name (001-, 002-, etc.)

				for (const checkpoint of checkpoints) {
					// Extract description from filename (e.g., "001-description.md" -> "description")
					const match = checkpoint.match(/^\d+-(.+)\.md$/);
					const displayName = match ? match[1] : checkpoint;
					
					items.push(new FileItem(
						vscode.Uri.file(path.join(checkpointsDir, checkpoint)),
						session.id,
						displayName
					));
				}
			} catch {
				// Ignore errors
			}
		}

		return items;
	}

	private _parseYamlField(content: string, field: string): string {
		const regex = new RegExp(`^${field}:\\s*(.+)$`, 'm');
		const match = content.match(regex);
		return match ? match[1].trim() : '';
	}
}
