import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, X, Plus, Send, Copy, RefreshCw,
  Bot, User, ChevronRight, Loader2, Sparkles, Image as ImageIcon
} from 'lucide-react';
import { useAppStore } from '@/store';
import { chatService } from '@/services/chatService';
import { formatTimestamp } from '@/lib/utils';
import type { ChatMessage } from '@/types';
import toast from 'react-hot-toast';

const INITIAL_DEMO_MESSAGES: ChatMessage[] = [
  {
    id: 'init-1',
    role: 'user',
    content: 'Show me the hottest satellite image of Lagos, Nigeria.',
    timestamp: new Date(Date.now() - 1000 * 60 * 12),
  },
  {
    id: 'init-2',
    role: 'assistant',
    content: 'Here is the latest satellite image of Lagos, Nigeria. The image was captured by Sentinel-2A, 10m resolution, updated 2 minutes ago.',
    timestamp: new Date(Date.now() - 1000 * 60 * 12),
    media: {
      url: 'https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=800&q=80',
      caption: 'Lagos, Nigeria',
      metadata: 'Sentinel-2A • 10m resolution',
    },
  },
  {
    id: 'init-3',
    role: 'user',
    content: 'Zoom in on the central business district.',
    timestamp: new Date(Date.now() - 1000 * 60 * 10),
  },
  {
    id: 'init-4',
    role: 'assistant',
    content: 'Here is a closer view of Lagos Central Business District.',
    timestamp: new Date(Date.now() - 1000 * 60 * 10),
    media: {
      url: 'https://images.unsplash.com/photo-1477959858617-67f30bc75b82?auto=format&fit=crop&w=800&q=80',
      caption: 'Lagos CBD',
      metadata: 'Sentinel-2A • 10m resolution',
    },
  },
];

const SUGGESTED_PROMPTS = [
  "Show me the hottest satellite image of Lagos, Nigeria.",
  "Zoom in on the central business district.",
  "What causes the urban heat island effect?",
  "What is NDVI and how is it used?",
  "How does vegetation help reduce urban heat?",
  "Why is Central Walk a high priority?",
  "How can cities prioritize tree planting?",
];

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1 text-xs">
      {lines.map((line, i) => {
        const parts = line.split(/\*\*(.*?)\*\*/g);
        const rendered = parts.map((p, j) =>
          j % 2 === 1 ? <strong key={j} className="font-bold text-[var(--text-primary)]">{p}</strong> : p
        );
        if (line.startsWith('- ') || line.startsWith('• ')) {
          return (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 text-[var(--accent-green)] font-bold">•</span>
              <span>{rendered.slice(1)}</span>
            </div>
          );
        }
        if (line === '') return <div key={i} className="h-1" />;
        return <p key={i} className="leading-relaxed">{rendered}</p>;
      })}
    </div>
  );
}

