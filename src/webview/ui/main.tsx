import React from 'react';
import { createRoot } from 'react-dom/client';
import ExplainButton from './ExplainButton';
import Avatar from './Avatar';
import './styles.css';

declare function acquireVsCodeApi(): {
  postMessage: (msg: any) => void;
};

const App = () => {
  const sendMessageToExtension = () => {
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'EXPLAIN_SELECTED_CODE' });
  };

  return (
    <div style={{ padding: '1rem', fontFamily: 'sans-serif', color: 'white', backgroundColor: '#1e1e1e' }}>
        <Avatar />
        <h2>🧠 AI Mentor</h2>
        <p>Select some code in your editor, then click the button below to get an explanation.</p>
        <ExplainButton onClick={sendMessageToExtension} />
    </div>
    );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}