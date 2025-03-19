import { useEffect, useRef } from 'react';

const AgentAudioPanel = ({ callId, wsBaseUrl }) => {
  const mediaRecorderRef = useRef(null);
  const audioWsRef = useRef(null);

  useEffect(() => {
    if (!callId) return; // No active call

    // Connect to the backend audio endpoint using the callId.
    const ws = new WebSocket(`${wsBaseUrl}/ws/audio/${callId}`);
    ws.onopen = () => {
      console.log('Agent audio websocket connected.');
    };
    ws.onerror = (error) => {
      console.error('Agent audio websocket error:', error);
    };
    audioWsRef.current = ws;

    // Request microphone access.
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        // Start recording with a small timeslice (e.g., 1000ms).
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            // Read data as binary string, then encode to Base64.
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64data = window.btoa(reader.result);
              const message = JSON.stringify({
                kind: "AudioData",
                audioData: { data: base64data }
              });
              if (audioWsRef.current && audioWsRef.current.readyState === WebSocket.OPEN) {
                audioWsRef.current.send(message);
              }
            };
            reader.readAsBinaryString(event.data);
          }
        };
        mediaRecorder.start(1000); // send audio chunks every 1 second.
        mediaRecorderRef.current = mediaRecorder;
      })
      .catch(err => {
        console.error("Error accessing microphone:", err);
      });

    return () => {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      if (audioWsRef.current) {
        audioWsRef.current.close();
      }
    };
  }, [callId, wsBaseUrl]);

  return null;
};

export default AgentAudioPanel;