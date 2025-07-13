// File: webview/ui/Avatar.tsx
import React, { useEffect, useState, useRef } from 'react';
import './styles.css';

declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

export default function Avatar() {
  const [imageSrc,setImageSrc] = useState('');
  const [altText,setAltText] = useState('');
  const [bubbleText,setBubbleText] = useState('');
  const idleTimer = useRef<NodeJS.Timeout|null>(null);

  useEffect(()=>{
    const onMsg = (e:MessageEvent)=>{
      console.log('Avatar got message:',e.data);
      if(e.data.image) setImageSrc(e.data.image);
      if(e.data.alt) setAltText(e.data.alt);
      if(e.data.message) setBubbleText(e.data.message);
    };
    window.addEventListener('message',onMsg);
    return ()=> window.removeEventListener('message',onMsg);
  },[]);

  return (
    <div onClick={()=>{ vscode.postMessage({command:'emotion',emotion:'attentive'}); }}>
      <img src={imageSrc} alt={altText} width={200} draggable={false}/>
      {bubbleText && <div className="speech-bubble">{bubbleText}</div>}
    </div>
  );
}