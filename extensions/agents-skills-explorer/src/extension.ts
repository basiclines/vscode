/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AgentsProvider } from './agentsProvider';
import { SkillsProvider } from './skillsProvider';
import { SessionsProvider } from './sessionsProvider';

export function activate(context: vscode.ExtensionContext) {

	// Create providers
	const agentsProvider = new AgentsProvider();
	const skillsProvider = new SkillsProvider();
	const sessionsProvider = new SessionsProvider();

	// Register tree data providers
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('agentsExplorer', agentsProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('skillsExplorer', skillsProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('sessionsExplorer', sessionsProvider)
	);

	// Register refresh commands
	context.subscriptions.push(
		vscode.commands.registerCommand('agentsSkills.refreshAgents', () => {
			agentsProvider.refresh();
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('agentsSkills.refreshSkills', () => {
			skillsProvider.refresh();
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('agentsSkills.refreshSessions', () => {
			sessionsProvider.refresh();
		})
	);

	// Watch for file changes to auto-refresh
	const agentWatcher = vscode.workspace.createFileSystemWatcher('**/.agents/**');
	const githubAgentWatcher = vscode.workspace.createFileSystemWatcher('**/.github/agents/**');
	const skillWatcher = vscode.workspace.createFileSystemWatcher('**/.agents/skills/**');
	const githubSkillWatcher = vscode.workspace.createFileSystemWatcher('**/.github/skills/**');
	const githubInstructionsWatcher = vscode.workspace.createFileSystemWatcher('**/.github/instructions/**');

	// Refresh on file changes
	const refreshAgents = () => agentsProvider.refresh();
	const refreshSkills = () => skillsProvider.refresh();

	agentWatcher.onDidCreate(refreshAgents);
	agentWatcher.onDidDelete(refreshAgents);
	agentWatcher.onDidChange(refreshAgents);

	githubAgentWatcher.onDidCreate(refreshAgents);
	githubAgentWatcher.onDidDelete(refreshAgents);
	githubAgentWatcher.onDidChange(refreshAgents);

	skillWatcher.onDidCreate(refreshSkills);
	skillWatcher.onDidDelete(refreshSkills);
	skillWatcher.onDidChange(refreshSkills);

	githubSkillWatcher.onDidCreate(refreshSkills);
	githubSkillWatcher.onDidDelete(refreshSkills);
	githubSkillWatcher.onDidChange(refreshSkills);

	githubInstructionsWatcher.onDidCreate(refreshSkills);
	githubInstructionsWatcher.onDidDelete(refreshSkills);
	githubInstructionsWatcher.onDidChange(refreshSkills);

	context.subscriptions.push(agentWatcher, githubAgentWatcher, skillWatcher, githubSkillWatcher, githubInstructionsWatcher);

	// Refresh on workspace folder changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			agentsProvider.refresh();
			skillsProvider.refresh();
			sessionsProvider.refresh();
		})
	);
}

export function deactivate() {
	// Nothing to clean up
}
