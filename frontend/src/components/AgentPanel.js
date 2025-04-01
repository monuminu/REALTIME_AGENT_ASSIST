import React, { useState, useEffect } from 'react';
import './AgentPanel.css';

const AgentPanel = ({ callStatus, currentCall, recommendation, sentiment }) => {
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

  // Get sentiment color and label
  const getSentimentInfo = () => {
    const confidenceScores = sentiment?.confidenceScores || { positive: 0, neutral: 0, negative: 0 };
    
    // Calculate dominant sentiment
    const dominantSentiment = Object.keys(confidenceScores).reduce(
      (max, key) => confidenceScores[key] > confidenceScores[max] ? key : max, 
      Object.keys(confidenceScores)[0]
    );
    
    // Determine color and label based on dominant sentiment
    switch(dominantSentiment) {
      case 'positive':
        return { 
          color: '#4caf50', 
          label: 'Positive',
          score: confidenceScores.positive
        };
      case 'neutral':
        return { 
          color: '#ffeb3b', 
          label: 'Neutral',
          score: confidenceScores.neutral
        };
      case 'negative':
        return { 
          color: '#f44336', 
          label: 'Negative',
          score: confidenceScores.negative
        };
      default:
        return { 
          color: '#ffeb3b', 
          label: 'Neutral',
          score: 0 
        };
    }
  };

  const { color, label, score } = getSentimentInfo();
  
  // Calculate needle position based on confidenceScores
  const calculateNeedlePosition = () => {
    const confidenceScores = sentiment?.confidenceScores || { positive: 0, neutral: 0, negative: 0 };
    
    // Calculate weighted position: -1 (negative) to +1 (positive)
    // where negative has full weight on left side, positive on right side, and neutral in middle
    const position = confidenceScores.positive - confidenceScores.negative;
    
    // Convert to degrees for the needle (mapping -1...1 to -90...90)
    return position * 90;
  };
  
  return (
    <div className="agent-panel">
      {callStatus === 'connected' && (
        <div className="sentiment-meter">
          <h3>Customer Sentiment</h3>
          <div className="sentiment-container">
            <div className="sentiment-gauge">
              <div className="sentiment-gauge-background">
                <div className="sentiment-gradient"></div>
              </div>
              <div 
                className="sentiment-needle" 
                style={{ transform: `rotate(${calculateNeedlePosition()}deg)` }}
              ></div>
            </div>
            <div className="sentiment-value" style={{ color }}>
              {label}
              <span className="sentiment-score">({(score || 0).toFixed(2)})</span>
            </div>
          </div>
        </div>
      )}
      

      


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