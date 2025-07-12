import React, { useEffect, useState, useRef } from 'react';
import './styles.css';

declare function acquireVsCodeApi(): {
  postMessage: (msg: any) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi(); // Webview → Extension communication

export default function Avatar() {
  const [imageSrc, setImageSrc] = useState<string>('');
  const [altText, setAltText] = useState<string>('');
  const [bubbleText, setBubbleText] = useState<string>('');
  const [bubbleVisible, setBubbleVisible] = useState<boolean>(false);

  const idleTimer = useRef<NodeJS.Timeout | null>(null);

  // Trigger backend to send a new emotion/pose
  const sendEmotionRequest = (emotion: string) => {
    vscode.postMessage({ command: 'emotion', emotion });
  };

  const resetIdleTimer = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      sendEmotionRequest('idle');
    }, 1000 * 60 * 2); // 2 minutes
  };

  const onAvatarClick = () => {
    sendEmotionRequest('attentive');
    setBubbleVisible((prev) => !prev);
    resetIdleTimer();
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { image, alt, message } = event.data;
      if (image) setImageSrc(image);
      if (alt) setAltText(alt);
      if (message) {
        setBubbleText(message);
        setBubbleVisible(true);
      }
      resetIdleTimer();
    };

    window.addEventListener('message', handleMessage);
    resetIdleTimer();

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div id="avatar-container" onClick={onAvatarClick}>
      <img src={imageSrc} alt={altText} width={200} draggable={false} />
      {bubbleVisible && <div className="speech-bubble">{bubbleText}</div>}
    </div>
  );
}
