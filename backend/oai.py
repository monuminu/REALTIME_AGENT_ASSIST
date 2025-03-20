import json
import random
from datetime import datetime, timedelta
import asyncio
from openai import AzureOpenAI, OpenAI
import os
import re
import base64
import logging
from tools import tools_mapping
logging.basicConfig(  
    level=logging.INFO,  
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",  
    datefmt="%Y-%m-%d %H:%M:%S",  
)  
logger = logging.getLogger(__name__)  
model_provider = os.getenv("MODEL_PROVIDER", "aoai")

# from azure.monitor.opentelemetry.exporter import AzureMonitorTraceExporter
# from azure.monitor.opentelemetry import configure_azure_monitor
# exporter = AzureMonitorTraceExporter.from_connection_string(
#     os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"]
# )
# from openinference.instrumentation.openai import OpenAIInstrumentor
# from opentelemetry import trace
# from opentelemetry.sdk.trace.export import BatchSpanProcessor
# from opentelemetry.sdk.trace import TracerProvider

# tracer_provider = TracerProvider()
# trace.set_tracer_provider(tracer_provider)
# tracer = trace.get_tracer(__name__)
# span_processor = BatchSpanProcessor(exporter, schedule_delay_millis=60000)
# trace.get_tracer_provider().add_span_processor(span_processor)
# OpenAIInstrumentor().instrument()

# configure_azure_monitor(connection_string=os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"])


#with open("system_prompt.txt", "r") as file:
#    system_prompt = file.read()
 
class ChatClient:
    def __init__(self, language, out_queue, tools = []) -> None:
        self.out_queue = out_queue
        self.client = AzureOpenAI(
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_version="2024-12-01-preview",
        )
        self.deployment_name = os.environ["AZURE_OPENAI_MODEL"]
        self.tools = tools if tools else []
        logger.info(f"Tools: {self.tools} Type: {type(self.tools)}")
        self.available_functions = tools_mapping
        self.messages = []
        self.system_prompt = ""
        
    async def process_response_stream(self, response_stream, temperature=0):
        """
        Recursively process response streams to handle multiple sequential function calls.
        This function can call itself when a function call is completed to handle subsequent function calls.
        """
        function_arguments = ""
        function_name = ""
        tool_call_id = ""
        is_collecting_function_args = False
        collected_messages = []
       
        for part in response_stream:
            if part.choices == []:
                continue
            delta = part.choices[0].delta
            finish_reason = part.choices[0].finish_reason
           
            # Process assistant content
            if delta.content:
                collected_messages.append(delta.content)
                yield delta.content
           
            # Handle tool calls
            if delta.tool_calls:
                if len(delta.tool_calls) > 0:
                    tool_call = delta.tool_calls[0]
                   
                    # Get function name
                    if tool_call.function.name:
                        function_name = tool_call.function.name
                        tool_call_id = tool_call.id
                   
                    # Process function arguments delta
                    if tool_call.function.arguments:
                        function_arguments += tool_call.function.arguments
                        is_collecting_function_args = True
           
            # Check if we've reached the end of a tool call
            if finish_reason == "tool_calls" and is_collecting_function_args:
                # Process the current tool call
                logger.info(f"function_arguments: {function_arguments}")
                function_args = json.loads(function_arguments)
                function_to_call = self.available_functions[function_name]
                reply_to_customer = function_args.get('reply_to_customer')
                logger.info(f"reply_to_customer: {reply_to_customer}")
                # Output any replies to the customer
                if reply_to_customer:
                    tokens = re.findall(r'\s+|\w+|[^\w\s]', reply_to_customer)
                    for token in tokens:
                        yield token
               
                # Add the assistant message with tool call
                self.messages.append({
                    "role": "assistant",
                    "content": reply_to_customer,
                    "tool_calls": [
                        {
                            "id": tool_call_id,
                            "function": {
                                "name": function_name,
                                "arguments": function_arguments
                            },
                            "type": "function"
                        }
                    ]
                })
               
                # Execute the function
                function_args['out_queue'] = self.out_queue
                logger.info(f"Function Name: {function_name} Function Args: {function_args}")
                func_response = await function_to_call(**function_args)
                logger.info(f"Function Response: {func_response}")
               
                # Add the tool response
                self.messages.append({
                    "tool_call_id": tool_call_id,
                    "role": "tool",
                    "name": function_name,
                    "content": func_response,
                })
               
                # Create a new stream to continue processing and potentially handle more function calls
                new_response_stream = self.client.chat.completions.create(
                    model=self.deployment_name,
                    messages=self.messages,
                    tools=self.tools,
                    parallel_tool_calls=False,
                    stream=True,
                    temperature=temperature
                )
               
                # Recursively process the new stream to handle additional function calls
                async for token in self.process_response_stream(new_response_stream, temperature):
                    yield token
               
                # After recursive processing is complete, we're done
                return
           
            # Check if we've reached the end of assistant's response
            if finish_reason == "stop":
                # Add final assistant message if there's content
                if collected_messages:
                    final_content = ''.join([msg for msg in collected_messages if msg is not None])
                    if final_content.strip():
                        self.messages.append({"role": "assistant", "content": final_content})
                return
   
    # Main entry point that uses the recursive function
    async def generate_response(self, human_input: str, system_prompt: str, language: str, frame = None, temperature = 0.7):
        logger.info(f"human_input: {human_input}")
        self.messages.append({"role": "user", "content": human_input})
        if self.messages is None or self.messages == []:
            self.messages = [{"role": "system", "content": system_prompt}]
        else:
            self.messages =  [{"role": "system", "content": system_prompt}] + self.messages[1:]
        if frame:
            self.messages = self.messages + [{"role": "user", "content": [
                {
                    "type": "text",
                    "content": human_input},
                { 
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{frame}"
                    }
                }]}]
        else:
            self.messages = self.messages + [{"role": "user", "content": human_input}]
        response_stream = self.client.chat.completions.create(
            model=self.deployment_name,
            messages=self.messages,
            tools=self.tools,
            parallel_tool_calls=False,
            stream=True,
            temperature=temperature
        )
       
        # Process the initial stream with our recursive function
        async for token in self.process_response_stream(response_stream, temperature):
            yield token
                
if __name__ == "__main__":
    async def main():
        chat_client = ChatClient()
        async for chunk in chat_client.chat("What is the procedure to open a Mutual fund account?", "en-IN"):
            print(chunk, end="", flush=True)
    asyncio.run(main())