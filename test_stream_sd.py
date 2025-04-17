import asyncio
import sounddevice as sd
from kokoro_onnx import Kokoro

# Replace this with the text you want to test.
text = "Hello, this is a test of the streaming TTS mode."

async def main():
    # Initialize the TTS model.
    kokoro = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
    
    # Create a streaming generator for TTS output.
    stream = kokoro.create_stream(text, voice="af_sarah", speed=1.0, lang="en-us")
    
    count = 0
    async for samples, sample_rate in stream:
        count += 1
        print(f"Playing audio stream chunk ({count}) with sample rate: {sample_rate}")
        sd.play(samples, sample_rate)
        sd.wait()  # Wait until playback is finished for this chunk.

asyncio.run(main())