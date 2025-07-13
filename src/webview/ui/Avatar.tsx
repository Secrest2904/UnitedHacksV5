import React, { useEffect, useState } from 'react';

const Avatar: React.FC = () => {
  const [image, setImage] = useState<string>(''); // Start with blank or default

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.command === 'setEmotion' && event.data.image) {
        setImage(event.data.image);
        console.log('[Avatar] Updating image to', event.data.image);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      {image && <img src={image} style={{ height: '200px' }} alt="Avatar" />}
    </div>
  );
};

export default Avatar;
