/* eslint-env worker */
/* eslint-disable no-restricted-globals */

async function fetchSentiment(apiUrl, transcriptionText) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: transcriptionText }),
      });
  
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}: ${await response.text()}`);
      }
  
      const data = await response.json();
      return {
        success: true,
        data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Listen for messages from the main thread
  self.onmessage = async (event) => {
    const { apiUrl, transcriptionText } = event.data;
    
    if (!apiUrl || !transcriptionText) {
      self.postMessage({
        success: false,
        error: 'Missing required parameters'
      });
      return;
    }
  
    const result = await fetchSentiment(apiUrl, transcriptionText);
    self.postMessage(result);
  };