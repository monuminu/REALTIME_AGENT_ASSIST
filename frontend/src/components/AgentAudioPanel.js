import React, { useState, useEffect, useRef, useCallback } from 'react';
import './AgentAudioPanel.css';

function AgentAudioPanel({ callId, wsBaseUrl }) {
  const [isMuted, setIsMuted] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  
  const streamRef = useRef(null);
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamSourcesRef = useRef(new Map());
  
  // Move getRawMicrophoneStream BEFORE startStreaming
  const getRawMicrophoneStream = useCallback(async () => {
    try {
      // Request microphone access using browser API
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Create audio context source for this stream
      if (audioContextRef.current) {
        const source = audioContextRef.current.createMediaStreamSource(stream);
        mediaStreamSourcesRef.current.set('local', source);
      }
      
      return stream;
    } catch (error) {
      console.error('Error accessing microphone:', error);
      throw error;
    }
  }, []);
  
  // Function to handle incoming audio data
  const playAudioStream = useCallback((audioData, sampleRate) => {
    if (!audioContextRef.current) return;
    
    try {
      // Decode base64 data to ArrayBuffer
      const byteCharacters = atob(audioData);
      const byteArray = new Uint8Array(byteCharacters.length);
      
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArray[i] = byteCharacters.charCodeAt(i);
      }
      
      // Convert to 16-bit PCM audio
      const audioBuffer = new Int16Array(byteArray.buffer);
      
      // Convert to float32 for Web Audio API
      const float32Audio = new Float32Array(audioBuffer.length);
      for (let i = 0; i < audioBuffer.length; i++) {
        float32Audio[i] = audioBuffer[i] / 32768.0;
      }
      
      // Create audio buffer and source
      const buffer = audioContextRef.current.createBuffer(1, float32Audio.length, sampleRate);
      buffer.getChannelData(0).set(float32Audio);
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.start(0);
      setIsPlayingAudio(true);
      
      // Reset playing indicator when audio finishes
      source.onended = () => {
        setIsPlayingAudio(false);
      };
    } catch (error) {
      console.error('Error playing audio stream:', error);
    }
  }, []);
  
  // Now define startStreaming after getRawMicrophoneStream is defined
  const startStreaming = useCallback(async () => {
    try {
      const stream = await getRawMicrophoneStream();
      streamRef.current = stream;
      
      // Set up audio processing and sending
      if (audioContextRef.current && wsRef.current) {
        const processor = audioContextRef.current.createScriptProcessor(2048, 1, 1);
        const source = mediaStreamSourcesRef.current.get('local');
        
        source.connect(processor);
        processor.connect(audioContextRef.current.destination);
        
        processor.onaudioprocess = (e) => {
          // Only send audio if WebSocket is connected and not muted
          if (wsRef.current.readyState === WebSocket.OPEN && !isMuted) {
            // Get audio data from input channel
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Convert to format suitable for WebSocket (e.g., 16-bit PCM)
            const pcmData = convertFloatToInt16(inputData);
            
            // Send audio data
            wsRef.current.send(pcmData.buffer);
          }
        };
      }
    } catch (error) {
      console.error('Error starting audio stream:', error);
      setError('Failed to access microphone');
    }
  }, [isMuted, getRawMicrophoneStream]);
  
  // Set up WebSocket connection and microphone stream when component mounts
  useEffect(() => {
    // Create audio context with 16kHz sample rate
    const sampleRate = 16000;
    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: sampleRate
    });
    
    // Establish WebSocket connection for audio
    console.log('Connecting to audio WebSocket:', `${wsBaseUrl}/ws/audio/${callId}`);
    const audioWs = new WebSocket(`${wsBaseUrl}/ws/audio/${callId}`);
    
    audioWs.onopen = () => {
      console.log('Audio WebSocket connection established');
      setIsConnected(true);
      
      // Send audio metadata first
      const metadata = {
        kind: "AudioMetadata",
        audioMetadata: {
          sampleRate: sampleRate,
          channels: 1,
          bitsPerSample: 16
        }
      };
      audioWs.send(JSON.stringify(metadata));
      
      // Start streaming audio once connection is established
      startStreaming();
    };
    
    audioWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === "audioStream") {
          console.log('Received audio stream data');
          playAudioStream(data.data, data.sampleRate);
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };
    
    audioWs.onclose = () => {
      console.log('Audio WebSocket connection closed');
      setIsConnected(false);
      stopStreaming();
    };
    
    audioWs.onerror = (error) => {
      console.error('Audio WebSocket error:', error);
      //setError('Failed to connect audio');
    };
    
    wsRef.current = audioWs;
    
    // Clean up on unmount
    return () => {
      stopStreaming();
      if (audioWs) {
        audioWs.close();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [callId, wsBaseUrl, startStreaming, playAudioStream]);
  
  // Toggle mute state
  const toggleMute = () => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = isMuted; // If currently muted, enable tracks and vice versa
      });
      setIsMuted(!isMuted);
    }
  };
  
  // Stop streaming audio
  const stopStreaming = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };
  
  // Helper function to convert audio data format
  function convertFloatToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Convert from [-1.0, 1.0] float to [-32768, 32767] int
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }
  
  return (
    <div className="agent-audio-panel">
      <h3>Agent Audio Controls</h3>
      {error && <div className="error-message">{error}</div>}
      
      <div className="audio-controls">
        <button 
          onClick={toggleMute} 
          className={isMuted ? "mute-button muted" : "mute-button"}
        >
          {isMuted ? "Unmute Microphone" : "Mute Microphone"}
        </button>
        
        <div className="status-indicator">
          {isConnected ? (
            <span className="connected">Audio Connected</span>
          ) : (
            <span className="disconnected">Audio Disconnected</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default AgentAudioPanel;