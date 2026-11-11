// d. Vercel AI SDK (ai + @ai-sdk/openai) chat completion handler (streaming)
import { streamText, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

export default {
  async fetch(request, env) {
    const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
    const { messages, stream = true } = await request.json();
    if (!stream) {
      const { text } = await generateText({ model: openai('gpt-4o-mini'), messages });
      return Response.json({ text });
    }
    const result = streamText({ model: openai('gpt-4o-mini'), system: 'You are a helpful assistant.', messages });
    return result.toTextStreamResponse();
  },
};
