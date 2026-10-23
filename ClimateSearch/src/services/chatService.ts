import type { AreaSelection, AssistantStyle, ChatMessage, ChatContext } from '@/types';
import { api } from '@/services/api';

export interface ChatReply {
  text: string;
  media?: {
    url?: string;
    caption?: string;
    metadata?: string;
  };
  model: string;  // the Claude model that answered, or "offline" when no API key is set
}

let messageCounter = 0;

export const chatService = {
  generateId: () => `msg-${Date.now()}-${++messageCounter}`,

  /** Sends the conversation so far plus the new question to the assistant (Claude Haiku on the backend). */
  async sendMessage(
    userMessage: string,
    history: ChatMessage[],
    context: ChatContext,
    area: AreaSelection,
    style: AssistantStyle,
  ): Promise<ChatReply> {
    const messages = [
      ...history
        .filter(m => (m.role === 'user' || m.role === 'assistant') && !m.isLoading && !m.hasError && m.content)
        .map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMessage },
    ];
    const reply = await api.ask(area, messages, context, style);
    return { text: reply.reply, media: reply.media ?? undefined, model: reply.model };
  },
};
