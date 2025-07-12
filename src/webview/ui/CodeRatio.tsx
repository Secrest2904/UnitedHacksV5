// src/webview/ui/CodeRatio.tsx
import React from 'react';

interface CodeRatioProps {
  ratio: number; // Value from 0 to 1
}

const CodeRatio: React.FC<CodeRatioProps> = ({ ratio }) => {
  const percentage = (ratio * 100).toFixed(1);

  return (
    <div className="code-ratio-container">
      <p>✍️ Hand-Written Code: <strong>{percentage}%</strong></p>
      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export default CodeRatio;