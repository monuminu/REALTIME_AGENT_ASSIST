from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import logging
import uuid
import traceback
import asyncio
import json
import os
import base64
import threading
from queue import Queue
from urllib.parse import urljoin, urlencode
import numpy as np
import wave
import struct
from io import BytesIO
from dotenv import load_dotenv
import time
load_dotenv()
from openai import AzureOpenAI, OpenAI
import numpy as np
from scipy import signal

with open("system_prompt.txt", "r") as f:
    system_prompt = f.read()
tools = [{"type": "function", "function": {"name": "get_all_order_for_customer", "type": "function", "parameters": {"type": "object", "required": ["phone_number"], "properties": {"phone_number": {"type": "string", "description": "The phone number associated with the order"}}}, "description": "Retrieve all orders for a specific customer"}}, {"type": "function", "function": {"name": "get_all_refund_details_for_customer", "type": "function", "parameters": {"type": "object", "required": ["phone_number"], "properties": {"phone_number": {"type": "string", "description": "The phone number associated with the order"}}}, "description": "Retrieve all refund details for a specific customer"}}, {"type": "function", "function": {"name": "raise_ticket", "type": "function", "parameters": {"type": "object", "required": ["customer_id", "issue"], "properties": {"issue": {"type": "string", "description": "The issue or question to be addressed"}, "customer_id": {"type": "string", "description": "The unique identifier for the customer"}}}, "description": "Raise a ticket for customer service"}}]
# Azure Communication Services imports
from azure.communication.callautomation import (
    MediaStreamingOptions,
    AudioFormat,
    MediaStreamingTransportType,
    MediaStreamingContentType,
    MediaStreamingAudioChannelType,
)
from azure.communication.callautomation.aio import CallAutomationClient
from azure.communication.callautomation import PhoneNumberIdentifier

# Azure Speech imports
import azure.cognitiveservices.speech as speechsdk

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)

# Initialize FastAPI
app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration from environment variables
ACS_CONNECTION_STRING = os.getenv("ACS_CONNECTION_STRING")
SPEECH_KEY = os.getenv("SPEECH_KEY")
SPEECH_REGION = os.getenv("SPEECH_REGION")
WEBSOCKET_URL = os.getenv("WEBSOCKET_URL")

# Initialize Azure Communication Services client
acs_client = CallAutomationClient.from_connection_string(ACS_CONNECTION_STRING)

