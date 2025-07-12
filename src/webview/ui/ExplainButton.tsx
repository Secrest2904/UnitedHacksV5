import React from 'react';

interface ExplainButtonProps {
  onClick: () => void;
}

const ExplainButton: React.FC<ExplainButtonProps> = ({ onClick }) => {
  return (
    <div>
      <button onClick={onClick} style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer' }}>
        🔍 Explain Selected Code
      </button>
    </div>
  );
};

export default ExplainButton;