export function ChatPanel() {
  const {
    chatVisible, setChatVisible, chatMessages,
    addChatMessage, updateChatMessage, clearChat, chatContext
  } = useAppStore();

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userScrolled = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize with the reference screenshot conversation if empty
  useEffect(() => {
    if (chatMessages.length === 0) {
      INITIAL_DEMO_MESSAGES.forEach(msg => addChatMessage(msg));
    }
  }, [chatMessages.length, addChatMessage]);

  const scrollToBottom = useCallback((force = false) => {
    if (force || !userScrolled.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [chatMessages, scrollToBottom]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    userScrolled.current = scrollHeight - scrollTop - clientHeight > 80;
  };

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;
    setInput('');
    userScrolled.current = false;

    const userMsg: ChatMessage = {
      id: chatService.generateId(),
      role: 'user',
      content,
      timestamp: new Date(),
    };

    const assistantId = chatService.generateId();
    const loadingMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    };

    addChatMessage(userMsg);
    addChatMessage(loadingMsg);
    setIsLoading(true);

    try {
      const reply = await chatService.sendMessage(content, chatMessages, chatContext);
      updateChatMessage(assistantId, {
        content: reply.text,
        media: reply.media,
        isLoading: false,
      });
    } catch {
      updateChatMessage(assistantId, {
        content: 'Sorry, the assistant is unavailable. Please try again.',
        isLoading: false,
        hasError: true,
      });
    } finally {
      setIsLoading(false);
      scrollToBottom(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyMessage = async (content: string) => {
    await navigator.clipboard.writeText(content);
    toast.success('Copied to clipboard');
  };

  return (
    <AnimatePresence>
      {chatVisible && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 380, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="hidden lg:flex flex-col overflow-hidden shrink-0 h-full"
          style={{ borderLeft: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}
        >
          {/* Header matching design reference */}
          <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[var(--accent)]" />
              <span className="font-bold text-sm text-[var(--text-primary)]">Chat</span>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border)]">
                AI Demo
              </span>
              <button
                onClick={clearChat}
                className="btn-ghost w-7 h-7 p-0 justify-center rounded-lg"
                title="New conversation"
                aria-label="New conversation"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => setChatVisible(false)}
                className="btn-ghost w-7 h-7 p-0 justify-center rounded-lg"
                title="Minimize Chat"
                aria-label="Close chat"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Messages list */}
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-3.5 space-y-3.5"
          >
            {chatMessages.map(msg => {
              const isUser = msg.role === 'user';

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''} group`}
                >
                  {/* Avatar */}
                  <div
                    className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 shadow-sm"
                    style={{
                      background: isUser ? 'var(--info)' : 'var(--accent)',
                      color: isUser ? '#FFFFFF' : 'var(--accent-foreground)',
                    }}
                  >
                    {isUser ? <User size={13} /> : <Bot size={14} />}
                  </div>

                  {/* Message bubble */}
                  <div className={`flex flex-col gap-1.5 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`p-3 rounded-2xl text-xs leading-relaxed shadow-sm ${
                        isUser
                          ? 'bg-[var(--accent)] text-[var(--accent-foreground)] font-medium rounded-tr-sm'
                          : 'bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)] rounded-tl-sm'
                      }`}
                    >
                      {msg.isLoading ? (
                        <div className="flex items-center gap-2 py-1">
                          <Loader2 size={13} className="animate-spin text-[var(--accent-green)]" />
                          <span className="text-[var(--text-muted)]">Analyzing satellite data…</span>
                        </div>
                      ) : msg.hasError ? (
                        <span className="text-[var(--alert-high)] font-semibold">{msg.content}</span>
                      ) : (
                        <MarkdownText text={msg.content} />
                      )}

                      {/* Satellite Image Preview Card (exactly like design reference) */}
                      {msg.media?.url && (
                        <div className="mt-2.5 rounded-xl overflow-hidden border border-[var(--border)] bg-[#07111F]">
                          <img
                            src={msg.media.url}
                            alt={msg.media.caption || 'Satellite imagery'}
                            className="w-full h-36 object-cover hover:scale-105 transition-transform duration-500"
                          />
                          <div className="p-2 bg-[#091522] border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-300 font-mono">
                            <span className="font-semibold text-slate-200">{msg.media.caption}</span>
                            <span className="text-slate-400">{msg.media.metadata}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 px-1 text-[10px] text-[var(--text-muted)]">
                      <span>{formatTimestamp(msg.timestamp)}</span>
                      {!msg.isLoading && !msg.hasError && (
                        <button
                          onClick={() => copyMessage(msg.content)}
                          className="opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] transition-opacity"
                          title="Copy"
                        >
                          <Copy size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Suggested Prompts Pill Section */}
          <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--bg-panel)] overflow-x-auto shrink-0 flex gap-1.5 scrollbar-none">
            {SUGGESTED_PROMPTS.slice(0, 3).map(prompt => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                className="whitespace-nowrap px-2.5 py-1 rounded-full text-[10px] bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors shrink-0"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Message Composer */}
          <div className="p-3 shrink-0 border-t border-[var(--border)] bg-[var(--bg-sidebar)]">
            <div className="flex items-end gap-2 rounded-2xl px-3.5 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] focus-within:border-[var(--accent)] transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about urban heat, NDVI, or map zones…"
                rows={1}
                disabled={isLoading}
                className="flex-1 bg-transparent resize-none outline-none text-xs leading-relaxed max-h-24 overflow-y-auto text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || isLoading}
                className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-[var(--accent)] text-[var(--accent-foreground)] hover:brightness-105"
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Send size={13} />
                )}
              </button>
            </div>
            <p className="text-[10px] text-center text-[var(--text-muted)] mt-1.5">
              Enter to send · Shift+Enter for newline · Demo AI Mode
            </p>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

export function ChatToggleButton() {
  const { chatVisible, toggleChat } = useAppStore();
  return (
    <button
      onClick={toggleChat}
      className="hidden lg:flex btn-ghost items-center gap-1.5 text-xs py-1.5 px-2.5 rounded-lg font-semibold"
      aria-label={chatVisible ? 'Close assistant' : 'Open assistant'}
    >
      <Sparkles size={14} className="text-[var(--accent)]" />
      {chatVisible ? 'Hide AI' : 'Climate AI'}
    </button>
  );
}
