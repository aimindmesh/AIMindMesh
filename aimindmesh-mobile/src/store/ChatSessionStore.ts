import { makeAutoObservable, runInAction } from 'mobx';
import { generateNativeStream, resetNativeContext } from '../services/llm/nativeLLM';
import { modelStore } from './ModelStore';
import { parseReActToolCalls } from '../services/tools';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: any[];
}

class ChatSessionStore {
  messages: ChatMessage[] = [];
  isGenerating: boolean = false;
  error: string | null = null;
  abortController: AbortController | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  addMessage(msg: ChatMessage) {
    this.messages.push(msg);
  }

  async clearSession() {
    this.messages = [];
    if (modelStore.isLoaded('chat')) {
      await resetNativeContext('chat');
    }
  }

  async sendMessage(content: string, useToolModel = false) {
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content
    };
    this.addMessage(userMsg);

    runInAction(() => {
      this.isGenerating = true;
      this.error = null;
      this.abortController = new AbortController();
    });

    const assistantMsgId = (Date.now() + 1).toString();
    this.addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: ''
    });

    try {
      const slot = useToolModel ? 'tool' : 'chat';
      if (!modelStore.isLoaded(slot)) {
         throw new Error(`Model not loaded in slot ${slot}`);
      }

      const stream = generateNativeStream({
        messages: this.messages.slice(0, -1), // Everything except the empty assistant message
        signal: this.abortController?.signal,
        temperature: 0.7,
      }, slot);

      let fullText = '';
      for await (const chunk of stream) {
        fullText += chunk;
        
        runInAction(() => {
          const msgIdx = this.messages.findIndex(m => m.id === assistantMsgId);
          if (msgIdx !== -1) {
            this.messages[msgIdx].content = fullText;
          }
        });
      }

      // Check for tool calls if this is the tool model or we enabled tool extraction
      if (useToolModel) {
         const { calls: toolCalls } = parseReActToolCalls(fullText);
         if (toolCalls.length > 0) {
            runInAction(() => {
               const msgIdx = this.messages.findIndex(m => m.id === assistantMsgId);
               if (msgIdx !== -1) {
                 this.messages[msgIdx].toolCalls = toolCalls;
               }
            });
         }
      }

    } catch (e: any) {
      if (e.name !== 'AbortError') {
        runInAction(() => {
          this.error = e.message;
        });
      }
    } finally {
      runInAction(() => {
        this.isGenerating = false;
        this.abortController = null;
      });
    }
  }

  interrupt() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

export const chatSessionStore = new ChatSessionStore();
