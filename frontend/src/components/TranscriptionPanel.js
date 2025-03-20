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
            <div 
              key={index} 
              className={`transcription-item ${item.speaker === 'agent' ? 'agent-speech' : 'customer-speech'}`}
            >
              <span className="speaker-label">{item.speaker === 'agent' ? 'Agent' : 'Customer'}:</span>
              <span className="transcription-text">{item.text}</span>
              {item.timestamp && (
                <span className="transcription-time">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>
          ))
        )}
        <div ref={transcriptionEndRef} />
      </div>
    </div>
  );
};

export default TranscriptionPanel;