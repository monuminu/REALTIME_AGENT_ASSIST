import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

document.addEventListener('DOMContentLoaded', () => {
  const rootElement = document.getElementById('root');
  if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } else {
    console.error('Cannot find element with id "root"');
  }
});