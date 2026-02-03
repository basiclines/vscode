/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ITerminalGroupService, ITerminalService } from '../../terminal/browser/terminal.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';

// Install GitHub CLI action
registerAction2(class InstallGitHubCLIAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.installGitHubCLI',
			title: localize2('installGitHubCLI', 'Install GitHub CLI (gh)'),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: undefined
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const terminalService = accessor.get(ITerminalService);
		const terminalGroupService = accessor.get(ITerminalGroupService);

		const installScript = `# Installing GitHub CLI (gh)
if command -v gh &> /dev/null; then
echo "✓ GitHub CLI is already installed"
gh --version
else
if command -v brew &> /dev/null; then
echo "Installing via Homebrew..."
brew install gh
else
echo "Error: Homebrew is not installed."
echo "Install Homebrew first: /bin/bash -c \"\\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
fi
fi`;

		const terminal = await terminalService.createTerminal({
			config: { name: 'Install GitHub CLI' }
		});
		await terminal.sendText(installScript, true);
		await terminalGroupService.showPanel(true);
	}
});

// Install Copilot CLI action
registerAction2(class InstallCopilotCLIAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.installCopilotCLI',
			title: localize2('installCopilotCLI', 'Install GitHub Copilot CLI'),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: undefined
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const terminalService = accessor.get(ITerminalService);
		const terminalGroupService = accessor.get(ITerminalGroupService);

		// Installation methods from https://github.com/github/copilot-cli
		const installScript = `# Installing GitHub Copilot CLI
if command -v copilot &> /dev/null; then
echo "✓ GitHub Copilot CLI is already installed"
copilot --version
else
if command -v brew &> /dev/null; then
echo "Installing via Homebrew..."
brew install copilot-cli
elif command -v npm &> /dev/null; then
echo "Installing via npm..."
npm install -g @github/copilot
else
echo "Installing via install script..."
curl -fsSL https://gh.io/copilot-install | bash
fi
fi`;

		const terminal = await terminalService.createTerminal({
			config: { name: 'Install Copilot CLI' }
		});
		await terminal.sendText(installScript, true);
		await terminalGroupService.showPanel(true);
	}
});

// Check CLI Tools Status action
registerAction2(class CheckCLIStatusAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.checkCLIStatus',
			title: localize2('checkCLIStatus', 'Check CLI Tools Status'),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: undefined
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const terminalService = accessor.get(ITerminalService);
		const terminalGroupService = accessor.get(ITerminalGroupService);

		const checkScript = 'which gh && which copilot';

		const terminal = await terminalService.createTerminal({
			config: { name: 'CLI Status' }
		});
		await terminal.sendText(checkScript, true);
		await terminalGroupService.showPanel(true);
	}
});