# Store active connections and call data
call_connection_id = None
message_queue = Queue()
transcription_results = {}
from oai import ChatClient
# Enhanced WebSocket connections manager
class ConnectionManager:
    def __init__(self):
        self.active_connections = {}
        self.transcriptions = {}
        self.audio_streams = {}
        self.speech_recognizers = {}
        self.agent_audio_streams = {}
        self.customer_audio_streams = {}
        self.agent_recognizers = {}
        self.customer_recognizers = {}
        self.chat_client = ChatClient(language = "en-IN",out_queue =  None, tools=tools)

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        if not client_id.startswith("audio_"):
            self.transcriptions[client_id] = []

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
        if client_id in self.transcriptions:
            del self.transcriptions[client_id]
        if client_id.startswith("audio_") and client_id[6:] in self.speech_recognizers:
            call_id = client_id[6:]
            if self.speech_recognizers.get(call_id):
                self.speech_recognizers[call_id].stop_continuous_recognition()
                del self.speech_recognizers[call_id]
            if call_id in self.audio_streams:
                del self.audio_streams[call_id]

    async def broadcast(self, message: str):
        for connection in self.active_connections.values():
            try:
                await connection.send_text(message)
            except WebSocketDisconnect:
                logging.info("Client disconnected")
            except Exception as e:
                #logging.error(traceback.format_exc())
                #logging.error(f"Error broadcasting message: {str(e)} message: {message}")
                pass

    async def send_personal_message(self, message: str, client_id: str):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_text(message)

    def add_transcription(self, call_id: str, transcription: str, speaker: str):
        # Add to global transcription results with speaker info
        if call_id not in transcription_results:
            transcription_results[call_id] = []
        
        transcription_results[call_id].append({
            "text": transcription,
            "speaker": speaker,
            "timestamp": int(time.time() * 1000)
        })
        
        # Add to individual client transcriptions
        for client_id in self.transcriptions:
            if not client_id.startswith("audio_"):  # Only for agent connections
                self.transcriptions[client_id].append({
                    "text": transcription,
                    "speaker": speaker,
                    "timestamp": int(time.time() * 1000)
                })

    def get_transcriptions(self, client_id: str):
        return self.transcriptions.get(client_id, [])

    def get_connections_for_broadcast(self):
        return [conn for client_id, conn in self.active_connections.items() 
                if not client_id.startswith("audio_")]

    def setup_speech_recognizer(self, call_id, samples_per_second=16000, bits_per_sample=16, channels=1):
        speech_config = speechsdk.SpeechConfig(subscription=SPEECH_KEY, region=SPEECH_REGION)
        stream_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=samples_per_second,
            bits_per_sample=bits_per_sample,
            channels=channels,
            wave_stream_format=speechsdk.AudioStreamWaveFormat.PCM
        )
        audio_input_stream = speechsdk.audio.PushAudioInputStream(stream_format=stream_format)
        audio_config = speechsdk.audio.AudioConfig(stream=audio_input_stream)
        speech_config.speech_recognition_language = "en-IN"
        speech_config.set_property(speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, "200")
        speech_recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config, audio_config=audio_config)
        
        speech_recognizer.recognizing.connect(lambda evt: self.on_recognizing(evt, call_id))
        speech_recognizer.recognized.connect(lambda evt: self.on_recognized(evt, call_id))
        speech_recognizer.speech_start_detected.connect(lambda evt: self.on_speech_started(evt, call_id))
        
        self.speech_recognizers[call_id] = speech_recognizer
        self.audio_streams[call_id] = audio_input_stream
        
        return speech_recognizer, audio_input_stream

    def setup_dual_speech_recognizers(self, call_id, samples_per_second=16000, bits_per_sample=16, channels=1):
        # Create agent recognizer
        agent_speech_config = speechsdk.SpeechConfig(subscription=SPEECH_KEY, region=SPEECH_REGION)
        agent_stream_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=samples_per_second,
            bits_per_sample=bits_per_sample,
            channels=channels,
            wave_stream_format=speechsdk.AudioStreamWaveFormat.PCM
        )
        agent_input_stream = speechsdk.audio.PushAudioInputStream(stream_format=agent_stream_format)
        agent_audio_config = speechsdk.audio.AudioConfig(stream=agent_input_stream)
        agent_speech_config.speech_recognition_language = "en-IN"
        agent_speech_config.set_property(speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, "200")
        agent_recognizer = speechsdk.SpeechRecognizer(speech_config=agent_speech_config, audio_config=agent_audio_config)
        
        # Create customer recognizer
        customer_speech_config = speechsdk.SpeechConfig(subscription=SPEECH_KEY, region=SPEECH_REGION)
        customer_stream_format = speechsdk.audio.AudioStreamFormat(
            samples_per_second=samples_per_second,
            bits_per_sample=bits_per_sample,
            channels=channels,
            wave_stream_format=speechsdk.AudioStreamWaveFormat.PCM
        )
        customer_input_stream = speechsdk.audio.PushAudioInputStream(stream_format=customer_stream_format)
        customer_audio_config = speechsdk.audio.AudioConfig(stream=customer_input_stream)
        customer_speech_config.speech_recognition_language = "en-IN"
        customer_speech_config.set_property(speechsdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, "200")
        customer_recognizer = speechsdk.SpeechRecognizer(speech_config=customer_speech_config, audio_config=customer_audio_config)
        
        # Set up event handlers with speaker identification
        agent_recognizer.recognizing.connect(lambda evt: self.on_recognizing(evt, call_id, "agent"))
        agent_recognizer.recognized.connect(lambda evt: self.on_recognized(evt, call_id, "agent"))
        agent_recognizer.speech_start_detected.connect(lambda evt: self.on_speech_started(evt, call_id, "agent"))
        
        customer_recognizer.recognizing.connect(lambda evt: self.on_recognizing(evt, call_id, "customer"))
        customer_recognizer.recognized.connect(lambda evt: self.on_recognized(evt, call_id, "customer"))
        customer_recognizer.speech_start_detected.connect(lambda evt: self.on_speech_started(evt, call_id, "customer"))
        
        # Store the references
        self.agent_recognizers[call_id] = agent_recognizer
        self.customer_recognizers[call_id] = customer_recognizer
        self.agent_audio_streams[call_id] = agent_input_stream
        self.customer_audio_streams[call_id] = customer_input_stream
        
        # Start continuous recognition for both
        agent_recognizer.start_continuous_recognition()
        customer_recognizer.start_continuous_recognition()
        
        return (agent_recognizer, agent_input_stream), (customer_recognizer, customer_input_stream)

    def on_recognizing(self, args: speechsdk.SpeechRecognitionEventArgs, call_id):
        logging.info(f"Recognizing for call {call_id}: {args.result.text}")

    def on_speech_started(self, args: speechsdk.SpeechRecognitionEventArgs, call_id):
        logging.info(f"Speech started for call {call_id}: {args}")

    def on_recognized(self, args: speechsdk.SpeechRecognitionEventArgs, call_id):
        transcription = args.result.text
        if not transcription:
            return
            
        logging.info(f"Recognized for call {call_id}: {transcription}")
        self.add_transcription(call_id, transcription)
        
        message = json.dumps({
            "type": "transcription",
            "callId": call_id,
            "text": transcription
        })
        message_queue.put((message, self.get_connections_for_broadcast()))

    def on_speech_started(self, args: speechsdk.SpeechRecognitionEventArgs, call_id, speaker):
        logging.info(f"{speaker.capitalize()} speech started for call {call_id}")

    def on_recognizing(self, args: speechsdk.SpeechRecognitionEventArgs, call_id, speaker):
        logging.info(f"Recognizing {speaker} speech for call {call_id}: {args.result.text}")

    def on_recognized(self, args: speechsdk.SpeechRecognitionEventArgs, call_id, speaker):
        transcription = args.result.text
        if not transcription:
            return
            
        logging.info(f"Recognized {speaker} speech for call {call_id}: {transcription}")
        self.add_transcription(call_id, transcription, speaker)
        
        message = json.dumps({
            "type": "transcription",
            "callId": call_id,
            "text": transcription,
            "speaker": speaker
        })
        logging.info(f"Adding message to queue: {message}")
        message_queue.put((message, self.get_connections_for_broadcast()))

