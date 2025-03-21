# Agent Assist Application Setup Guide

This guide will help you set up and run the Agent Assist application with Azure Communication Services integration.

## Backend Setup

### 1. Install Python Dependencies

First, create a virtual environment and install the required Python packages:

```bash
# Create a virtual environment
python -m venv venv

# Activate the virtual environment
# On Windows
venv\Scripts\activate
# On macOS/Linux
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configure Azure Services

You need to update the configuration in both `app.py` and `websocket_server.py` with your Azure credentials:

```python
# Azure Communication Services configuration
ACS_CONNECTION_STRING = "YOUR_ACS_CONNECTION_STRING"
SPEECH_KEY = "YOUR_SPEECH_KEY"
SPEECH_REGION = "YOUR_SPEECH_REGION"

# WebSocket URL for media streaming
WEBSOCKET_URL = "YOUR_WEBSOCKET_SERVER_URL"
```

Replace these placeholder values with your actual Azure Communication Services connection string, Speech Services key, and region.

### 3. Run the Backend Servers

You need to run both the main backend server and the WebSocket server:

```bash
# Terminal 1: Run the main backend server
uvicorn app:app --reload --host 0.0.0.0 --port 8000

## Frontend Setup

### 1. Install Node.js Dependencies

Navigate to the frontend directory and install the dependencies:

```bash
# Install dependencies
npm install
```

### 2. Configure API Endpoints

Create a `.env` file in the frontend directory with the following content:

```
REACT_APP_API_BASE_URL=http://localhost:8000
```

Adjust these URLs if your backend is running on a different host or port.

### 3. Run the Frontend

Start the React development server:

```bash
npm start
```

This will open the application in your default web browser at `http://localhost:3000`.

## Using the Application

1. Use the "Call Controls" panel to initiate an outbound call:
   - Enter the phone number in the format `+1234567890`
   - Enter the Bot ID (Put Any ID for Now) . Its not used internally.
   - Click "Start Call"

2. Once the call is connected, you'll see:
   - The call status will update to "Connected"
   - The duration timer will start counting
   - Transcriptions will appear in the "Live Transcription" panel

3. Use the "Agent Notes" section to take notes during the call
   - Click "Save Notes" or press Ctrl+S/Cmd+S to save your notes

4. Use the "Suggested Responses" section for quick responses during the call

5. Click "End Call" when you're finished

## Troubleshooting

- If you encounter connection issues, make sure both the backend servers are running
- Check the browser console for any frontend errors
- Check the terminal logs for backend errors
- Ensure your Azure Communication Services and Speech Services are properly configured and have the necessary permissions

## System Architecture

The application follows the architecture shown in the diagram:

1. The React frontend communicates with the FastAPI backend through HTTP API calls and WebSocket connections
2. The backend integrates with Azure Communication Services for call handling
3. The WebSocket server handles audio streaming and transcription using Azure Speech Services
4. The transcription results are sent back to the frontend in real-time
