/* eslint-env worker */
/* eslint-disable no-restricted-globals */

self.onmessage = async (event) => {
    const { apiUrl } = event.data;
    try {
      const response = await fetch(apiUrl);
      const data = await response.json();
      self.postMessage({ success: response.ok, data });
    } catch (error) {
      self.postMessage({ success: false, error: error.message });
    }
  };