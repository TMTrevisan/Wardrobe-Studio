'use client';

import { useEffect, useState } from 'react';
import { useToasts } from './Toaster';
import { getItemWornCount } from '@/lib/garment-utils';
import type { Garment, WearLog } from '@/types/db';

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  items: Garment[];
  wearLogs: WearLog[];
}

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type ChatProvider = 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'minimax';

/**
 * Floating chat drawer that talks to the `/api/chat` route. Picks a
 * provider + key from localStorage (so the user's choice persists across
 * sessions), builds a minified wardrobe context string, and renders
 * message bubbles + a settings panel for swapping provider/key.
 *
 * Now extracted from page.tsx so the parent component doesn't carry
 * ~7 useState hooks + 1 helper for the chat alone.
 */
export default function ChatPanel({ open, onClose, items, wearLogs }: ChatPanelProps) {
  const notify = useToasts();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<ChatProvider>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  // Hydrate persisted provider/key on first mount.
  useEffect(() => {
    const savedProvider = localStorage.getItem('threads_chat_provider') as ChatProvider | null;
    const savedKey = localStorage.getItem('threads_chat_key') || '';
    if (savedProvider) setProvider(savedProvider);
    if (savedKey) setApiKey(savedKey);
  }, []);

  const sendMessage = async (customText?: string) => {
    const text = customText ?? input;
    if (!text.trim()) return;

    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setIsTyping(true);

    const wardrobeContext = items
      .map(
        (i) =>
          `${i.id} | ${i.category} | ${i.sub_category} | ${i.color_family} | ${i.fabric_type} | ${i.fit_block} | Wears: ${getItemWornCount(
            i.id,
            wearLogs
          )}`
      )
      .join('\n');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next,
          provider,
          apiKey,
          wardrobe: wardrobeContext,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.text }]);
      } else {
        notify.error(`Chat failed: ${data.error || 'Unknown error'}`);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `⚠️ Error: ${data.error || 'Failed to generate response.'}` },
        ]);
      }
    } catch (err: any) {
      notify.error(`Chat error: ${err.message}`);
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ Error: ${err.message}` }]);
    } finally {
      setIsTyping(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white border-l border-[#EAE5D9] shadow-2xl flex flex-col text-[var(--text-primary)]">
      {/* HEADER */}
      <div className="p-4 border-b border-[#EAE5D9] flex items-center justify-between bg-[#FAF8F5]">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent-terracotta)] animate-pulse" aria-hidden="true"></span>
          <h3 className="text-sm font-extrabold text-[var(--text-primary)]">Threads AI Stylist</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded-xl hover:bg-[#F5F2EB] transition text-sm"
            aria-label="Open AI settings"
            title="AI Settings"
          >
            ⚙️
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded-xl hover:bg-[#F5F2EB] transition text-sm"
            aria-label="Close chat"
          >
            ✕
          </button>
        </div>
      </div>

      {/* SETTINGS PANEL */}
      {showSettings && (
        <div className="p-4 border-b border-[#EAE5D9] bg-[#FAF8F5] space-y-3">
          <h4 className="text-[10px] uppercase font-black text-[var(--accent-terracotta)]">Stylist Model Configuration</h4>
          <div className="space-y-2">
            <div className="space-y-1">
              <label htmlFor="chat-provider" className="text-[9px] uppercase font-bold text-[var(--text-secondary)]">AI Provider</label>
              <select
                id="chat-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as ChatProvider)}
                className="w-full bg-white border border-[#EAE5D9] rounded-xl p-2 text-xs text-[var(--text-primary)] focus:outline-none"
              >
                <option value="gemini">Google Gemini (Recommended)</option>
                <option value="openai">OpenAI GPT-4o-Mini</option>
                <option value="anthropic">Anthropic Claude 3.5 Haiku</option>
                <option value="deepseek">DeepSeek Chat</option>
                <option value="minimax">MiniMax Text-01</option>
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="chat-api-key" className="text-[9px] uppercase font-bold text-[var(--text-secondary)]">Custom API Key (Optional)</label>
              <input
                id="chat-api-key"
                type="password"
                placeholder="Enter key to override env default..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  localStorage.setItem('threads_chat_key', e.target.value);
                }}
                className="w-full bg-white border border-[#EAE5D9] rounded-xl p-2 text-xs text-[var(--text-primary)] focus:outline-none"
              />
              <span className="text-[8px] text-[var(--text-secondary)] font-bold">Stored locally in your browser's secure cache.</span>
            </div>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem('threads_chat_provider', provider);
                setShowSettings(false);
              }}
              className="w-full py-2 bg-[#FAF8F5] text-[var(--accent-terracotta)] border border-[#EAE5D9] hover:bg-[#F5F2EB] text-[10px] font-black rounded-xl transition"
            >
              Save Config
            </button>
          </div>
        </div>
      )}

      {/* MESSAGES */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#FAF8F5]">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
            <span className="text-3xl" aria-hidden="true">🧥</span>
            <div className="space-y-1">
              <p className="text-xs font-extrabold text-[var(--text-primary)]">How can I help style you today?</p>
              <p className="text-[10px] text-[var(--text-secondary)] font-bold">Ask about outfits, coordinate combinations, or identify closet clutter.</p>
            </div>
            <div className="w-full max-w-xs space-y-2 pt-2">
              <button
                type="button"
                onClick={() => sendMessage('Suggest a stylish outfit combination for warm weather')}
                className="w-full p-2.5 bg-white border border-[#EAE5D9] hover:border-[#FAF8F5] rounded-2xl text-[10px] text-left text-[var(--text-primary)] font-bold transition shadow-xs"
              >
                ☀️ Suggest a warm weather outfit...
              </button>
              <button
                type="button"
                onClick={() => sendMessage('Which items in my closet have the least number of wear counts?')}
                className="w-full p-2.5 bg-white border border-[#EAE5D9] hover:border-[#FAF8F5] rounded-2xl text-[10px] text-left text-[var(--text-primary)] font-bold transition shadow-xs"
              >
                📉 Find my least worn items...
              </button>
              <button
                type="button"
                onClick={() => sendMessage('Give me a styling recommendation using my green linen shirt')}
                className="w-full p-2.5 bg-white border border-[#EAE5D9] hover:border-[#FAF8F5] rounded-2xl text-[10px] text-left text-[var(--text-primary)] font-bold transition shadow-xs"
              >
                🟢 Style my green linen shirt...
              </button>
            </div>
          </div>
        ) : (
          messages.map((m, idx) => (
            <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed font-bold shadow-xs ${
                  m.role === 'user'
                    ? 'bg-[var(--accent-terracotta)] text-white border border-[var(--accent-terracotta)]/40'
                    : 'bg-white border border-[#EAE5D9] text-[var(--text-primary)]'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {isTyping && (
          <div className="flex justify-start" aria-live="polite">
            <div className="bg-white border border-[#EAE5D9] text-[var(--text-secondary)] rounded-2xl px-3.5 py-2.5 text-xs flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-terracotta)] animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-terracotta)] animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-terracotta)] animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
          </div>
        )}
      </div>

      {/* INPUT FORM */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        className="p-3 border-t border-[#EAE5D9] bg-[#FAF8F5] flex gap-2"
      >
        <input
          type="text"
          placeholder="Ask Stylist..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Message"
          className="flex-1 bg-white border border-[#EAE5D9] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] placeholder-stone-400 focus:outline-none focus:border-[var(--accent-terracotta)]/40 font-bold"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-[var(--accent-terracotta)] text-white font-extrabold text-xs rounded-xl hover:bg-[var(--accent-terracotta)]/95 shadow-md active:scale-95 transition"
        >
          Send
        </button>
      </form>
    </div>
  );
}