import * as vscode from 'vscode';
// import axios from 'axios'; // No longer needed
import OpenAI from 'openai'; // Import the new OpenAI SDK
import dotenv from 'dotenv';
dotenv.config()

const apiKey = process.env.MY_API_KEY;


const MISTRAL_API_KEY_SECRET_KEY = 'lmfaooooo'; // We'll keep the same secret key name

export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "code-sensei" is now active!');

    let writtenCode: string[] = [];
    let pastedCode: string[] = [];
    let isPasting = false;

    context.subscriptions.push(
        vscode.commands.registerCommand('editor.action.clipboardPasteAction', async () => {
            console.log('PASTE COMMAND TRIGGERED.');
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
                console.log('Paste is empty, skipping explanation.');
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
                console.error('Error during withProgress explanation flow:', error);
                vscode.window.showErrorMessage('An error occurred while fetching the explanation.');
            }
        })
    );

    function indexPastedCode(content: string) {
        if(content.trim().length > 0) {
            pastedCode.push(content);
        }
    }

    vscode.workspace.onDidChangeTextDocument(event => {
        if (isPasting) {
            return;
        }
        if (event.contentChanges.length > 0 && event.reason !== vscode.TextDocumentChangeReason.Undo && event.reason !== vscode.TextDocumentChangeReason.Redo) {
            event.contentChanges.forEach(change => {
                if (change.text.length > 0) {
                    console.log(`TYPING DETECTED: ${change.text}`);
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

    console.log('STATUS BAR: Initializing...');
    updateStatusBar();
    const intervalId = setInterval(updateStatusBar, 1000);
    context.subscriptions.push({ dispose: () => clearInterval(intervalId) });

    const disposable = vscode.commands.registerCommand('code-sensei.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from Code Sensei!');
    });
    context.subscriptions.push(disposable);
}

    const path = require('path');
    const fs = require('fs');

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

        // Read files from folder
        let images: string[] = [];
        try {
            images = fs.readdirSync(idleDiskPath).filter((file: string) => file.endsWith('.png'));
        } catch (e) {
            vscode.window.showErrorMessage('Could not load avatar images.');
            return;
        }

        if (images.length === 0) {
            vscode.window.showErrorMessage('No avatar images found.');
            return;
        }

        const randomImage = images[Math.floor(Math.random() * images.length)];
        const imageUri = vscode.Uri.joinPath(idleFolderPath, randomImage);
        const webviewUri = panel.webview.asWebviewUri(imageUri);

        panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
        <meta charset="UTF-8">
        <style>
            html, body {
            margin: 0;
            padding: 0;
            background: transparent;
            overflow: hidden;
            }
            #avatar-container {
            position: fixed;
            bottom: 16px;
            right: 16px;
            z-index: 9999;
            display: inline-block;
            align-items: flex-end;
            justify-content: flex-end;
            pointer-events: none; /* prevents interaction blocking */
            }
            img {
            max-height: 240px;
            width: auto;
            user-select: none;
            pointer-events: none;
            opacity: 0.95;
            filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.4));
            }
        </style>
        </head>
        <body>
        <div id="avatar-container">
            <img src="${webviewUri}" alt="Code Sensei Avatar" />
        </div>
        </body>
        </html>`;

    });

    context.subscriptions.push(showAvatar);


}

// --- Helper Functions ---

async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    let apiKey = await context.secrets.get(apiKey);
    if (!apiKey) {
        console.log('API Key not found. Prompting user.');
        apiKey = await vscode.window.showInputBox({
            prompt: 'Please enter your OpenRouter API Key',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'sk-or-...'
        });
        if (apiKey) {
            await context.secrets.store(apiKey, apiKey);
            vscode.window.showInformationMessage('Code Sensei: API Key stored successfully!');
        } else {
            vscode.window.showErrorMessage('Code Sensei: API Key not provided. Code explanation is disabled.');
            return undefined;
        }
    }
    return apiKey;
}

/**
 * Sends the code to the OpenRouter API using the OpenAI SDK.
 * @param code The code snippet to explain.
 * @param apiKey The user's OpenRouter API key.
 * @returns The explanation text or null if an error occurs.
 */
async function getCodeExplanation(code: string, apiKey: string): Promise<string | null> {
    // --- THIS FUNCTION IS NOW UPDATED ---
    
    // 1. Initialize the OpenAI client to point to OpenRouter
    const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1/",
        apiKey: apiKey,
        defaultHeaders: {
            // Optional headers to identify your app on OpenRouter rankings
            //"HTTP-Referer": "", // Replace with your repo
            //"X-Title": "Code Sensei VSCode Extension", // Replace with your app name
        },
    });

    try {
        // 2. Call the chat completions endpoint with the new model
        const completion = await openai.chat.completions.create({
            model: "tngtech/deepseek-r1t2-chimera:free", // The new model you requested
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

        // 3. Return the response content
        return completion.choices[0]?.message?.content || null;

    } catch (error) {
        console.error("OpenRouter API Call Error:", error);
        // The OpenAI SDK throws detailed errors, so we can display them.
        if (error instanceof OpenAI.APIError) {
             vscode.window.showErrorMessage(`API Error: ${error.status} - ${error.name}. ${error.message}`);
        } else {
             vscode.window.showErrorMessage('An unknown error occurred while contacting the API.');
        }
        return null;
    }
}

async function showExplanationInChunks(explanation: string) {
    // Split by two newlines to better separate paragraphs
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