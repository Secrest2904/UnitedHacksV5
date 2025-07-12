// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// RIGHTGOODY CODE START-
	context.subscriptions.push(
		vscode.commands.registerCommand(`editor.action.clipboardPasteAction`, async() => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) return;

			const clipboardContent = await vscode.env.clipboard.readText();

			await editor.edit(editBuilder => {
				editBuilder.replace(editor.selection, clipboardContent);
			});

			//index pasted code-
			indexPastedCode(clipboardContent);
		})
	);

	let writtenCode: string[] = [];
	let pastedCode: String[] = [];

	function indexPastedCode(content: string) {
		pastedCode.push(content)
	}

	vscode.workspace.onDidChangeTextDocument(event => {
		if (event.contentChanges.length) {
			event.contentChanges.forEach(change => {
				if (change.text && change.text.length < 1000) {
					writtenCode.push(change.text);
				}
			});
		}
	});

	function calculateRatio(): number {
		const writtenLength = writtenCode.join('').length;
		const pastedLength = pastedCode.join('').length;

		if (writtenLength + pastedLength === 0) return 0; //avoids division by 0 -> throws error

		return writtenLength / (writtenLength + pastedLength);
	}

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

	function updateStatusBar() {
		const ratio = calculateRatio();
		const percentage = (ratio * 100).toFixed(1);
		statusBar.text = `✍️ Hand-Written code: ${percentage}%`;
		statusBar.show();
	}

	setInterval(updateStatusBar, 100); //update every 100 ms



	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "code-sensei" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('code-sensei.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from code-sensei!');
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}






