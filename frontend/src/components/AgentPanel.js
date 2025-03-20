import React, { useState, useEffect } from 'react';
import './AgentPanel.css';

const AgentPanel = ({ callStatus, currentCall, recommendation }) => {
  const [notes, setNotes] = useState('');
  const [savedNotes, setSavedNotes] = useState({});
  
  // Load saved notes for the current call
  useEffect(() => {
    if (currentCall?.id) {
      const savedCallNotes = savedNotes[currentCall.id] || '';
      setNotes(savedCallNotes);
    } else {
      setNotes('');
    }
  }, [currentCall?.id, savedNotes]);
  
  const handleSaveNotes = () => {
    if (currentCall?.id) {
      setSavedNotes(prev => ({
        ...prev,
        [currentCall.id]: notes
      }));
      
      // Optional: Save to local storage
      try {
        const storedNotes = JSON.parse(localStorage.getItem('callNotes') || '{}');
        storedNotes[currentCall.id] = notes;
        localStorage.setItem('callNotes', JSON.stringify(storedNotes));
      } catch (error) {
        console.error('Failed to save notes to local storage:', error);
      }
    }
  };
  
  const handleKeyDown = (e) => {
    // Save notes on Ctrl+S or Cmd+S
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSaveNotes();
    }
  };
  
  return (
    <div className="agent-panel">
      <h2>Agent Notes</h2>
      
      <div className="agent-notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Take notes during the call here..."
          disabled={callStatus !== 'connected' && !currentCall}
        />
        
        <div className="notes-actions">
          <button 
            className="save-notes-btn"
            onClick={handleSaveNotes}
            disabled={callStatus !== 'connected' && !currentCall}
          >
            Save Notes
          </button>
        </div>
      </div>
      
      <div className="suggested-responses">
        <h3>Suggested Responses</h3>
        <div className="response-list">
          {callStatus === 'connected' ? (
            <>
              <button className="response-btn">I understand your concern</button>
              <button className="response-btn">Let me check that for you</button>
              <button className="response-btn">Could you please provide more details?</button>
              <button className="response-btn">I'll need to put you on a brief hold</button>
              <button className="response-btn">Thank you for your patience</button>
            </>
          ) : (
            <div className="no-suggestions">
              Suggestions will appear during an active call
            </div>
          )}
        </div>
      </div>

      <div className="suggested-responses">
        <h3>AI Recommendation</h3>
        <div className="response-list">
          {callStatus === 'connected' && recommendation ? (
            <div className="ai-recommendation">
              {recommendation}
            </div>
          ) : (
            <div className="no-suggestions">
              Recommendations will appear during an active call
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentPanel;