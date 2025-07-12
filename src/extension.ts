import * as vscode from 'vscode';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();

// This key is used to securely store and retrieve the API key from VS Code's secret storage.
const API_SECRET_KEY_STORE = 'codesensei_api_key';

export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "code-sensei" is now active!');

    let writtenCode: string[] = [];
    let pastedCode: string[] = [];
    let isPasting = false;

    // --- PASTE DETECTION AND EXPLANATION ---

    context.subscriptions.push(
        vscode.commands.registerCommand('editor.action.clipboardPasteAction', async () => {
            console.log('PASTE COMMAND TRIGGERED.');
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                // If no active editor, fall back to the default paste command.
                return vscode.commands.executeCommand('default:paste');
            }

            const clipboardContent = await vscode.env.clipboard.readText();

            // Manually perform the paste action
            isPasting = true;
            await editor.edit(editBuilder => {
                editBuilder.replace(editor.selection, clipboardContent);
            });
            isPasting = false;

            indexPastedCode(clipboardContent);

            if (!clipboardContent.trim()) {
                console.log('Paste is empty, skipping explanation.');
                return;
            }

            const apiKey = await getApiKey();
            if (!apiKey) {
                return; // User cancelled or no key was provided
            }

            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Code Sensei: Generating explanation...",
                    cancellable: true
                }, async (progress, token) => {
                    progress.report({ increment: 0 });
                    const explanation = await getCodeExplanation(clipboardContent, apiKey, token);

                    if (token.isCancellationRequested) return;

                    progress.report({ increment: 100 });

                    if (explanation) {
                        await showExplanationInChunks(explanation);
                    } else if (!token.isCancellationRequested) {
                        vscode.window.showErrorMessage('Failed to get an explanation for the pasted code.');
                    }
                });
            } catch (error) {
                console.error('Error during withProgress explanation flow:', error);
                vscode.window.showErrorMessage('An error occurred while fetching the explanation.');
            }
        })
    );

    function indexPastedCode(content: string) {
        if (content.trim().length > 0) {
            pastedCode.push(content);
        }
    }

    // --- TYPING DETECTION ---

    vscode.workspace.onDidChangeTextDocument(event => {
        if (isPasting) {
            return; // Ignore text changes that come from our own paste command
        }
        // Ensure changes are from typing and not undo/redo actions
        if (event.contentChanges.length > 0 && event.reason !== vscode.TextDocumentChangeReason.Undo && event.reason !== vscode.TextDocumentChangeReason.Redo) {
            event.contentChanges.forEach(change => {
                if (change.text.length > 0) {
                    writtenCode.push(change.text);
                }
            });
        }
    });

    // --- STATUS BAR ---

    function calculateRatio(): number {
        const writtenLength = writtenCode.join('').length;
        const pastedLength = pastedCode.join('').length;
        const totalLength = writtenLength + pastedLength;
        if (totalLength === 0) {
            return 1; // Start at 100% written
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

    updateStatusBar();
    const intervalId = setInterval(updateStatusBar, 1000);
    context.subscriptions.push({ dispose: () => clearInterval(intervalId) });

    // --- AVATAR WEBVIEW ---

    const showAvatar = vscode.commands.registerCommand('code-sensei.showAvatar', () => {
        const panel = vscode.window.createWebviewPanel(
            'codeSenseiAvatar',
            'Code Sensei',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
            }
        );

        const idleFolderPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'default_skin', 'idle');
        const idleDiskPath = path.join(context.extensionPath, 'media', 'default_skin', 'idle');

        let images: string[] = [];
        try {
            images = fs.readdirSync(idleDiskPath).filter((file: string) => file.endsWith('.png'));
        } catch (e) {
            vscode.window.showErrorMessage('Could not load avatar images. Check the media folder.');
            return;
        }

        if (images.length === 0) {
            vscode.window.showErrorMessage('No avatar images found in the media folder.');
            return;
        }

        const randomImage = images[Math.floor(Math.random() * images.length)];
        const imageUri = vscode.Uri.joinPath(idleFolderPath, randomImage);
        const webviewUri = panel.webview.asWebviewUri(imageUri);

        panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);
        panel.webview.onDidReceiveMessage(async message => {
            if (message.type === 'EXPLAIN_SELECTED_CODE') {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No active text editor found.');
                    return;
                }

                const selectedCode = editor.document.getText(editor.selection);
                if (!selectedCode.trim()) {
                    vscode.window.showWarningMessage('Please select some code in the editor first.');
                    return;
                }

                const apiKey = await getApiKey();
                if (!apiKey) return;

                const explanation = await getCodeExplanation(selectedCode, apiKey, new vscode.CancellationTokenSource().token);
                if (explanation) {
                    await showExplanationInChunks(explanation);
                } else {
                    vscode.window.showErrorMessage('Failed to generate explanation.');
                }
            }
        });
    });

    context.subscriptions.push(showAvatar);


    // --- HELPER FUNCTIONS (Now inside `activate` to access `context`) ---

    /**
     * Retrieves the stored API key or prompts the user to enter one.
     */
    async function getApiKey(): Promise<string | undefined> {
        let apiKey = await context.secrets.get(API_SECRET_KEY_STORE);
        if (!apiKey) {
            console.log('API Key not found. Prompting user.');
            apiKey = await vscode.window.showInputBox({
                prompt: 'Please enter your OpenRouter API Key for Code Sensei',
                password: true,
                ignoreFocusOut: true,
                placeHolder: 'sk-or-...'
            });
            if (apiKey) {
                await context.secrets.store(API_SECRET_KEY_STORE, apiKey);
                vscode.window.showInformationMessage('Code Sensei: API Key stored successfully!');
            } else {
                vscode.window.showErrorMessage('Code Sensei: API Key not provided. Code explanation is disabled.');
                return undefined;
            }
        }
        return apiKey;
    }

    /**
     * Sends the code to the OpenRouter API and returns the explanation.
     */
    async function getCodeExplanation(code: string, apiKey: string, token: vscode.CancellationToken): Promise<string | null> {
        const openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1/",
            apiKey: apiKey,
        });

        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert programmer. Explain the following code snippet clearly and concisely. Break down your explanation into short, easy-to-understand paragraphs."
                    },
                    {
                        role: "user",
                        content: `Explain this code:\n\n\`\`\`\n${code}\n\`\`\``
                    }
                ],
            });

            if (token.isCancellationRequested) {
                return null;
            }

            return completion.choices[0]?.message?.content || null;

        } catch (error) {
            console.error("OpenRouter API Call Error:", error);
            if (error instanceof OpenAI.APIError) {
                 vscode.window.showErrorMessage(`API Error: ${error.status} - ${error.name}. ${error.message}`);
            } else {
                 vscode.window.showErrorMessage('An unknown error occurred while contacting the API.');
            }
            return null;
        }
    }

    /**
     * Displays the explanation in a series of modal messages.
     */
    async function showExplanationInChunks(explanation: string) {
        // Split by one or more newlines to create paragraphs
        const chunks = explanation.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const isLastChunk = i === chunks.length - 1;
            const buttonText = isLastChunk ? 'Done' : 'Next';
            const choice = await vscode.window.showInformationMessage(chunk, { modal: true }, buttonText);
            
            if (!choice || choice === 'Done') {
                break; // User clicked Done or closed the dialog
            }
        }
    }

    function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'media', 'main.js')
        );

        const imageUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'media', 'default_skin', 'idle', 'magmastern.png')
        );

        return /* html */ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Code Sensei UI</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    background-color: #1e1e1e;
                    color: white;
                    font-family: sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: flex-start;
                }

                #avatar-container {
                    margin-top: 1rem;
                    text-align: center;
                }

                #root {
                    width: 100%;
                    max-width: 600px;
                    margin-top: 2rem;
                }

                img {
                    max-width: 100%;
                    max-height: 250px;
                    object-fit: contain;
                    user-select: none;
                    filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.4));
                }
            </style>
        </head>
        <body>
            <div id="avatar-container">
                <img src="${imageUri}" alt="Code Sensei Avatar" />
            </div>
            <div id="root"></div>
            <script type="module" src="${scriptUri}"></script>
        </body>
        </html>
        `;
    }

    /**
     * Generates the HTML content for the avatar webview.
     */
    function getAvatarWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri) {
        const imageUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'media', 'default_skin', 'idle', 'magmastern.png')
        );

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Code Sensei</title>
            <style>
                html, body {
                    margin: 0;
                    padding: 0;
                    width: 100%;
                    height: 100%;
                    background: transparent;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                img {
                    max-width: 100%;
                    max-height: 100%;
                    object-fit: contain;
                    user-select: none;
                    filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.4));
                }
            </style>
        </head>
        <body>
            <img src="${imageUri}" alt="Code Sensei Avatar" />
        </body>
        </html>`;
    }
}

export function deactivate() {}