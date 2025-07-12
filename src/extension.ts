import * as vscode from 'vscode';
import OpenAI from 'openai';
import * as path from 'path';
import * as fs from 'fs';

const API_SECRET_KEY_STORE = 'codesensei_api_key';

export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "code-sensei" is now active!');

    // --- STATE VARIABLES ---
    let writtenCode: string[] = [];
    let pastedCode: string[] = [];
    let isPasting = false;
    let lastExplanation = '';
    let quizQuestions: any = null;

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

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Code Sensei: Generating explanation...",
                cancellable: true
            }, async (progress, token) => {
                const explanation = await getCodeExplanation(clipboardContent, apiKey, token);
                if (token.isCancellationRequested) return;
                if (explanation) {
                    lastExplanation = explanation;
                    await showExplanationInChunks(explanation);
                } else {
                    vscode.window.showErrorMessage('Failed to get an explanation for the pasted code.');
                }
            });
        })
    );

    function indexPastedCode(content: string) {
        if (content.trim().length > 0) { pastedCode.push(content); }
    }

    // --- TYPING DETECTION ---
    vscode.workspace.onDidChangeTextDocument(event => {
        if (isPasting) { return; }
        if (event.contentChanges.length > 0 && event.reason !== vscode.TextDocumentChangeReason.Undo && event.reason !== vscode.TextDocumentChangeReason.Redo) {
            event.contentChanges.forEach(change => {
                if (change.text.length > 0) { writtenCode.push(change.text); }
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
        const ratio = totalLength === 0 ? 1 : writtenLength / totalLength;
        statusBar.text = `✍️ Hand-Written: ${(ratio * 100).toFixed(1)}%`;
        statusBar.show();
    }
    updateStatusBar();
    // THE FIX IS HERE: Wrap the clearInterval call in a disposable object.
    const intervalId = setInterval(updateStatusBar, 1000);
    context.subscriptions.push({ dispose: () => clearInterval(intervalId) });


    // --- AVATAR WEBVIEW (Unchanged) ---
    // This assumes your getAvatarWebviewContent function exists elsewhere or is added back
    context.subscriptions.push(vscode.commands.registerCommand('code-sensei.showAvatar', () => {
        // ... your existing avatar code ...
    }));

    // --- QUIZ FEATURE ---
    context.subscriptions.push(vscode.commands.registerCommand('code-sensei.startQuiz', async () => {
        if (!lastExplanation) {
            vscode.window.showErrorMessage("No code explanation available to generate a quiz from.");
            return;
        }
        const apiKey = await getApiKey();
        if (!apiKey) return;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Generating Quiz...",
        }, async () => {
            const quizData = await generateQuiz(lastExplanation, apiKey);
            if (quizData && quizData.questions) {
                quizQuestions = quizData.questions;
                createQuizWebview(quizData);
            }
        });
    }));

    function createQuizWebview(quizData: any) {
        const panel = vscode.window.createWebviewPanel(
            'codeSenseiQuiz',
            'Code Sensei: Quiz',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );

        panel.webview.html = getQuizWebviewContent();
        panel.webview.postMessage({ command: 'startQuiz', data: quizData });

        panel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'submitAnswers') {
                panel.dispose();
                const apiKey = await getApiKey();
                if (!apiKey) return;

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Grading your answers...",
                }, async () => {
                    const result = await gradeQuiz(quizQuestions, message.answers, apiKey);
                    if (result) {
                        vscode.window.showInformationMessage(`Quiz Result: ${result.score}. ${result.feedback}`, { modal: true });
                    }
                });
            }
        });
    }

    // --- HELPER FUNCTIONS ---

