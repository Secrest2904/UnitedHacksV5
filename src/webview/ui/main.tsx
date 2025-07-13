import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// This is a global declaration for the VS Code API
declare global {
    interface Window {
        acquireVsCodeApi(): {
            postMessage: (msg: any) => void;
            getState: () => any;
            setState: (newState: any) => void;
        };
    }
}

// ======================================================================
//  THE FIX IS HERE:
//  Acquire the vscode API *once* at the top level of the script.
// ======================================================================
const vscode = window.acquireVsCodeApi();

// --- TYPE DEFINITIONS ---
type View = 'IDLE' | 'EXPLANATION' | 'QUIZ' | 'QUIZ_RESULT' | 'EDUCATION_PLAN';

type QuizQuestion = {
    type: 'mcq' | 'fill-in-the-blank' | 'coding';
    question: string;
    options?: string[];
};

type EducationPlan = {
    topicsToStudy: string[];
    assignments: { title: string; description: string }[];
};

// --- MAIN APP COMPONENT ---
const App = () => {
    const [view, setView] = useState<View>('IDLE');
    const [explanation, setExplanation] = useState('');
    const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
    const [quizResult, setQuizResult] = useState<{ score: string, feedback: string } | null>(null);
    const [educationPlan, setEducationPlan] = useState<EducationPlan | null>(null);

    // --- MESSAGE LISTENER FROM EXTENSION ---
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            // Add this log to see incoming messages in the webview dev tools
            console.log("📬 Message received in webview:", message);
            switch (message.command) {
                case 'showExplanation':
                    setExplanation(message.data);
                    setView('EXPLANATION');
                    break;
                case 'startQuiz':
                    setQuizQuestions(message.data.questions);
                    setView('QUIZ');
                    break;
                case 'showQuizResult':
                    setQuizResult(message.data);
                    setView('QUIZ_RESULT');
                    break;
                case 'showEducationPlan':
                    setEducationPlan(message.data);
                    setView('EDUCATION_PLAN');
                    break;
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // --- UI RENDER LOGIC ---
    return (
        <div id="main-container">
            <div className="content-area">
                {view === 'IDLE' && <IdleView />}
                {view === 'EXPLANATION' && <ExplanationView text={explanation} />}
                {view === 'QUIZ' && <QuizView questions={quizQuestions} />}
                {view === 'QUIZ_RESULT' && quizResult && <QuizResultView result={quizResult} />}
                {view === 'EDUCATION_PLAN' && educationPlan && <EducationPlanView plan={educationPlan} />}
            </div>
        </div>
    );
};

// --- VIEW COMPONENTS ---

const IdleView = () => (
    <>
        <h2>🧠 AI Mentor</h2>
        <p>Paste a block of code into your editor, and I'll explain it to you. Or select code and click below.</p>
        {/* This button demonstrates using the single `vscode` constant */}
        <button onClick={() => vscode.postMessage({ command: 'explainSelectedCode' })}>
            Explain Selected Code
        </button>
    </>
);

const ExplanationView = ({ text }: { text: string }) => (
    <>
        <h2>Code Explanation</h2>
        <p className="explanation-text">{text}</p>
        <button onClick={() => vscode.postMessage({ command: 'startQuiz' })}>
            Start Quiz
        </button>
    </>
);

const QuizView = ({ questions }: { questions: QuizQuestion[] }) => {
    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const answers: { [key: string]: string } = {};

        for (let i = 0; i < form.elements.length; i++) {
            const element = form.elements[i];

            if (element instanceof HTMLInputElement) {
                if (element.type === 'radio') {
                    if (element.checked) {
                        answers[element.name] = element.value;
                    }
                } else if (element.type !== 'submit') {
                    answers[element.name] = element.value;
                }
            }
            else if (element instanceof HTMLTextAreaElement) {
                answers[element.name] = element.value;
            }
        }

        vscode.postMessage({ command: 'submitQuiz', answers });
    };

    return (
        <form onSubmit={handleSubmit}>
            <h2>Comprehension Quiz</h2>
            {questions.map((q, index) => (
                <div key={index} className="question-block">
                    <h3>Question {index + 1}: {q.question}</h3>
                    {q.type === 'mcq' && q.options?.map(opt => (
                        <label key={opt}><input type="radio" name={`q${index}`} value={opt} required /> {opt}</label>
                    ))}
                    {q.type === 'fill-in-the-blank' && (
                        <input type="text" name={`q${index}`} placeholder="Your answer..." required />
                    )}
                    {q.type === 'coding' && (
                        <textarea name={`q${index}`} rows={5} placeholder="Write your code here..." required />
                    )}
                </div>
            ))}
            <button type="submit">Submit Answers</button>
        </form>
    );
};

const QuizResultView = ({ result }: { result: { score: string, feedback: string } }) => (
    <>
        <h2>Quiz Result</h2>
        <p className="score">You scored: <strong>{result.score}</strong></p>
        <p className="feedback"><em>"{result.feedback}"</em></p>
        <button onClick={() => vscode.postMessage({ command: 'generateEducationPlan' })}>
            Create My Education Plan
        </button>
    </>
);

const EducationPlanView = ({ plan }: { plan: EducationPlan }) => (
    <div className="education-plan">
        <h2>Your Personalized Education Plan</h2>

        <div className="plan-section">
            <h3>Topics to Study</h3>
            <ul>
                {plan.topicsToStudy.map(topic => <li key={topic}>{topic}</li>)}
            </ul>
        </div>

        <div className="plan-section">
            <h3>Suggested Assignments</h3>
            {plan.assignments.map(assignment => (
                <div key={assignment.title} className="assignment-card">
                    <h4>{assignment.title}</h4>
                    <p>{assignment.description}</p>
                </div>
            ))}
        </div>
    </div>
);


const rootElement = document.getElementById('root');
if (rootElement) {
    createRoot(rootElement).render(<App />);
}