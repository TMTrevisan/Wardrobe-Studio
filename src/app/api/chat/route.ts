import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export async function POST(request: Request) {
  try {
    const { messages, provider, apiKey, wardrobe } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Missing or invalid messages array.' }, { status: 400 });
    }

    const systemPrompt = `You are "Threads Stylist", a professional AI fashion stylist and wardrobe curator.
You have access to the user's minified closet inventory below. 

Format:
ID | Category | Sub-Category | Color | Fabric | Fit | Wears

Closet Inventory:
${wardrobe || 'No garments in wardrobe yet.'}

Rules & Instructions:
1. Provide styling advice, recommend outfit combinations from the inventory, and suggest which items to keep, purchase, or declutter.
2. If the user asks for weather-appropriate styling, suggest items matching the description.
3. Be concise, fashionable, and constructive. Recommend specific pairs using their IDs or descriptions.`;

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const activeProvider = provider || 'gemini';

    if (activeProvider === 'gemini') {
      const key = apiKey || process.env.GEMINI_API_KEY || '';
      if (!key) {
        return NextResponse.json({ error: 'Gemini API key is not configured.' }, { status: 400 });
      }

      // We call the Gemini API using native fetch to handle custom user keys dynamically
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${key}`;
      
      const contents = messages.map((m: any) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      // Prepend system instruction
      const payload = {
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        return NextResponse.json({ error: `Gemini API error: ${errorData.error?.message || response.statusText}` }, { status: response.status });
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return NextResponse.json({ text });

    } else if (activeProvider === 'openai') {
      const key = apiKey || process.env.OPENAI_API_KEY || '';
      if (!key) {
        return NextResponse.json({ error: 'OpenAI API key is not configured.' }, { status: 400 });
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: formattedMessages
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return NextResponse.json({ error: `OpenAI API error: ${errorData.error?.message || response.statusText}` }, { status: response.status });
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      return NextResponse.json({ text });

    } else if (activeProvider === 'anthropic') {
      const key = apiKey || process.env.ANTHROPIC_API_KEY || '';
      if (!key) {
        return NextResponse.json({ error: 'Anthropic API key is not configured.' }, { status: 400 });
      }

      const anthropicMessages = messages.map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }));

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          system: systemPrompt,
          messages: anthropicMessages,
          max_tokens: 1024
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return NextResponse.json({ error: `Anthropic API error: ${errorData.error?.message || response.statusText}` }, { status: response.status });
      }

      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      return NextResponse.json({ text });

    } else if (activeProvider === 'deepseek') {
      const key = apiKey || process.env.DEEPSEEK_API_KEY || '';
      if (!key) {
        return NextResponse.json({ error: 'DeepSeek API key is not configured.' }, { status: 400 });
      }

      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: formattedMessages,
          max_tokens: 1024
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return NextResponse.json({ error: `DeepSeek API error: ${errorData.error?.message || response.statusText}` }, { status: response.status });
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      return NextResponse.json({ text });

    } else if (activeProvider === 'minimax') {
      const key = apiKey || process.env.MINIMAX_API_KEY || '';
      if (!key) {
        return NextResponse.json({ error: 'MiniMax API key is not configured.' }, { status: 400 });
      }

      // MiniMax uses the same OpenAI-compatible interface
      const response = await fetch('https://api.minimaxi.chat/v1/text/chatcompletion_v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: 'MiniMax-Text-01',
          messages: formattedMessages,
          max_tokens: 1024
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        return NextResponse.json({ error: `MiniMax API error: ${errorData.base_resp?.status_msg || response.statusText}` }, { status: response.status });
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      return NextResponse.json({ text });

    } else {
      return NextResponse.json({ error: `Unsupported provider: ${activeProvider}` }, { status: 400 });
    }

  } catch (error: any) {
    console.error('Chat API Error:', error);
    return NextResponse.json({ error: error.message || 'An error occurred during chat.' }, { status: 500 });
  }
}
