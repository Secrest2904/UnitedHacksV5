import * as vscode from 'vscode';
import OpenAI from 'openai';
import * as path from 'path';

const API_SECRET_KEY_STORE = 'codesensei_api_key';
let avatarPanel: vscode.WebviewPanel | null = null;

// Define a type for our learning history items
type LearningHistoryItem = {
    code: string;
    explanation: string;
    quizResult?: { score: string; feedback: string };
};

export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "code-sensei" is now active!');


    // --- STATE VARIABLES ---
    let webviewPanel: vscode.WebviewPanel | undefined;
    const learningHistory: LearningHistoryItem[] = [];
    let lastExplanation = '';
    let lastPastedCode = '';
    let quizQuestions: any = null;
    let writtenCode: string[] = [];
    let pastedCode: string[] = [];
    let isPasting = false;

    // --- COMMANDS ---
    context.subscriptions.push(
        vscode.commands.registerCommand('code-sensei.clearApiKey', async () => {
            await context.secrets.delete(API_SECRET_KEY_STORE);
            vscode.window.showInformationMessage('Code Sensei: Stored API Key has been cleared.');
        })
    );

    // --- STATE VARIABLES ---
    let writtenCode: string[] = [];
    let pastedCode: string[] = [];
    let isPasting = false;
    let lastExplanation = '';
    let quizQuestions: any = null;
    const emotionImages = {
      happy: 'happy/happy.png',
      confused: 'confused/confused.png',
      stern: 'stern/stern.png',
      idle: 'idle/idle.png',
    };

    // --- PASTE DETECTION AND EXPLANATION ---

    context.subscriptions.push(
        vscode.commands.registerCommand('editor.action.clipboardPasteAction', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return vscode.commands.executeCommand('default:paste'); }
            const clipboardContent = await vscode.env.clipboard.readText();

            isPasting = true;
            await editor.edit(editBuilder => { editBuilder.replace(editor.selection, clipboardContent); });
            isPasting = false;
            indexPastedCode(clipboardContent);

            if (!clipboardContent.trim()) { return; }
            const apiKey = await getApiKey();
            if (!apiKey) { return; }

            // Ensure webview is visible
            if (!webviewPanel) {
                vscode.commands.executeCommand('code-sensei.showAvatar');
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Code Sensei: Generating explanation...",
                cancellable: true
            }, async (progress, token) => {
                const explanation = await getCodeExplanation(clipboardContent, apiKey, token);
                if (token.isCancellationRequested) return;

                if (explanation && webviewPanel) {
                    console.log("✅ Explanation received from API. Sending to webview.");
                    lastExplanation = explanation;
                    lastPastedCode = clipboardContent;
                    webviewPanel.webview.postMessage({ command: 'showExplanation', data: explanation });
                } else {
                    console.error("❌ Explanation was null or webview panel was not available.");
                    vscode.window.showErrorMessage('Failed to get an explanation for the pasted code.');
                }
            });
        })
    );

    const showAvatarCommand = vscode.commands.registerCommand('code-sensei.showAvatar', () => {
        if (webviewPanel) {
            webviewPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        webviewPanel = vscode.window.createWebviewPanel(
            'codeSenseiAvatar',
            'Code Sensei',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
            }
        );

        webviewPanel.webview.html = getAvatarWebviewContent(webviewPanel.webview, context.extensionUri);

        webviewPanel.onDidDispose(() => {
            webviewPanel = undefined;
        }, null, context.subscriptions);

        // --- MESSAGE HANDLING FROM WEBVIEW ---
        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'startQuiz':
                    if (!lastExplanation) {
                        vscode.window.showErrorMessage("No explanation available to generate a quiz from.");
                        return;
                    }
                    await startQuiz(lastExplanation);
                    return;

                case 'submitQuiz':
                    await gradeAndProcessQuiz(message.answers);
                    return;

                case 'generateEducationPlan':
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "Code Sensei: Generating your education plan...",
                        cancellable: false
                    }, async () => {
                        const apiKey = await getApiKey();
                        if (!apiKey || !webviewPanel) return;

                        const plan = await generateEducationPlan(learningHistory, apiKey);
                        if (plan) {
                            webviewPanel.webview.postMessage({ command: 'showEducationPlan', data: plan });
                        } else {
                            vscode.window.showErrorMessage('Could not generate an education plan.');
                        }
                    });
                    return;
            }
        }, undefined, context.subscriptions);
    });
    context.subscriptions.push(showAvatarCommand);

    // --- LISTENERS FOR STATUS BAR ---
    function indexPastedCode(content: string) {
        if (content.trim().length > 0) {
            pastedCode.push(content);
        }
    }

    vscode.workspace.onDidChangeTextDocument(event => {

        if (isPasting || !webviewPanel) { return; } // Don't track if pasting or panel isn't open
        if (event.contentChanges.length > 0 && event.reason !== vscode.TextDocumentChangeReason.Undo && event.reason !== vscode.TextDocumentChangeReason.Redo) {


            event.contentChanges.forEach(change => {
                if (change.text.length > 0) {
                    writtenCode.push(change.text);
                }
            });

            const writtenLength = writtenCode.join('').length;
            const pastedLength = pastedCode.join('').length;
            const totalLength = writtenLength + pastedLength;
            const ratio = totalLength === 0 ? 1 : writtenLength / totalLength;

            let idleTimer: NodeJS.Timeout | null = null;

            function resetIdleTimer() {
                if (idleTimer) clearTimeout(idleTimer);
                idleTimer = setTimeout(() => {
                    if (avatarPanel) {
                        const imageUri = avatarPanel.webview.asWebviewUri(
                            vscode.Uri.joinPath(context.extensionUri, 'media', 'default_skin', 'idle', 'idle.png')
                        );
                        avatarPanel.webview.html = getAvatarWebviewContentFromUri(imageUri);
                    }
                }, 2 * 60 * 1000); // 2 minutes
            }

            let emotionFolder = 'idle'; // default
            if (ratio >= 0.95) emotionFolder = 'happy';
            else if (ratio >= 0.65) emotionFolder = 'confused';
            else emotionFolder = 'stern';

            // Set new image path
            const imageUri = avatarPanel.webview.asWebviewUri(
                vscode.Uri.joinPath(
                    context.extensionUri,
                    'media',
                    'default_skin',
                    emotionFolder,
                    `${emotionFolder}.png`
                )
            );

            // Replace the entire HTML to update the avatar image
            avatarPanel.webview.html = getAvatarWebviewContentFromUri(imageUri);
        }
    });
    function getAvatarWebviewContentFromUri(imageUri: vscode.Uri): string {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Code Sensei</title>
            <style>
                body {
                    background: #1e1e1e;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    font-family: sans-serif;
                }
                img {
                    width: 200px;
                    height: auto;
                    margin-bottom: 20px;
                    filter: drop-shadow(0 2px 5px rgba(0,0,0,0.4));
                }
                button {
                    padding: 10px 20px;
                    font-size: 16px;
                    border: none;
                    border-radius: 5px;
                    background-color: #007acc;
                    color: white;
                    cursor: pointer;
                }
                button:hover {
                    background-color: #005a9e;
                }
            </style>
        </head>
        <body>
            <img src="${imageUri}" alt="Code Sensei Avatar" />
            <button onclick="vscode.postMessage({ command: 'explainSelectedCode' })">Explain Selected Code</button>
            <script>
                const vscode = acquireVsCodeApi();
            </script>
        </body>
        </html>
        `;
    }

    // --- STATUS BAR ---
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(statusBar);

    function updateStatusBar() {
        const writtenLength = writtenCode.join('').length;
        const pastedLength = pastedCode.join('').length;
        const totalLength = writtenLength + pastedLength;
        if (totalLength === 0) {
            statusBar.hide();
            return;
        }
        const ratio = writtenLength / totalLength;
        statusBar.text = `✍️ Hand-Written: ${(ratio * 100).toFixed(1)}%`;
        statusBar.show();
    }

    const intervalId = setInterval(updateStatusBar, 2000);
    context.subscriptions.push({ dispose: () => clearInterval(intervalId) });


    // --- AVATAR WEBVIEW (Unchanged) ---
    const showAvatar = vscode.commands.registerCommand('code-sensei.showAvatar', () => {
        avatarPanel = vscode.window.createWebviewPanel(
            'codeSenseiAvatar',
            'Code Sensei Avatar',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );

        avatarPanel.webview.html = getAvatarWebviewContent(avatarPanel.webview, context.extensionUri);

        avatarPanel.onDidDispose(() => {
            avatarPanel = null;
        });

        avatarPanel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'explainSelectedCode') {
                    const editor = vscode.window.activeTextEditor!;
                    const selectedCode = editor.document.getText(editor.selection);
                    if (!selectedCode.trim()) {
                        vscode.window.showErrorMessage('Please select some code to explain.');
                        return;
                    }
                    const apiKey = await getApiKey();
                    if (!apiKey) {
                        return;
                    }
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "Code Sensei: Generating explanation...",
                        cancellable: true
                    }, async (progress, token) => {
                        const explanation = await getCodeExplanation(selectedCode, apiKey, token);
                        if (token.isCancellationRequested) {
                            return;
                        }
                        if (explanation) {
                            lastExplanation = explanation;
                            await showExplanationInChunks(explanation);
                        } else {
                            vscode.window.showErrorMessage('Failed to get an explanation for the selected code.');
                        }
                    });
                }
            });
        }
    );
    context.subscriptions.push(showAvatar);


    // --- HELPER & API FUNCTIONS ---
    async function startQuiz(explanation: string) {
        const apiKey = await getApiKey();
        if (!apiKey || !webviewPanel) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Generating Quiz...",
        }, async () => {
            const quizData = await generateQuiz(explanation, apiKey);
            if (quizData && quizData.questions) {
                quizQuestions = quizData.questions;
                webviewPanel?.webview.postMessage({ command: 'startQuiz', data: quizData });
            } else {
                vscode.window.showErrorMessage('Could not generate a quiz.');
            }
        });
    }

    async function gradeAndProcessQuiz(answers: any) {
        const apiKey = await getApiKey();
        if (!apiKey || !webviewPanel) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Grading your answers...",
        }, async () => {
            const result = await gradeQuiz(quizQuestions, answers, apiKey);
            if (result) {
                learningHistory.push({
                    code: lastPastedCode,
                    explanation: lastExplanation,
                    quizResult: result
                });
                webviewPanel?.webview.postMessage({ command: 'showQuizResult', data: result });
            } else {
                vscode.window.showErrorMessage('Could not grade the quiz.');
            }
        });
    }

    async function getApiKey(): Promise<string | undefined> {
        let apiKey = await context.secrets.get(API_SECRET_KEY_STORE);
        if (!apiKey) {
            apiKey = await vscode.window.showInputBox({
                prompt: 'Please enter your OpenRouter API Key',
                password: true,
                ignoreFocusOut: true,
                placeHolder: 'sk-or-...'
            });
            if (apiKey) {
                await context.secrets.store(API_SECRET_KEY_STORE, apiKey);
            } else {
                vscode.window.showErrorMessage('API Key not provided.');
                return undefined;
            }
        }
        return apiKey;
    }

    async function getCodeExplanation(code: string, apiKey: string, token: vscode.CancellationToken): Promise<string | null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey: apiKey });
        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                messages: [{ role: "system", content: "You are an expert programmer. Explain the following code snippet clearly and concisely." }, { role: "user", content: `Explain this code:\n\n\`\`\`\n${code}\n\`\`\`` }],
            });
            return token.isCancellationRequested ? null : completion.choices[0]?.message?.content || null;
        } catch (error) {
            console.error("OpenRouter API Call Error:", error);
            vscode.window.showErrorMessage('An API error occurred while fetching the explanation.');
            return null;
        }
    }


    async function showExplanationInChunks(explanation: string) {
        const chunks = explanation.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const isLastChunk = i === chunks.length - 1;
            const buttonText = isLastChunk ? 'Start Quiz' : 'Next';
            const choice = await vscode.window.showInformationMessage(chunk, { modal: true }, buttonText);
            if (!choice) { return; }
            if (choice === 'Start Quiz') {
                vscode.commands.executeCommand('code-sensei.startQuiz');
                break;
            }
        }
    }
    function getAvatarWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        const imageUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'media', 'default_skin', 'idle', 'idle.png')
        );

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Code Sensei</title>
            <style>
                body {
                    background: #1e1e1e;
                    color: white;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                }
                img {
                    width: 1000px;
                    height: auto;
                    margin-bottom: 20px;
                    filter: drop-shadow(0 2px 5px rgba(0,0,0,0.4));
                }
                button {
                    padding: 10px 20px;
                    font-size: 16px;
                    border: none;
                    border-radius: 5px;
                    background-color: #007acc;
                    color: white;
                    cursor: pointer;
                }
                button:hover {
                    background-color: #005a9e;
                }
            </style>
        </head>
        <body>
            <img src="${imageUri}" alt="Code Sensei Avatar" />
            <button onclick="vscode.postMessage({ command: 'explainSelectedCode' })">Explain Selected Code</button>
            <script>
                const vscode = acquireVsCodeApi();
                window.addEventListener('message', event => {
                    const { image, emotion } = event.data;
                    if (image) {
                        const img = document.querySelector("img");
                        if (img) img.src = image;
                    }
                });
            </script>
        </body>
        </html>
        `;
    }

    async function generateQuiz(explanationText: string, apiKey: string): Promise<any | null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey: apiKey });
        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                response_format: { type: "json_object" },
                messages: [{
                    role: "system",
                    content: `You are a quiz generation expert. Based on the provided code explanation, create a quiz with 3 questions (one multiple choice, one fill-in-the-blank, and one short coding challenge). Respond with ONLY a valid JSON object using this structure: {"questions": [{"type": "mcq" | "fill-in-the-blank" | "coding", "question": "...", "options": ["..."] | null, "answer": "..."}]}`
                }, {
                    role: "user",
                    content: explanationText
                }],
            });
            return JSON.parse(completion.choices[0]?.message?.content || 'null');
        } catch (error) {
            console.error("Quiz Generation API Error:", error);
            return null;
        }
    }

    async function gradeQuiz(questions: any[], userAnswers: any, apiKey: string): Promise<{ score: string; feedback: string } | null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey: apiKey });
        const gradingPrompt = `You are a teaching assistant. Grade the quiz based on the provided questions and user answers. Provide a score as a fraction (e.g., "2/3") and one sentence of encouraging feedback. Questions and Correct Answers: ${JSON.stringify(questions, null, 2)} User's Answers: ${JSON.stringify(userAnswers, null, 2)} Respond in a JSON object with two keys: "score" and "feedback".`;
        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                response_format: { type: "json_object" },
                messages: [{ role: "system", content: gradingPrompt }],
            });
            return JSON.parse(completion.choices[0]?.message?.content || 'null');
        } catch (error) {
            console.error("Grading API Error:", error);
            return null;
        }
    }

    async function generateEducationPlan(history: LearningHistoryItem[], apiKey: string): Promise<any | null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey: apiKey });
        const historySummary = history.map(item =>
            `Topic: Code Explanation (${item.code.substring(0, 50)}...)\nQuiz Score: ${item.quizResult?.score}\nFeedback: ${item.quizResult?.feedback}`
        ).join('\n\n');

        const planPrompt = `
        You are an expert programming mentor. A student has been learning by pasting code, getting explanations, and taking quizzes.
        Based on their learning history, generate a personalized education plan to help them upskill.

        Analyze their performance and identify potential weak spots or areas for deeper study.

        The plan should include:
        1.  "topicsToStudy": An array of strings, with each string being a key concept or topic they should research.
        2.  "assignments": An array of objects, where each object has a "title" (e.g., "Build a Small App") and a "description" of a practical coding assignment they can do to solidify their knowledge.

        Respond with ONLY a valid JSON object with the keys "topicsToStudy" and "assignments".

        ---
        STUDENT'S LEARNING HISTORY:
        ${historySummary}
        ---
        `;

        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                response_format: { type: "json_object" },
                messages: [{ role: "system", content: planPrompt }],
            });
            return JSON.parse(completion.choices[0]?.message?.content || 'null');
        } catch (error) {
            console.error("Education Plan API Error:", error);
            return null;
        }
    }
}

function getAvatarWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));
    const nonce = getNonce();

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <link href="${stylesUri}" rel="stylesheet">
        <title>Code Sensei</title>
    </head>
    <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() {}