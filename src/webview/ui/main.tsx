import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import Avatar from './Avatar';
import CodeRatio from './CodeRatio';
import './styles.css';

const App = () => {
  const [ratio, setRatio] = useState(0);

  useEffect(() => {
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'updateRatio') {
        setRatio(message.ratio);
      }
    });
  }, []);

  return (
    <div>
      <Avatar />
      <CodeRatio ratio={ratio} />
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);