<<<<<<< HEAD
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
=======
>>>>>>> d1fe31951aa9ccd66be9042f7f5d335695d17d8c
    async function getApiKey(): Promise<string | undefined> {
        let apiKey = await context.secrets.get(API_SECRET_KEY_STORE);
        if (!apiKey) {
            apiKey = await vscode.window.showInputBox({ prompt: 'Please enter your OpenRouter API Key', password: true, ignoreFocusOut: true, placeHolder: 'sk-or-...' });
            if (apiKey) { await context.secrets.store(API_SECRET_KEY_STORE, apiKey); }
            else { vscode.window.showErrorMessage('API Key not provided.'); return undefined; }
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
            if (error instanceof OpenAI.APIError) { vscode.window.showErrorMessage(`API Error: ${error.status} - ${error.name}. ${error.message}`); }
            else { vscode.window.showErrorMessage('An unknown error occurred while contacting the API.'); }
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

<<<<<<< HEAD
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

=======
    async function generateQuiz(explanationText: string, apiKey: string): Promise<any | null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey: apiKey });
        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                response_format: { type: "json_object" }, 
                messages: [{
                    role: "system",
                    content: `You are a quiz generation expert. Based on the following code explanation, create a quiz with 3-4 questions (1 mcq, 1 fill-in-the-blank, 1 coding). Respond with ONLY a valid JSON object based on this structure: {"questions": [{"type": "mcq" | "fill-in-the-blank" | "coding", "question": "...", "options": ["..."], "answer": "..."}]}`
                }, {
                    role: "user",
                    content: explanationText
                }],
            });
            return JSON.parse(completion.choices[0]?.message?.content || 'null');
        } catch (error) {
            console.error("Quiz Generation API Error:", error);
            vscode.window.showErrorMessage('Could not generate a quiz.');
            return null;
        }
    }

    async function gradeQuiz(questions: any[], userAnswers: any, apiKey: string): Promise<{ score: string; feedback: string } | null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey: apiKey });
        const gradingPrompt = `You are a teaching assistant. Grade the following quiz based on the provided questions and the user's answers. Provide a final score as a fraction (e.g., "2/3") and a single sentence of encouraging feedback. Questions and Correct Answers: ${JSON.stringify(questions, null, 2)} User's Answers: ${JSON.stringify(userAnswers, null, 2)} Respond in a JSON object with two keys: "score" and "feedback".`;
        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                response_format: { type: "json_object" },
                messages: [{ role: "system", content: gradingPrompt }],
            });
            return JSON.parse(completion.choices[0]?.message?.content || 'null');
        } catch (error) {
            console.error("Grading API Error:", error);
            vscode.window.showErrorMessage('Could not grade the quiz.');
            return null;
        }
    }

    function getQuizWebviewContent() {
>>>>>>> d1fe31951aa9ccd66be9042f7f5d335695d17d8c
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Code Sensei Quiz</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 20px; background-color: var(--vscode-sideBar-background); color: var(--vscode-foreground); }
                .question-block { margin-bottom: 25px; padding: 15px; border-radius: 5px; background-color: var(--vscode-input-background); }
                h3 { margin-top: 0; }
                label { display: block; margin: 5px 0; }
                input[type="text"], textarea { width: 95%; padding: 8px; border-radius: 3px; border: 1px solid var(--vscode-input-border); background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); font-family: sans-serif; }
                textarea { font-family: monospace; }
                button { padding: 10px 15px; border: none; border-radius: 5px; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; font-size: 16px; margin-top: 20px; }
                button:hover { background-color: var(--vscode-button-hoverBackground); }
            </style>
        </head>
        <body>
<<<<<<< HEAD
            <img src="${imageUri}" alt="Code Sensei Avatar" />
=======
            <h1>Code Comprehension Quiz</h1>
            <div id="quiz-container"></div>
            <button id="submit-btn">Submit Answers</button>

            <script>
                const vscode = acquireVsCodeApi();
                const quizContainer = document.getElementById('quiz-container');
                const submitBtn = document.getElementById('submit-btn');

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'startQuiz') {
                        renderQuiz(message.data.questions);
                    }
                });

                function renderQuiz(questions) {
                    quizContainer.innerHTML = '';
                    questions.forEach((q, index) => {
                        const block = document.createElement('div');
                        block.className = 'question-block';
                        let content = \`<h3>Question \${index + 1}: \${q.question}</h3>\`;

                        if (q.type === 'mcq') {
                            q.options.forEach(opt => {
                                content += \`<label><input type="radio" name="q\${index}" value="\${opt}"> \${opt}</label>\`;
                            });
                        } else if (q.type === 'fill-in-the-blank') {
                            content += \`<input type="text" name="q\${index}" placeholder="Your answer...">\`;
                        } else if (q.type === 'coding') {
                            content += \`<textarea name="q\${index}" rows="5" placeholder="Write your code here..."></textarea>\`;
                        }
                        block.innerHTML = content;
                        quizContainer.appendChild(block);
                    });
                }

                submitBtn.addEventListener('click', () => {
                    const answers = {};
                    const inputs = quizContainer.querySelectorAll('input, textarea');
                    inputs.forEach(input => {
                        if (input.type === 'radio') {
                            if (input.checked) {
                                answers[input.name] = input.value;
                            }
                        } else {
                            answers[input.name] = input.value;
                        }
                    });
                    vscode.postMessage({ command: 'submitAnswers', answers: answers });
                });
            </script>
>>>>>>> d1fe31951aa9ccd66be9042f7f5d335695d17d8c
        </body>
        </html>`;
    }
}

export function deactivate() {}
