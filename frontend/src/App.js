import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import CallPanel from './components/CallPanel';
import TranscriptionPanel from './components/TranscriptionPanel';
import AgentPanel from './components/AgentPanel';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import AgentAudioPanel from './components/AgentAudioPanel';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;

function App() {
  const [callStatus, setCallStatus] = useState('idle'); // idle, initiating, connected, disconnected
  const [currentCall, setCurrentCall] = useState(null);
  const [transcriptions, setTranscriptions] = useState([]);
  const [agentId] = useState(`agent-${Math.floor(Math.random() * 1000)}`);
  const [connected, setConnected] = useState(false);
  
  const wsRef = useRef(null);
  
  const connectWebSocket = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    const ws = new WebSocket(`${API_BASE_URL}/ws/agent/${agentId}`);
    
    ws.onopen = () => {
      console.log('WebSocket connection established');
      setConnected(true);
      toast.success('Connected to server');
    };
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'callStatus':
          handleCallStatusUpdate(message);
          break;
        case 'transcription':
          handleTranscription(message);
          break;
        case 'transcriptions':
          setTranscriptions(message.data);
          break;
        case 'error':
          toast.error(message.message);
          break;
        default:
          console.log('Received message:', message);
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket connection closed');
      setConnected(false);
      toast.error('Disconnected from server');
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      toast.error('WebSocket connection error');
    };
    
    wsRef.current = ws;
  }, [agentId]); // Add agentId as a dependency
  
  useEffect(() => {
    // Connect to WebSocket when component mounts
    connectWebSocket();
    
    // Clean up on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]); // Add connectWebSocket as a dependency
  
  const handleCallStatusUpdate = (message) => {
    setCallStatus(message.status);
    
    switch (message.status) {
      case 'initiated':
        setCurrentCall({
          id: message.callId,
          to: message.to,
          from: message.from,
          startTime: new Date()
        });
        toast.info(`Call to ${message.to} initiated`);
        break;
      case 'connected':
        setCurrentCall(prev => prev && {
          ...prev,
          connectedTime: new Date()
        });
        toast.success('Call connected');
        break;
      case 'disconnected':
        setCurrentCall(prev => prev && {
          ...prev,
          endTime: new Date(),
          duration: prev.connectedTime ? 
            (new Date() - prev.connectedTime) / 1000 : 0
        });
        toast.info('Call disconnected');
        break;
      default:
        break;
    }
  };
  
  const handleTranscription = (message) => {
    setTranscriptions(prev => [...prev, {
      timestamp: message.timestamp,
      text: message.text
    }]);
  };
  
  const initiateCall = async (phoneNumber, botId) => {
    try {
      setCallStatus('initiating');
      
      const response = await fetch(`${API_BASE_URL}/api/outboundCall`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phoneNumber,
          botId
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to initiate call');
      }
      
      console.log('Call initiated:', data);
      
      // We'll get the call status updates via WebSocket
    } catch (error) {
      console.error('Error initiating call:', error);
      toast.error(`Failed to initiate call: ${error.message}`);
      setCallStatus('idle');
    }
  };
  
  const endCall = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'endCall'
      }));
    }
  };
  
  const clearTranscriptions = () => {
    setTranscriptions([]);
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && currentCall) {
      wsRef.current.send(JSON.stringify({
        type: 'clearTranscription',
        callId: currentCall.id
      }));
    }
  };
  
  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Agent Assist Dashboard</h1>
        <div className="connection-status">
          {connected ? (
            <span className="status-connected">Connected</span>
          ) : (
            <span className="status-disconnected">Disconnected</span>
          )}
        </div>
      </header>
      
      <div className="app-content">
        <div className="left-panel">
          <CallPanel
            callStatus={callStatus}
            currentCall={currentCall}
            initiateCall={initiateCall}
            endCall={endCall}
          />
        </div>
        
        <div className="right-panel">
          <TranscriptionPanel
            transcriptions={transcriptions}
            clearTranscriptions={clearTranscriptions}
          />
          
          <AgentPanel
            callStatus={callStatus}
            currentCall={currentCall}
          />
          
          { callStatus === 'connected' && currentCall && (
            <AgentAudioPanel callId={currentCall.id} wsBaseUrl={API_BASE_URL} />
          )}
        </div>
      </div>
      
      <ToastContainer position="bottom-right" />
    </div>
  );
}

export default App;