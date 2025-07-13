import * as vscode from 'vscode';
import OpenAI from 'openai';
import * as path from 'path';

const API_SECRET_KEY_STORE = 'codesensei_api_key';

// For tracking history
type LearningHistoryItem = {
    code: string;
    explanation: string;
    quizResult?: { score: string; feedback: string };
};

export function activate(context: vscode.ExtensionContext) {
    console.log('[CodeSensei] activate()');

    // --- STATE ---
    let webviewPanel: vscode.WebviewPanel | undefined;
    const learningHistory: LearningHistoryItem[] = [];
    let lastExplanation = '';
    let lastPastedCode = '';
    let quizQuestions: any = null;

    // --- COMMAND: Clear stored API key ---
    context.subscriptions.push(
        vscode.commands.registerCommand('code-sensei.clearApiKey', async () => {
            console.log('[CodeSensei] clearApiKey');
            await context.secrets.delete(API_SECRET_KEY_STORE);
            vscode.window.showInformationMessage('Code Sensei: Stored API Key cleared');
        })
    );

    // --- COMMAND: Paste & Explain (bound to Ctrl+V / ⌘+V) ---
    context.subscriptions.push(
        vscode.commands.registerCommand('code-sensei.pasteAndExplain', async () => {
            console.log('[CodeSensei] pasteAndExplain invoked');
            // 1) Perform the actual paste
            await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
            console.log('[CodeSensei] — pasted successfully; now explaining');
            // 2) Then run the explanation flow
            await handleExplainSelectedCode();
        })
    );

    // --- COMMAND: Show React-based Webview UI ---
    const showAvatarCmd = vscode.commands.registerCommand('code-sensei.showAvatar', () => {
        console.log('[CodeSensei] showAvatar');
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

        // **LOAD YOUR REACT SHELL** (main.js + styles.css)
        webviewPanel.webview.html = getReactWebviewContent(webviewPanel.webview, context.extensionUri);

        webviewPanel.onDidDispose(() => {
            console.log('[CodeSensei] webview disposed');
            webviewPanel = undefined;
        }, null, context.subscriptions);

        webviewPanel.webview.onDidReceiveMessage(async message => {
            console.log('[CodeSensei] ⇐ message from webview:', message);
            switch (message.command) {
                case 'explainSelectedCode':
                    console.log('[CodeSensei] command=explainSelectedCode');
                    await handleExplainSelectedCode();
                    break;
                case 'startQuiz':
                    console.log('[CodeSensei] command=startQuiz');
                    if (!lastExplanation) {
                        vscode.window.showErrorMessage('No explanation available to quiz.');
                        return;
                    }
                    await startQuiz(lastExplanation);
                    break;
                case 'submitQuiz':
                    console.log('[CodeSensei] command=submitQuiz', message.answers);
                    await gradeAndProcessQuiz(message.answers);
                    break;
                case 'generateEducationPlan':
                    console.log('[CodeSensei] command=generateEducationPlan');
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Code Sensei: Generating Education Plan…'
                    }, async () => {
                        const apiKey = await getApiKey();
                        if (!apiKey || !webviewPanel) return;
                        const plan = await generateEducationPlan(learningHistory, apiKey);
                        webviewPanel?.webview.postMessage({ command: 'showEducationPlan', data: plan });
                    });
                    break;
            }
        }, undefined, context.subscriptions);
    });
    context.subscriptions.push(showAvatarCmd);

    // --- CORE: handle explain logic ---
    async function handleExplainSelectedCode() {
        console.log('[CodeSensei] handleExplainSelectedCode()');
        const editor = vscode.window.activeTextEditor;
        console.log('[CodeSensei]  active editor:', !!editor);
        if (!editor) {
            vscode.window.showErrorMessage('No active editor to explain code from.');
            return;
        }
        const code = editor.document.getText(editor.selection);
        console.log('[CodeSensei]  selected code:', code.replace(/\n/g, '⏎'));
        if (!code.trim()) {
            vscode.window.showErrorMessage('Please select some code to explain.');
            return;
        }
        const apiKey = await getApiKey();
        if (!apiKey) {
            console.log('[CodeSensei]  no API key—aborting');
            return;
        }
        if (!webviewPanel) {
            console.log('[CodeSensei]  opening webview panel');
            await vscode.commands.executeCommand('code-sensei.showAvatar');
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Code Sensei: Generating explanation…',
            cancellable: true
        }, async (progress, token) => {
            console.log('[CodeSensei]  calling getCodeExplanation()');
            const explanation = await getCodeExplanation(code, apiKey, token);
            console.log('[CodeSensei]  explanation received:', explanation);
            if (token.isCancellationRequested) {
                console.log('[CodeSensei]  user cancelled');
                return;
            }
            lastExplanation = explanation || '';
            lastPastedCode = code;
            webviewPanel?.webview.postMessage({ command: 'showExplanation', data: explanation });
        });
    }

    // --- HELPER & API FUNCTIONS ---
    async function startQuiz(explanation: string) {
        const apiKey = await getApiKey();
        if (!apiKey || !webviewPanel) return;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Code Sensei: Generating Quiz…"
        }, async () => {
            const quizData = await generateQuiz(explanation, apiKey);
            if (quizData?.questions) {
                quizQuestions = quizData.questions;
                webviewPanel!.webview.postMessage({ command: 'startQuiz', data: quizData });
            } else {
                vscode.window.showErrorMessage('Failed to generate quiz.');
            }
        });
    }

    async function gradeAndProcessQuiz(answers: any) {
        const apiKey = await getApiKey();
        if (!apiKey || !webviewPanel) return;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Code Sensei: Grading Quiz…"
        }, async () => {
            const result = await gradeQuiz(quizQuestions, answers, apiKey);
            if (result) {
                learningHistory.push({ code: lastPastedCode, explanation: lastExplanation, quizResult: result });
                webviewPanel!.webview.postMessage({ command: 'showQuizResult', data: result });
            } else {
                vscode.window.showErrorMessage('Failed to grade quiz.');
            }
        });
    }

    async function getApiKey(): Promise<string|undefined> {
        let apiKey = await context.secrets.get(API_SECRET_KEY_STORE);
        if (!apiKey) {
            apiKey = await vscode.window.showInputBox({
                prompt: 'Enter your OpenRouter API Key',
                password: true,
                ignoreFocusOut: true,
                placeHolder: 'sk-…'
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

    async function getCodeExplanation(code: string, apiKey: string, token: vscode.CancellationToken): Promise<string|null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey });
        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                messages: [
                  { role: "system", content: "You are an expert programmer. Explain this code clearly." },
                  { role: "user", content: `\`\`\`\n${code}\n\`\`\`` }
                ],
            });
            return token.isCancellationRequested ? null : completion.choices[0]?.message?.content || null;
        } catch (e) {
            console.error('[CodeSensei] getCodeExplanation error', e);
            vscode.window.showErrorMessage('API error fetching explanation.');
            return null;
        }
    }

    async function generateQuiz(explanation: string, apiKey: string): Promise<{ questions: any[] } | null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey });
        const quizPrompt = `
        You are a quiz‐generation expert. Based on the following code explanation, create exactly three questions:

        1. A multiple‐choice question (type: "mcq") with FOUR distinct options, and specify which option is correct.
        2. A fill‐in‐the‐blank question (type: "fill-in-the-blank") with no options.
        3. A short coding challenge (type: "coding") with no options.

        Respond with ONLY valid JSON in this format — no extra text:

        {
        "questions": [
            {
            "type": "mcq",
            "question": "Your question text here?",
            "options": ["opt1","opt2","opt3","opt4"],
            "answer": "opt2"
            },
            {
            "type": "fill-in-the-blank",
            "question": "Your fill-in-the-blank text here with ____.",
            "options": null,
            "answer": "the correct word"
            },
            {
            "type": "coding",
            "question": "Your coding challenge prompt here.",
            "options": null,
            "answer": "example solution code"
            }
        ]
        }
        ---
        Here is the explanation to quiz on:
        ${explanation}
        `;

        try {
            const completion = await openai.chat.completions.create({
            model: "tngtech/deepseek-r1t2-chimera:free",
            messages: [
                { role: "system", content: quizPrompt.trim() }
            ]
            });

            // Pull out the raw content
            let raw = completion.choices[0]?.message?.content || "";
            console.log("[CodeSensei] raw quiz response:", raw);

            // Strip any ```json or ``` fences
            raw = raw
            .replace(/^```(?:json)?\s*/, "")
            .replace(/```$/, "")
            .trim();

            // Parse it
            const data = JSON.parse(raw);
            console.log("[CodeSensei] parsed quiz data:", data);

            // Basic sanity check
            if (!data.questions || !Array.isArray(data.questions) || data.questions.length !== 3) {
            throw new Error("Quiz JSON missing 3 questions");
            }

            return data;
        } catch (e) {
            console.error("[CodeSensei] generateQuiz error:", e);
            vscode.window.showErrorMessage("Failed to generate quiz — check Extension Host log for details.");
            return null;
        }
    }

    async function gradeQuiz(questions: any[], answers: any, apiKey: string)
        : Promise<{score:string;feedback:string}|null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey });
        const prompt = `Grade these questions ${JSON.stringify(questions)} with answers ${JSON.stringify(answers)}.`;
        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                response_format: { type: "json_object" },
                messages: [{ role: "system", content: prompt }]
            });
            return JSON.parse(completion.choices[0]?.message?.content || 'null');
        } catch (e) {
            console.error('[CodeSensei] gradeQuiz error', e);
            return null;
        }
    }

    async function generateEducationPlan(history: LearningHistoryItem[], apiKey: string): Promise<any|null> {
        const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1/", apiKey });
        const hist = history.map(h => `Code: ${h.code.slice(0,30)}… Score: ${h.quizResult?.score}`).join('\n');
        const prompt = `Based on:\n${hist}\nGenerate a study plan JSON: {topicsToStudy:[], assignments:[]}`;
        try {
            const completion = await openai.chat.completions.create({
                model: "tngtech/deepseek-r1t2-chimera:free",
                response_format: { type: "json_object" },
                messages: [{ role: "system", content: prompt }]
            });
            return JSON.parse(completion.choices[0]?.message?.content || 'null');
        } catch (e) {
            console.error('[CodeSensei] generateEducationPlan error', e);
            return null;
        }
    }
}

// --- Loads your compiled React bundle (main.js + main.css) into the webview ---
function getReactWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
    const styleUri  = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));
    const nonce     = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet"/>
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
    for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

export function deactivate() {
    console.log('[CodeSensei] deactivate()');
}