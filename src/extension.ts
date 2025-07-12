import * as vscode from 'vscode';
import axios from 'axios';

const MISTRAL_API_KEY_SECRET_KEY = 'mistralApiKey';

export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "code-sensei" is now active!');

    let writtenCode: string[] = [];
    let pastedCode: string[] = [];
    let isPasting = false; // Flag to track when a paste is in progress

    // --- Paste Handler and Explainer ---
    context.subscriptions.push(
        vscode.commands.registerCommand('editor.action.clipboardPasteAction', async () => {
            console.log('PASTE COMMAND TRIGGERED.'); // <-- DIAGNOSTIC LOG
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return vscode.commands.executeCommand('default:paste');
            }

            const clipboardContent = await vscode.env.clipboard.readText();

            isPasting = true;
            await editor.edit(editBuilder => {
                editBuilder.replace(editor.selection, clipboardContent);
            });
            isPasting = false;

            indexPastedCode(clipboardContent);

            if (!clipboardContent.trim()) {
                console.log('Paste is empty, skipping explanation.'); // <-- DIAGNOSTIC LOG
                return;
            }

            const apiKey = await getApiKey(context);
            if (!apiKey) {
                return;
            }

            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Code Sensei: Generating explanation...",
                    cancellable: true
                }, async (progress, token) => {
                    progress.report({ increment: 0 });
                    const explanation = await getCodeExplanation(clipboardContent, apiKey);

                    if (token.isCancellationRequested) return;

                    progress.report({ increment: 100 });

                    if (explanation) {
                        await showExplanationInChunks(explanation);
                    } else if (!token.isCancellationRequested) {
                        vscode.window.showErrorMessage('Failed to get an explanation for the pasted code.');
                    }
                });
            } catch (error) {
                console.error('Error during withProgress explanation flow:', error); // <-- DIAGNOSTIC LOG
                vscode.window.showErrorMessage('An error occurred while fetching the explanation.');
            }
        })
    );

    function indexPastedCode(content: string) {
        if(content.trim().length > 0) {
            pastedCode.push(content);
        }
    }

    // --- Logic for detecting typed text ---
    vscode.workspace.onDidChangeTextDocument(event => {
        if (isPasting) {
            return;
        }

        if (event.contentChanges.length > 0 && event.reason !== vscode.TextDocumentChangeReason.Undo && event.reason !== vscode.TextDocumentChangeReason.Redo) {
            event.contentChanges.forEach(change => {
                if (change.text.length > 0) {
                    console.log(`TYPING DETECTED: ${change.text}`); // <-- DIAGNOSTIC LOG
                    writtenCode.push(change.text);
                }
            });
        }
    });

    function calculateRatio(): number {
        const writtenLength = writtenCode.join('').length;
        const pastedLength = pastedCode.join('').length;
        const totalLength = writtenLength + pastedLength;

        if (totalLength === 0) {
            return 1;
        }
        return writtenLength / totalLength;
    }

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(statusBar);

    function updateStatusBar() {
        const ratio = calculateRatio();
        const percentage = (ratio * 100).toFixed(1);
        statusBar.text = `✍️ Hand-Written: ${percentage}%`;
        statusBar.tooltip = `Ratio of typed vs. pasted code.`;
        statusBar.show();
    }

    console.log('STATUS BAR: Initializing...'); // <-- DIAGNOSTIC LOG
    updateStatusBar();
    const intervalId = setInterval(updateStatusBar, 1000);
    context.subscriptions.push({ dispose: () => clearInterval(intervalId) });
    console.log('STATUS BAR: Initialized and updating.'); // <-- DIAGNOSTIC LOG

    const disposable = vscode.commands.registerCommand('code-sensei.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from Code Sensei!');
    });
    context.subscriptions.push(disposable);
}


// --- Helper Functions ---

async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    let apiKey = await context.secrets.get(MISTRAL_API_KEY_SECRET_KEY);
    if (!apiKey) {
        console.log('API Key not found. Prompting user.'); // <-- DIAGNOSTIC LOG
        apiKey = await vscode.window.showInputBox({
            prompt: 'Please enter your OpenRouter (MistralAI) API Key',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'sk-or-mstr-...'
        });
        if (apiKey) {
            await context.secrets.store(MISTRAL_API_KEY_SECRET_KEY, apiKey);
            vscode.window.showInformationMessage('Code Sensei: API Key stored successfully!');
        } else {
            vscode.window.showErrorMessage('Code Sensei: API Key not provided. Code explanation is disabled.');
            return undefined;
        }
    }
    return apiKey;
}

async function getCodeExplanation(code: string, apiKey: string): Promise<string | null> {
    const apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    try {
        const response = await axios.post(apiUrl, {
            model: 'mistralai/mistral-7b-instruct',
            messages: [{
                role: 'system',
                content: 'You are an expert programmer. Explain the following code snippet clearly and concisely. Break down your explanation into short, easy-to-understand paragraphs of 3-4 sentences each.'
            }, {
                role: 'user',
                content: `Explain this code:\n\n\`\`\`\n${code}\n\`\`\``
            }]
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data?.choices?.[0]?.message?.content || null;
    } catch (error) {
        console.error("API Call Error:", error);
        if (axios.isAxiosError(error) && error.response) {
            const errorMessage = `API Error: ${error.response.status}. ${error.response.data?.error?.message || 'Check the Output panel for details.'}`;
            vscode.window.showErrorMessage(errorMessage);
            console.error('API Response Data:', error.response.data);
        }
        return null;
    }
}

async function showExplanationInChunks(explanation: string) {
    const chunks = explanation.split('\n\n').filter(p => p.trim().length > 0);
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isLastChunk = i === chunks.length - 1;
        const buttonText = isLastChunk ? 'Done' : 'Next';
        const choice = await vscode.window.showInformationMessage(chunk, { modal: true }, buttonText);
        if (!choice || choice === 'Done') {
            break;
        }
    }
}

export function deactivate() {}