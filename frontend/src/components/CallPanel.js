import React, { useState } from 'react';
import './CallPanel.css';

const CallPanel = ({ callStatus, currentCall, initiateCall, endCall }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [botId, setBotId] = useState('');
  
  const handleStartCall = (e) => {
    e.preventDefault();
    if (!phoneNumber || !botId) {
      alert('Please enter both phone number and bot ID');
      return;
    }
    
    initiateCall(phoneNumber, botId);
  };
  
  const handleEndCall = () => {
    endCall();
  };
  
  const formatDuration = (seconds) => {
    if (!seconds) return '00:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };
  
  const formatPhoneNumber = (phone) => {
    if (!phone) return '';
    return phone.replace(/\D+/g, '')
      .replace(/(\d{1})(\d{3})(\d{3})(\d{4})/, '+$1 ($2) $3-$4');
  };
  
  const getCallStatusText = () => {
    switch (callStatus) {
      case 'idle':
        return 'No active call';
      case 'initiating':
        return 'Connecting call...';
      case 'connected':
        return 'Call in progress';
      case 'disconnected':
        return 'Call ended';
      default:
        return 'Unknown status';
    }
  };
  
  return (
    <div className="call-panel">
      <h2>Call Controls</h2>
      
      <div className="call-form">
        <form onSubmit={handleStartCall}>
          <div className="form-group">
            <label htmlFor="phoneNumber">Phone Number:</label>
            <input
              type="tel"
              id="phoneNumber"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+919438658499"
              disabled={callStatus === 'connected' || callStatus === 'initiating'}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="botId">Bot ID:</label>
            <input
              type="text"
              id="botId"
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              placeholder="Enter bot ID"
              disabled={callStatus === 'connected' || callStatus === 'initiating'}
            />
          </div>
          
          <div className="call-actions">
            {(callStatus === 'idle' || callStatus === 'disconnected') && (
              <button type="submit" className="start-call-btn">
                Start Call
              </button>
            )}
            
            {(callStatus === 'connected' || callStatus === 'initiating') && (
              <button type="button" className="end-call-btn" onClick={handleEndCall}>
                End Call
              </button>
            )}
          </div>
        </form>
      </div>
      
      <div className="call-status">
        <h3>Call Status</h3>
        <div className={`status-indicator ${callStatus}`}>
          {getCallStatusText()}
        </div>
        
        {currentCall && (
          <div className="call-details">
            <div className="detail">
              <span className="label">To:</span>
              <span className="value">{formatPhoneNumber(currentCall.to)}</span>
            </div>
            
            <div className="detail">
              <span className="label">From:</span>
              <span className="value">{formatPhoneNumber(currentCall.from)}</span>
            </div>
            
            {currentCall.startTime && (
              <div className="detail">
                <span className="label">Started:</span>
                <span className="value">
                  {currentCall.startTime.toLocaleTimeString()}
                </span>
              </div>
            )}
            
            {currentCall.connectedTime && callStatus === 'connected' && (
              <div className="detail">
                <span className="label">Duration:</span>
                <span className="value">
                  {formatDuration((new Date() - currentCall.connectedTime) / 1000)}
                </span>
              </div>
            )}
            
            {currentCall.endTime && (
              <div className="detail">
                <span className="label">Ended:</span>
                <span className="value">
                  {currentCall.endTime.toLocaleTimeString()}
                </span>
              </div>
            )}
            
            {currentCall.duration && (
              <div className="detail">
                <span className="label">Total Duration:</span>
                <span className="value">
                  {formatDuration(currentCall.duration)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CallPanel;