manager = ConnectionManager()

# Speech recognition helpers
def pcm_to_wav(pcm_data, sample_rate=16000, channels=1):
    with BytesIO() as wav_file:
        with wave.open(wav_file, 'wb') as wav:
            wav.setnchannels(channels)
            wav.setsampwidth(2)  # 16-bit
            wav.setframerate(sample_rate)
            wav.writeframes(pcm_data)
        return wav_file.getvalue()

def pcm_to_numpy(pcm_data, sample_width=2):
    if not pcm_data:
        return np.array([])
    
    if sample_width == 2:
        format_char = 'h'  # 16-bit signed short
    elif sample_width == 1:
        format_char = 'b'  # 8-bit signed char
    else:
        raise ValueError(f"Unsupported sample width: {sample_width}")
    
    num_samples = len(pcm_data) // sample_width
    return np.array(struct.unpack(f"{num_samples}{format_char}", pcm_data))

# Callback endpoints
@app.post('/api/callbacks/{context_id}')
async def callbacks(request: Request, context_id: str):
    events = await request.json()
    for event in events:
        global call_connection_id
        event_data = event['data']
        call_connection_id = event_data.get("callConnectionId")
        logging.info(f"Received Event: {event['type']}, Correlation Id: {event_data.get('correlationId')}, CallConnectionId: {call_connection_id}")
        
        if event['type'] == "Microsoft.Communication.CallConnected":
            call_connection_properties = await acs_client.get_call_connection(call_connection_id).get_call_properties()
            media_streaming_subscription = call_connection_properties.media_streaming_subscription
            logging.info(f"MediaStreamingSubscription: {media_streaming_subscription}")
            
            await manager.broadcast(json.dumps({
                "type": "callStatus",
                "status": "connected",
                "callId": call_connection_id
            }))
            
        elif event['type'] == "Microsoft.Communication.MediaStreamingStarted":
            logging.info(f"Media streaming started for content type: {event_data['mediaStreamingUpdate']['contentType']}")
            
            await manager.broadcast(json.dumps({
                "type": "mediaStatus",
                "status": "started",
                "callId": call_connection_id
            }))
            
        elif event['type'] == "Microsoft.Communication.MediaStreamingStopped":
            logging.info(f"Media streaming stopped for content type: {event_data['mediaStreamingUpdate']['contentType']}")
            
            await manager.broadcast(json.dumps({
                "type": "mediaStatus",
                "status": "stopped",
                "callId": call_connection_id
            }))
            
        elif event['type'] == "Microsoft.Communication.MediaStreamingFailed":
            logging.error(f"Media streaming failed: {event_data['resultInformation']['message']}")
            
            await manager.broadcast(json.dumps({
                "type": "mediaStatus",
                "status": "failed",
                "callId": call_connection_id,
                "error": event_data['resultInformation']['message']
            }))
            
        elif event['type'] == "Microsoft.Communication.CallDisconnected":
            logging.info(f"Call disconnected: {call_connection_id}")
            
            await manager.broadcast(json.dumps({
                "type": "callStatus",
                "status": "disconnected",
                "callId": call_connection_id
            }))
    
    return Response(status_code=200)


