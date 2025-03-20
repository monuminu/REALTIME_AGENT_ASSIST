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
  const gainNodeRef = useRef(null);
  
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
  
  // Improved playAudioStream implementation
  const playAudioStream = useCallback((audioData, sampleRate) => {
    if (!audioContextRef.current) return;
    
    try {
      // Decode base64 data to ArrayBuffer more efficiently
      const byteCharacters = atob(audioData);
      const byteArray = new Uint8Array(byteCharacters.length);
      
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArray[i] = byteCharacters.charCodeAt(i);
      }
      
      // Create a proper WAV-like header for better decoding
      const audioDataWithHeader = createWavHeader(byteArray, sampleRate, 1, 16);
      
      // Use AudioContext's decodeAudioData with improved error handling
      audioContextRef.current.decodeAudioData(
        audioDataWithHeader, 
        (decodedBuffer) => {
          // Create and configure audio source
          const source = audioContextRef.current.createBufferSource();
          source.buffer = decodedBuffer;
          
          // Apply audio enhancements if available
          if (gainNodeRef.current) {
            // Connect through gain node for volume control
            source.connect(gainNodeRef.current);
          } else {
            source.connect(audioContextRef.current.destination);
          }
          
          source.start(0);
          setIsPlayingAudio(true);
          
          source.onended = () => {
            setIsPlayingAudio(false);
          };
        },
        (error) => {
          console.error("Error decoding audio data:", error);
          
          // Fallback approach for problematic audio
          try {
            // Try direct PCM playback as fallback
            playPcmDirectly(byteArray);
          } catch (fallbackError) {
            console.error("Fallback playback failed:", fallbackError);
          }
        }
      );
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
    const sampleRate = 24000;
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
  
  // Helper function to create proper WAV headers
  function createWavHeader(pcmData, sampleRate, numChannels, bitsPerSample) {
    const dataLength = pcmData.length;
    const headerLength = 44;
    const wavData = new Uint8Array(headerLength + dataLength);
    
    // RIFF header
    setString(wavData, 0, 'RIFF');
    setUint32(wavData, 4, 36 + dataLength, true);
    setString(wavData, 8, 'WAVE');
    
    // fmt chunk
    setString(wavData, 12, 'fmt ');
    setUint32(wavData, 16, 16, true);
    setUint16(wavData, 20, 1, true);
    setUint16(wavData, 22, numChannels, true);
    setUint32(wavData, 24, sampleRate, true);
    setUint32(wavData, 28, sampleRate * numChannels * bitsPerSample / 8, true);
    setUint16(wavData, 32, numChannels * bitsPerSample / 8, true);
    setUint16(wavData, 34, bitsPerSample, true);
    
    // data chunk
    setString(wavData, 36, 'data');
    setUint32(wavData, 40, dataLength, true);
    
    // Copy PCM data
    wavData.set(pcmData, 44);
    
    return wavData.buffer;
  }
  
  // Helper functions for WAV header creation
  function setString(data, offset, string) {
    for (let i = 0; i < string.length; i++) {
      data[offset + i] = string.charCodeAt(i);
    }
  }
  
  function setUint16(data, offset, value, littleEndian) {
    if (littleEndian) {
      data[offset] = value & 0xFF;
      data[offset + 1] = (value >> 8) & 0xFF;
    } else {
      data[offset] = (value >> 8) & 0xFF;
      data[offset + 1] = value & 0xFF;
    }
  }
  
  function setUint32(data, offset, value, littleEndian) {
    if (littleEndian) {
      data[offset] = value & 0xFF;
      data[offset + 1] = (value >> 8) & 0xFF;
      data[offset + 2] = (value >> 16) & 0xFF;
      data[offset + 3] = (value >> 24) & 0xFF;
    } else {
      data[offset] = (value >> 24) & 0xFF;
      data[offset + 1] = (value >> 16) & 0xFF;
      data[offset + 2] = (value >> 8) & 0xFF;
      data[offset + 3] = value & 0xFF;
    }
  }
  
  // Direct PCM playback as a fallback
  function playPcmDirectly(pcmData) {
    if (!audioContextRef.current) return;
    
    // Create a buffer with the right format for PCM
    const buffer = audioContextRef.current.createBuffer(1, pcmData.length / 2, 16000);
    const channelData = buffer.getChannelData(0);
    
    // Convert Uint8Array to Float32Array for AudioBuffer
    for (let i = 0; i < pcmData.length / 2; i++) {
      const sample = (pcmData[i*2] | (pcmData[i*2+1] << 8)) / 32768.0;
      channelData[i] = sample;
    }
    
    // Play the buffer
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.start(0);
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