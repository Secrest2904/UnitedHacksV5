import * as vscode from 'vscode';
import OpenAI from 'openai';
import * as path from 'path';

const API_SECRET_KEY_STORE = 'codesensei_api_key';

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

    // This command intercepts the user pasting code.
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

            // Ensure webview is visible before proceeding
            if (!webviewPanel || webviewPanel.visible === false) {
                await vscode.commands.executeCommand('code-sensei.showAvatar');
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

    // This command shows the main webview panel.
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

        webviewPanel.webview.html = getAvatarWebviewContentFromUri(webviewPanel.webview, context.extensionUri);

        webviewPanel.onDidDispose(() => {
            webviewPanel = undefined;
        }, null, context.subscriptions);

        // Handles all messages sent from the React webview
        webviewPanel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'explainSelectedCode':
                    // This case can be expanded later if needed
                    break;

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
        if (isPasting) { return; }
        if (event.contentChanges.length > 0 && event.reason !== vscode.TextDocumentChangeReason.Undo && event.reason !== vscode.TextDocumentChangeReason.Redo) {
            event.contentChanges.forEach(change => {
                if (change.text.length > 0) {
                    writtenCode.push(change.text);
                }
            });
        }
    });

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
    let lastSentEmotion = '';

    function updateAvatarBasedOnRatio() {
        if (!webviewPanel) return;

        const writtenLength = writtenCode.join('').length;
        const pastedLength = pastedCode.join('').length;
        const totalLength = writtenLength + pastedLength;
        if (totalLength === 0) return;

        const ratio = writtenLength / totalLength;
        let emotion = 'idle';
        if (ratio >= 0.95) emotion = 'happy';
        else if (ratio < 0.65) emotion = 'stern';

        if (emotion === lastSentEmotion) return; // don't resend the same
        lastSentEmotion = emotion;

        const emotionUri = webviewPanel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'media', 'default_skin', emotion, `${emotion}.png`)
        );

        console.log(`[Avatar] Sending Emotion "${emotion}" (${(ratio * 100).toFixed(1)}%) → ${emotionUri}`);

        webviewPanel.webview.postMessage({
            command: 'setEmotion',
            image: emotionUri.toString()
        });
    }

    context.subscriptions.push({ dispose: () => clearInterval(intervalId) });

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
    const intervalId = setInterval(() => {
        updateStatusBar();
        updateAvatarBasedOnRatio();
    }, 2000); // every 2 seconds

    context.subscriptions.push({ dispose: () => clearInterval(intervalId) });

}

/**
 * Generates the HTML content for the webview, which serves as a container for the React app.
 */
function getAvatarWebviewContentFromUri(webview: vscode.Webview, extensionUri: vscode.Uri, emotion: string = 'idle'): string {
    const imageUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'default_skin', emotion, `${emotion}.png`)
    );
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));
    const nonce = getNonce();

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} blob: data:; script-src 'nonce-${nonce}';">
        <link href="${stylesUri}" rel="stylesheet">
        <title>Code Sensei</title>
        <style>
            body {
                background-color: #1e1e1e;
                color: white;
                font-family: sans-serif;
                margin: 0;
                padding: 0 1rem;
                overflow-x: hidden; /* prevents sideways scroll glitch */
            }

            img {
                height: 200px;
                max-width: 100%;
                display: block;
                margin: 1rem auto;
            }

            #root {
                padding-bottom: 2rem;
            }
        </style>
    </head>
    <body>
        <img src="${imageUri}" alt="Sensei" />
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
}


/**
 * Generates a random string to be used as a nonce for Content Security Policy.
 */
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function deactivate() {}