@app.get("/api/recommendation/{client_id}")
async def get_recommendation(client_id: str):
    conversation = manager.get_transcriptions(client_id)
    if not conversation:
        return JSONResponse(content={"recommendation": "No conversation context available."}, status_code=200)

    conversation_text = "\n".join([f"{t['speaker']}: {t['text']}" for t in conversation])
    logging.info(f"Conversation: {conversation_text}")
    
    prompt = f"""Given the following conversation between an agent and a customer, provide a concise and helpful recommendation for the customer:

{conversation_text}

Recommendation:
    """

    try:
        collected_messages = []
        async for chunk in manager.chat_client.generate_response(human_input = prompt, system_prompt = system_prompt, language = "english"):
            collected_messages.append(chunk)
        recommendation = "".join([msg for msg in collected_messages if msg is not None])
        logging.info(f"Recommendation: {recommendation}")
        return JSONResponse(content={"recommendation": recommendation}, status_code=200)
    except Exception as e:
        logging.error(f"Error generating recommendation: {str(e)}")
        return JSONResponse(content={"error": "Failed to generate recommendation."}, status_code=500)

# Outbound call endpoint
@app.post("/api/outboundCall")
async def outbound_call_handler(request: Request):
    try:
        request_data = await request.json()
        target_phone_number = request_data.get("phoneNumber")
        source_phone_number = request_data.get("sourcePhoneNumber", "+18772246445")
        deployed_bot_id = request_data.get("botId")
        
        if not target_phone_number:
            return JSONResponse(content={"error": "Phone number is required"}, status_code=400)
        
        if not deployed_bot_id:
            return JSONResponse(content={"error": "Bot ID is required"}, status_code=400)
        
        logging.info(f"Initiating outbound call to: {target_phone_number} with bot ID: {deployed_bot_id}")
        
        call_guid = str(uuid.uuid4())
        
            
        CALLBACK_EVENTS_URI = urljoin(WEBSOCKET_URL.replace("wss://", "https://"), "api/callbacks")
        
        query_parameters = urlencode({"callerId": source_phone_number})
        callback_uri = f"{CALLBACK_EVENTS_URI}/{call_guid}?{query_parameters}"
        logging.info(f"Callback URL: {callback_uri}")
        
        transport_url = f"{WEBSOCKET_URL}/ws/audio/{call_guid}"
        logging.info(f"Transport URL: {transport_url}")
        
        media_streaming_options = MediaStreamingOptions(
            transport_url=transport_url,
            transport_type=MediaStreamingTransportType.WEBSOCKET,
            content_type=MediaStreamingContentType.AUDIO,
            audio_channel_type=MediaStreamingAudioChannelType.UNMIXED,
            start_media_streaming=True,
            enable_bidirectional=True,
            audio_format=AudioFormat.PCM24_K_MONO
        )
        
        target_participant = PhoneNumberIdentifier(target_phone_number)
        source_caller = PhoneNumberIdentifier(source_phone_number)
        
        call_result = await acs_client.create_call(
            target_participant=target_participant,
            source_caller_id_number=source_caller,
            callback_url=callback_uri,
            media_streaming=media_streaming_options,
            operation_context="outboundCall"
        )
        
        logging.info(f"Outbound call initiated with ID: {call_result.call_connection_id}")
        
        global call_connection_id
        call_connection_id = call_result.call_connection_id
        
        await manager.broadcast(json.dumps({
            "type": "callStatus",
            "status": "initiated",
            "callId": call_connection_id,
            "to": target_phone_number,
            "from": source_phone_number
        }))
        
        return JSONResponse(
            content={
                "callConnectionId": call_result.call_connection_id,
                "callId": call_guid
            },
            status_code=202,
        )
        
    except Exception as e:
        logging.error(traceback.format_exc())
        logging.error(f"Error initiating outbound call: {str(e)}")
        return JSONResponse(
            content={"error": str(e)},
            status_code=500,
        )

