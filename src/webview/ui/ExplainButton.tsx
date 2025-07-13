// File: webview/ui/ExplainButton.tsx
import React from 'react';

interface Props { onClick(): void; }

export default function ExplainButton({onClick}:Props) {
  return (
    <button onClick={()=>{
      console.log('🔵 ExplainButton clicked');
      onClick();
    }}>
      🔍 Explain Selected Code
    </button>
  );
}