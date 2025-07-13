import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// Expose VS Code API inside the webview
declare global {
    interface Window {
        acquireVsCodeApi(): { postMessage(msg: any): void; getState(): any; setState(s: any): void; };
    }
}
const vscode = window.acquireVsCodeApi();

// View & data types
type View = 'IDLE' | 'EXPLANATION' | 'QUIZ' | 'QUIZ_RESULT' | 'EDUCATION_PLAN';
type QuizQuestion = { type: 'mcq'|'fill-in-the-blank'|'coding'; question: string; options?: string[] };
type EducationPlan = { topicsToStudy: string[]; assignments: { title: string; description: string }[] };

const App = () => {
    const [view, setView] = useState<View>('IDLE');
    const [explanation, setExplanation] = useState('');
    const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
    const [quizResult, setQuizResult] = useState<{score:string;feedback:string}|null>(null);
    const [educationPlan, setEducationPlan] = useState<EducationPlan|null>(null);

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            console.log('📬 webview received:', e.data);
            const msg = e.data;
            switch (msg.command) {
                case 'showExplanation':
                    setExplanation(msg.data);
                    setView('EXPLANATION');
                    break;
                case 'startQuiz':
                    setQuizQuestions(msg.data.questions);
                    setView('QUIZ');
                    break;
                case 'showQuizResult':
                    setQuizResult(msg.data);
                    setView('QUIZ_RESULT');
                    break;
                case 'showEducationPlan':
                    setEducationPlan(msg.data);
                    setView('EDUCATION_PLAN');
                    break;
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    return (
        <div id="main-container">
            <div className="content-area">
                {view === 'IDLE'            && <IdleView />}
                {view === 'EXPLANATION'     && <ExplanationView text={explanation} />}
                {view === 'QUIZ'            && <QuizView questions={quizQuestions} />}
                {view === 'QUIZ_RESULT'     && quizResult   && <QuizResultView result={quizResult} />}
                {view === 'EDUCATION_PLAN'  && educationPlan && <EducationPlanView plan={educationPlan} />}
            </div>
        </div>
    );
};

const IdleView = () => (
    <>
      <h2>🧠 AI Mentor</h2>
      <p>Select some code in your editor, then:</p>
      <button onClick={() => {
        console.log('[Webview] IdleView → explainSelectedCode');
        vscode.postMessage({ command: 'explainSelectedCode' });
      }}>
        🔍 Explain Selected Code
      </button>
    </>
);

const ExplanationView = ({ text }: { text: string }) => (
    <>
      <h2>💡 Explanation</h2>
      <pre className="explanation-text">{text}</pre>
      <button onClick={() => {
        console.log('[Webview] ExplanationView → startQuiz');
        vscode.postMessage({ command: 'startQuiz' });
      }}>
        Start Quiz
      </button>
    </>
);

const QuizView = ({ questions }: { questions: QuizQuestion[] }) => {
    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget;
        const answers: any = {};
        Array.from(form.elements).forEach(el => {
            if (el instanceof HTMLInputElement && el.name) {
                if (el.type === 'radio' && el.checked) {
                    answers[el.name] = el.value;
                } else if (el.type === 'text') {
                    answers[el.name] = el.value;
                }
            }
            if (el instanceof HTMLTextAreaElement && el.name) {
                answers[el.name] = el.value;
            }
        });
        console.log('[Webview] QuizView → submitQuiz', answers);
        vscode.postMessage({ command: 'submitQuiz', answers });
    };

    return (
        <form onSubmit={handleSubmit}>
            <h2>📝 Quiz</h2>
            {questions.map((q, i) => (
                <div key={i} className="question-block">
                    <h3>Q{i+1}: {q.question}</h3>
                    {q.type === 'mcq' && q.options?.map(opt => (
                        <label key={opt}>
                          <input type="radio" name={`q${i}`} value={opt} required/> {opt}
                        </label>
                    ))}
                    {q.type === 'fill-in-the-blank' && (
                        <input type="text" name={`q${i}`} placeholder="Answer..." required/>
                    )}
                    {q.type === 'coding' && (
                        <textarea name={`q${i}`} rows={4} placeholder="Your code..." required/>
                    )}
                </div>
            ))}
            <button type="submit">Submit Answers</button>
        </form>
    );
};

const QuizResultView = ({ result }: { result: { score: string; feedback: string } }) => (
    <>
      <h2>🏆 Quiz Result</h2>
      <p className="score">Score: <strong>{result.score}</strong></p>
      <p className="feedback">“{result.feedback}”</p>
      <button onClick={() => {
        console.log('[Webview] QuizResultView → generateEducationPlan');
        vscode.postMessage({ command: 'generateEducationPlan' });
      }}>
        Create Education Plan
      </button>
    </>
);

const EducationPlanView = ({ plan }: { plan: EducationPlan }) => (
    <div className="education-plan">
      <h2>📚 Education Plan</h2>
      <h3>Topics to Study</h3>
      <ul>{plan.topicsToStudy.map(t => <li key={t}>{t}</li>)}</ul>
      <h3>Assignments</h3>
      {plan.assignments.map(a => (
        <div key={a.title} className="assignment-card">
          <h4>{a.title}</h4>
          <p>{a.description}</p>
        </div>
      ))}
    </div>
);

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);