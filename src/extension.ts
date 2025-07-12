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

    // --- CLEAR API KEY COMMAND ---
    context.subscriptions.push(
        vscode.commands.registerCommand('code-sensei.clearApiKey', async () => {
            await context.secrets.delete(API_SECRET_KEY_STORE);
            vscode.window.showInformationMessage('Code Sensei: Stored API Key has been cleared.');
        })
    );

    // --- PASTE DETECTION AND EXPLANATION ---
    context.subscriptions.push(
        vscode.commands.registerCommand('editor.action.clipboardPasteAction', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return vscode.commands.executeCommand('default:paste'); }
            const clipboardContent = await vscode.env.clipboard.readText();

            isPasting = true;
            await editor.edit(editBuilder => editBuilder.replace(editor.selection, clipboardContent));
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
                if (token.isCancellationRequested || !explanation) { return; }

                lastExplanation = explanation;

                // --- PRELOAD QUIZ IN BACKGROUND ---
                generateQuiz(lastExplanation, apiKey)
                    .then(data => {
                        if (data?.questions) {
                            quizQuestions = data.questions;
                        }
                    })
                    .catch(err => console.error('Quiz pre-generation failed:', err));

                // --- SHOW EXPLANATION CHUNKS ---
                await showExplanationInChunks(explanation);
            });
        })
    );

    vscode.commands.executeCommand('code-sensei.showAvatar');

    function indexPastedCode(content: string) {
        if (content.trim().length > 0) {
            pastedCode.push(content);
        }
    }

    // --- TYPING DETECTION ---
    vscode.workspace.onDidChangeTextDocument(event => {
        if (isPasting) { return; }
        if (event.contentChanges.length > 0 &&
            event.reason !== vscode.TextDocumentChangeReason.Undo &&
            event.reason !== vscode.TextDocumentChangeReason.Redo
        ) {
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
        const ratio = totalLength === 0 ? 1 : writtenLength / totalLength;
        statusBar.text = `✍️ Hand-Written: ${(ratio * 100).toFixed(1)}%`;
        statusBar.show();
    }
    updateStatusBar();
    const intervalId = setInterval(updateStatusBar, 1000);
    context.subscriptions.push({ dispose: () => clearInterval(intervalId) });

    // --- AVATAR WEBVIEW ---
    const showAvatar = vscode.commands.registerCommand(
        'code-sensei.showAvatar',
        () => {
            const panel = vscode.window.createWebviewPanel(
                'codeSenseiAvatar',
                'Code Sensei Avatar',
                vscode.ViewColumn.Beside,
                { enableScripts: true }
            );

            panel.webview.html = getAvatarWebviewContent(panel.webview, context.extensionUri);
            panel.webview.onDidReceiveMessage(async message => {
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
                        if (token.isCancellationRequested || !explanation) {
                            return;
                        }

                        lastExplanation = explanation;

                        // --- PRELOAD QUIZ FOR SELECTED CODE ---
                        generateQuiz(lastExplanation, apiKey)
                            .then(data => {
                                if (data?.questions) {
                                    quizQuestions = data.questions;
                                }
                            })
                            .catch(err => console.error('Quiz pre-generation failed:', err));

                        await showExplanationInChunks(explanation);
                    });
                }
            });
        }
    );
    context.subscriptions.push(showAvatar);

    // --- QUIZ COMMAND ---
    context.subscriptions.push(
        vscode.commands.registerCommand('code-sensei.startQuiz', async () => {
            if (!lastExplanation) {
                return vscode.window.showErrorMessage("No explanation to quiz off of.");
            }
            if (!quizQuestions) {
                return vscode.window.showInformationMessage("Quiz is still generating—give it a sec!");
            }

            createQuizWebview({ questions: quizQuestions });
        })
    );

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
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey });
        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                messages: [
                    { role: "system", content: "You are an expert programmer. Explain the following code snippet clearly and concisely." },
                    { role: "user", content: `Explain this code:\n\n\`\`\`\n${code}\n\`\`\`` }
                ],
            });
            return token.isCancellationRequested ? null : completion.choices[0]?.message?.content || null;
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
=======
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
                #senseiMessage {
                    width: 90%;
                    max-height: 60%;
                    margin: 10px 0;
                    padding: 10px;
                    border: 1px solid #3c3c3c;
                    border-radius: 4px;
                    background-color: #252526;
                    color: white;
                    overflow-y: auto;
                    word-wrap: break-word;
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
            <div id="senseiMessage">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. 
            </div>
            <button onclick="vscode.postMessage({ command: 'explainSelectedCode' })">Explain Selected Code</button>
            <script>
                const vscode = acquireVsCodeApi();
            </script>
        </body>
        </html>
        `;
    }
>>>>>>> dcdc18a33fab02087f32c488ba02d2e25f0f5fe1

    async function generateQuiz(explanationText: string, apiKey: string): Promise<any | null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey });
        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: `You are a quiz generation expert. Based on the following code explanation, create a quiz with 3-4 questions (1 mcq, 1 fill-in-the-blank, 1 coding). Respond with ONLY a valid JSON object based on this structure: {\"questions\":[{\"type\":\"mcq\"|\"fill-in-the-blank\"|\"coding\",\"question\":\"...\",\"options\":[\"...\"],\"answer\":\"...\"}]}`
                    },
                    { role: "user", content: explanationText }
                ],
            });
            return JSON.parse(completion.choices[0]?.message?.content || 'null');
        } catch (error) {
            console.error("Quiz Generation API Error:", error);
            vscode.window.showErrorMessage('Could not generate a quiz.');
            return null;
        }
    }

    async function gradeQuiz(questions: any[], userAnswers: any, apiKey: string): Promise<{ score: string; feedback: string } | null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey });
        const gradingPrompt = `You are a teaching assistant. Grade the following quiz based on the provided questions and the user's answers. Provide a final score as a fraction (e.g., \"2/3\") and a single sentence of encouraging feedback. Questions and Correct Answers: ${JSON.stringify(questions, null, 2)} User's Answers: ${JSON.stringify(userAnswers, null, 2)} Respond in a JSON object with two keys: \"score\" and \"feedback\".`;
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

    function getAvatarWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        const imageUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'media', 'default_skin', 'idle', 'idle.png')
        );
    }

    function getQuizWebviewContent() {
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
        </body>
        </html>`;
    }
}

export function deactivate() {}
