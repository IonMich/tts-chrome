import asyncio
import websockets
import json
import numpy as np
from kokoro_onnx import Kokoro

# Initialize the TTS model once at startup.
kokoro = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")

async def stream_tts(websocket, path=None):
    try:
        # Wait for the client to send text
        message = await websocket.recv()
        data = json.loads(message)
        text = data.get("text", "")
        voice = data.get("voice", "af_sarah")
        if not text:
            await websocket.send(json.dumps({"error": "No text provided"}))
            return

        # Create an asynchronous stream for TTS generation with selected voice
        stream = kokoro.create_stream(text, voice=voice, speed=1.0, lang="en-us")
        print(f"Streaming TTS for text: {text}")
        # Send sample_rate once, then stream PCM bytes.
        sent_rate = False
        async for samples, sample_rate in stream:
            if not sent_rate:
                # Log the sample_rate we're sending
                print(f"[TTS Server] Sending sample_rate: {sample_rate}")
                await websocket.send(json.dumps({"sample_rate": sample_rate}))
                sent_rate = True
            # Convert the NumPy samples to 16-bit PCM bytes.
            pcm_bytes = (samples * 32767).astype(np.int16).tobytes()
            await websocket.send(pcm_bytes)

        # Signal end of stream by sending a JSON message.
        await websocket.send(json.dumps({"end": True}))
        print("Stream ended.")
    except Exception as e:
        # Send error message if something goes wrong.
        await websocket.send(json.dumps({"error": str(e)}))

async def main():
    async with websockets.serve(stream_tts, "localhost", 5050):
        print("WebSocket server running on ws://localhost:5050")
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
