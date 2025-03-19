import React, { useEffect, useRef } from 'react';
import './TranscriptionPanel.css';

const TranscriptionPanel = ({ transcriptions, clearTranscriptions }) => {
  const transcriptionEndRef = useRef(null);
  
  // Auto-scroll to bottom when new transcriptions arrive
  useEffect(() => {
    if (transcriptionEndRef.current) {
      transcriptionEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcriptions]);
  
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  return (
    <div className="transcription-panel">
      <div className="transcription-header">
        <h2>Live Transcription</h2>
        <button 
          className="clear-button" 
          onClick={clearTranscriptions}
          disabled={transcriptions.length === 0}
        >
          Clear All
        </button>
      </div>
      
      <div className="transcription-content">
        {transcriptions.length === 0 ? (
          <div className="no-transcriptions">
            No transcriptions yet. Start a call to see transcriptions appear here.
          </div>
        ) : (
          transcriptions.map((item, index) => (
            <div key={index} className="transcription-item">
              <div className="transcription-time">
                {formatTimestamp(item.timestamp)}
              </div>
              <div className="transcription-text">
                {item.text}
              </div>
            </div>
          ))
        )}
        <div ref={transcriptionEndRef} />
      </div>
    </div>
  );
};

export default TranscriptionPanel;