# WebSocket endpoint for agent UI
@app.websocket("/ws/agent/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message["type"] == "getTranscription":
                call_id = message.get("callId")
                if call_id and call_id in transcription_results:
                    await websocket.send_text(json.dumps({
                        "type": "transcriptions",
                        "callId": call_id,
                        "data": transcription_results[call_id]
                    }))
                else:
                    # Send all transcriptions for this client
                    transcriptions = manager.get_transcriptions(client_id)
                    await websocket.send_text(json.dumps({
                        "type": "transcriptions",
                        "data": transcriptions
                    }))
            
            elif message["type"] == "clearTranscription":
                call_id = message.get("callId")
                if call_id and call_id in transcription_results:
                    transcription_results[call_id] = []
                    await websocket.send_text(json.dumps({
                        "type": "transcriptionCleared",
                        "callId": call_id
                    }))
            
            elif message["type"] == "endCall":
                if call_connection_id:
                    try:
                        await acs_client.get_call_connection(call_connection_id).hang_up(is_for_everyone=True)
                        await manager.broadcast(json.dumps({
                            "type": "callStatus",
                            "status": "disconnected",
                            "callId": call_connection_id
                        }))
                    except Exception as e:
                        logging.error(f"Error ending call: {str(e)}")
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": f"Failed to end call: {str(e)}"
                        }))
    
    except WebSocketDisconnect:
        await manager.broadcast(json.dumps({
            "type": "clientDisconnected",
            "clientId": client_id
        }))
        #manager.disconnect(client_id)

# WebSocket endpoint for audio streaming
@app.websocket("/ws/audio/{call_id}")
async def websocket_audio_endpoint(websocket: WebSocket, call_id: str):
    client_id = f"audio_{call_id}"
    await manager.connect(websocket, client_id)
    logging.info(f"WebSocket connection established for call {call_id}")
    (agent_recognizer, agent_stream), (customer_recognizer, customer_stream) = manager.setup_dual_speech_recognizers(call_id)
    try:
        while True:
            # Receive audio chunk
            message = await websocket.receive()
            try:
                if "text" in message:
                    try:
                        control = json.loads(message["text"])
                        if control.get("kind") == "AudioMetadata":
                            logging.info(f"Audio Metadata: {control}")
                            sample_rate = control["audioMetadata"]["sampleRate"]
                        elif control.get("kind") == "AudioData":
                            await manager.broadcast(json.dumps({
                                "type": "audioStream",
                                "callId": call_id,
                                "sampleRate": sample_rate,
                                "data": control["audioData"]["data"],
                            }))
                            chunk = base64.b64decode(control["audioData"]["data"])
                            manager.customer_audio_streams[call_id].write(chunk)
                    except json.JSONDecodeError:
                        logging.warning(f"Received non-JSON data from audio stream: {message['text'][:50]}...")
                elif "bytes" in message:
                    chunk = message["bytes"]
                    manager.agent_audio_streams[call_id].write(chunk)
                    await manager.broadcast(json.dumps({
                            "Kind": "AudioData",
                            "AudioData": {
                                    "Data":  base64.b64encode(chunk).decode("utf-8")
                            },
                            "StopAudio": None
                        }))
                elif message.get("type") == "websocket.disconnect":
                    logging.info(f"Received disconnect message: {message}")
                    break
                else:
                    logging.warning(f"Received unknown message type: {message}")
            except Exception as e:
                logging.error(f"Error processing audio message: {str(e)}")
                break  # Exit the loop on any unhandled exception to ensure proper cleanup
    
    except WebSocketDisconnect:
        logging.info(f"WebSocket connection closed for call {call_id}")
    
    except Exception as e:
        logging.error(traceback.format_exc())
        logging.error(f"Error in WebSocket audio endpoint: {str(e)}")

# Process queued messages
async def process_message_queue():
    while True:
        try:
            message, connections = message_queue.get()
            for connection in connections:
                try:
                    await connection.send_text(message)
                except Exception as e:
                    logging.error(f"Error broadcasting transcription: {str(e)}")
            message_queue.task_done()
        except Exception as e:
            logging.error(f"Error processing message queue: {str(e)}")
        await asyncio.sleep(0.01)  # Small sleep to prevent CPU hogging

# Register startup event
@app.on_event("startup")
async def startup_event():
    message_thread = threading.Thread(target=asyncio.run, args=(process_message_queue(),), daemon=True)
    message_thread.start()
# Start the server
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)