import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from '@/lib/toast';
import { AlertCircle, Flag } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useChatSession } from '@/contexts/chat-session-context';
import { useTranslation } from '@/hooks/useTranslation';
import { PageHeader } from '@/components/page-header';
import { ChatAssistantContent } from '@/components/ChatAssistantContent';
import { apiFetchJson, apiPut, apiStream } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';
import type { ChatMessageRow, LlmNameRow } from '@/types/api/chat';

/** Extends ChatMessageRow with an optional flag for in-progress streamed messages. */
type DisplayMessage = ChatMessageRow & {
  isStreaming?: boolean;
  streamReasoning?: string;
  streamText?: string;
};

function formatChatSentTime(sentTime: string): string {
  try {
    const d = new Date(sentTime);
    if (Number.isNaN(d.getTime())) return sentTime;
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const dd = pad2(d.getDate());
    const mm = pad2(d.getMonth() + 1);
    const yyyy = d.getFullYear();
    const hh = pad2(d.getHours());
    const min = pad2(d.getMinutes());
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
  } catch {
    return sentTime;
  }
}

function formatAnsweringTime(answeringTimeMs: number | null | undefined): string {
  if (answeringTimeMs == null || !Number.isFinite(answeringTimeMs)) return '';
  const totalSec = Math.max(0, Math.round(answeringTimeMs / 1000));
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${String(sec).padStart(2, '0')}s`;
}

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';
    if (!isAuthenticated) {
      throw redirect({ to: '/login' as any });
    }
  },
  component: ChatPage,
});

export default function ChatPage() {
  const queryClient = useQueryClient();

  const { t } = useTranslation();
  const { selectedChatId, settingsOpen, createChatMutation, newChatToken, requestNewChat } =
    useChatSession();

  const {
    data: llmNames = [],
    isPending: llmNamesLoading,
    isFetched: llmNamesFetched,
  } = useQuery({
    queryKey: ['llm-names-active'],
    queryFn: () => apiFetchJson<LlmNameRow[]>('/api/llm-names/active'),
  });

  const noActiveLlmsInSystem = llmNamesFetched && llmNames.length === 0;

  const [selectedLlmId, setSelectedLlmId] = useState<number | null>(null);

  // Streamed assistant response (NDJSON: reasoning + text) while the request is in flight.
  const [streamingParts, setStreamingParts] = useState<{
    reasoning: string;
    text: string;
  } | null>(null);
  // User message shown optimistically before the query cache refreshes.
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<string | null>(null);
  // Last /api/chat failure (LLM or network) with context for "Try again".
  const [chatError, setChatError] = useState<{
    message: string;
    retryPlaintext: string;
    chatId: number;
    llmId: number;
  } | null>(null);

  const isStreaming = streamingParts !== null;

  // Open the chat page in the "create new chat" (blank) view.
  useLayoutEffect(() => {
    requestNewChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: messages = [], isLoading: isLoadingMessages } = useQuery({
    queryKey: ['chat-messages', selectedChatId],
    enabled: selectedChatId != null,
    queryFn: () => apiFetchJson<ChatMessageRow[]>(`/api/chats/${selectedChatId}/messages`),
  });

  const flagMessageMutation = useMutation({
    mutationFn: async (payload: { chatId: number; messageId: number }) => {
      const res = await apiPut(
        `/api/chats/${payload.chatId}/messages/${payload.messageId}/flag`,
        {}
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'chat.flagFailed'));
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', variables.chatId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [composer, setComposer] = useState('');
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const resizeComposer = () => {
    const el = composerRef.current;
    if (!el) return;

    el.style.height = 'auto';
    const computed = window.getComputedStyle(el);
    const lineHeight = parseFloat(computed.lineHeight) || 20;
    const maxHeight = lineHeight * 3 + 16;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
    el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    resizeComposer();
  }, [composer]);

  useEffect(() => {
    if (settingsOpen) return;
    const el = composerRef.current;
    if (!el) return;

    // New-chat mode: always focus the composer so the user can start typing immediately.
    if (selectedChatId == null) {
      const raf = window.requestAnimationFrame(() => el.focus());
      return () => window.cancelAnimationFrame(raf);
    }

    const active = document.activeElement as HTMLElement | null;
    const activeTag = active?.tagName?.toLowerCase();
    const isTypingTarget =
      active != null &&
      (activeTag === 'input' || activeTag === 'textarea' || (active as any).isContentEditable);
    if (isTypingTarget) return;

    const sidebarRoot = document.getElementById('chat-sidebar');
    const allowStealFromSidebarClick = !!(active && sidebarRoot?.contains(active));
    const allowWhenNothingFocused = active == null || active === document.body;
    if (!allowStealFromSidebarClick && !allowWhenNothingFocused) return;

    const raf = window.requestAnimationFrame(() => el.focus());
    return () => window.cancelAnimationFrame(raf);
  }, [settingsOpen, selectedChatId, newChatToken]);

  const prevScrollKeyRef = useRef<string | null>(null);

  // Scroll to bottom when a new message arrives or streaming updates.
  // Do not auto-scroll for metadata-only updates (e.g. flag toggles) that keep
  // the same last message id and message count.
  useEffect(() => {
    const last = messages.length > 0 ? messages[messages.length - 1] : null;
    const scrollKey = `${selectedChatId ?? 'none'}:${messages.length}:${last?.message_id ?? 'none'}`;

    const prevKey = prevScrollKeyRef.current;
    prevScrollKeyRef.current = scrollKey;

    const shouldScroll =
      prevKey == null || // first render
      streamingParts != null || // keep following while streaming
      chatError != null || // keep error visible near bottom
      prevKey.split(':')[0] !== String(selectedChatId ?? 'none') || // changed chat
      prevKey !== scrollKey; // message count or last message changed

    if (!shouldScroll) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [selectedChatId, messages, streamingParts, chatError]);

  useEffect(() => {
    if (selectedChatId == null) setComposer('');
  }, [selectedChatId]);

  useEffect(() => {
    setChatError(null);
  }, [selectedChatId]);

  const effectiveSelectedLlmId = selectedLlmId ?? llmNames[0]?.llm_id ?? null;

  const handleSend = async (options?: {
    resend?: boolean;
    retryPlaintext?: string;
    retryChatId?: number;
    retryLlmId?: number;
  }) => {
    const isResend = options?.resend === true;
    if (isResend) {
      const rp = options?.retryPlaintext?.trim() ?? '';
      const rc = options?.retryChatId;
      const rl = options?.retryLlmId;
      if (!rp || rc == null || rl == null) return;
    }

    const usedLlmId = isResend ? (options?.retryLlmId as number) : effectiveSelectedLlmId;
    if (!usedLlmId) {
      if (llmNamesLoading) return;
      toast.error(
        noActiveLlmsInSystem ? t('chat.noActiveLlmsContactAdmin') : t('chat.selectModelFirst')
      );
      return;
    }

    const currentComposerValue = composerRef.current?.value ?? composer;
    const plaintext = isResend
      ? (options?.retryPlaintext ?? '').trim()
      : currentComposerValue.trim();
    if (!plaintext) return;

    if (!isResend) {
      setComposer('');
    }
    setChatError(null);

    let targetChatId: number | null = isResend ? (options?.retryChatId ?? null) : selectedChatId;
    if (!isResend && !targetChatId) {
      try {
        const createdChat = await createChatMutation.mutateAsync();
        targetChatId = createdChat.chat_id;
      } catch {
        return;
      }
    }
    if (targetChatId == null) {
      return;
    }

    if (!isResend) {
      setOptimisticUserMessage(plaintext);
    } else {
      setOptimisticUserMessage(null);
    }
    setStreamingParts({ reasoning: '', text: '' });

    let ndjsonErrorMessage: string | null = null;

    try {
      const res = await apiStream('/api/chat', {
        chat_id: targetChatId,
        llm_id: usedLlmId,
        encrypted_content: plaintext,
        resend: isResend,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'chat.sendFailed'));
      }

      const truncated = res.headers.get('X-LLM-Input-Snapshot-Truncated') === 'true';
      const chunkCount = parseInt(res.headers.get('X-LLM-Input-Snapshot-Chunks') ?? '', 10);
      const snapshotB64 =
        res.headers.get('X-LLM-Input-Snapshot') ||
        (Number.isFinite(chunkCount) && chunkCount > 0
          ? Array.from(
              { length: chunkCount },
              (_, i) => res.headers.get(`X-LLM-Input-Snapshot-${i + 1}`) ?? ''
            ).join('')
          : null);

      if (truncated) {
        console.warn(
          '[LLM input snapshot] not logged: snapshot too large and was truncated (increase MAX_CHUNKS/CHUNK_SIZE or switch to streaming debug).'
        );
      } else if (snapshotB64) {
        try {
          const bytes = Uint8Array.from(atob(snapshotB64), (c) => c.charCodeAt(0));
          const json = new TextDecoder('utf-8').decode(bytes);
          console.log('[LLM input snapshot]', JSON.parse(json));
        } catch (e) {
          console.warn('Failed to decode X-LLM-Input-Snapshot header:', e);
        }
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let lineBuf = '';
      let reasoningAccum = '';
      let textAccum = '';

      const applyLine = (line: string) => {
        if (!line.trim()) return;
        try {
          const row = JSON.parse(line) as { type?: string; text?: string; message?: string };
          if (row.type === 'error' && typeof row.message === 'string') {
            ndjsonErrorMessage = row.message;
            return;
          }
          if (ndjsonErrorMessage) {
            return;
          }
          if (row.type === 'reasoning' && typeof row.text === 'string') {
            reasoningAccum += row.text;
          } else if (row.type === 'text' && typeof row.text === 'string') {
            textAccum += row.text;
          }
        } catch {
          // ignore malformed JSON lines
        }
        setStreamingParts({ reasoning: reasoningAccum, text: textAccum });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuf += decoder.decode(value, { stream: true });
        for (;;) {
          const nl = lineBuf.indexOf('\n');
          if (nl < 0) break;
          const line = lineBuf.slice(0, nl);
          lineBuf = lineBuf.slice(nl + 1);
          applyLine(line);
        }
      }
      lineBuf += decoder.decode();
      if (lineBuf.trim()) applyLine(lineBuf);

      if (ndjsonErrorMessage) {
        setChatError({
          message: ndjsonErrorMessage,
          retryPlaintext: plaintext,
          chatId: targetChatId,
          llmId: usedLlmId,
        });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('chat.sendFailed');
      setChatError({
        message,
        retryPlaintext: plaintext,
        chatId: targetChatId,
        llmId: usedLlmId,
      });
    } finally {
      setStreamingParts(null);
      setOptimisticUserMessage(null);
      queryClient.invalidateQueries({ queryKey: ['chat-messages', targetChatId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    }
  };

  // Build the display list: persisted messages + optimistic user msg + live streaming bubble.
  const llmNameById = (id: number) => llmNames.find((l) => l.llm_id === id)?.llm_name;
  const displayMessages: DisplayMessage[] = [
    ...messages,
    ...(optimisticUserMessage != null
      ? [
          {
            message_id: -1,
            encrypted_content: optimisticUserMessage,
            sent_time: new Date().toISOString(),
            is_sent_by_user: true,
            is_flagged_by_user: false,
            used_llm_id: usedLlmIdOrZero(effectiveSelectedLlmId),
          },
        ]
      : []),
    ...(streamingParts != null
      ? [
          {
            message_id: -2,
            encrypted_content: '',
            sent_time: new Date().toISOString(),
            is_sent_by_user: false,
            is_flagged_by_user: false,
            used_llm_id: usedLlmIdOrZero(effectiveSelectedLlmId),
            used_llm_name: effectiveSelectedLlmId ? llmNameById(effectiveSelectedLlmId) : undefined,
            isStreaming: true,
            streamReasoning: streamingParts.reasoning,
            streamText: streamingParts.text,
          },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PageHeader
          title={t('chat.title')}
          end={
            <div className="flex shrink-0 items-center gap-2">
              {llmNamesLoading ? (
                <span className="text-[13px] text-muted-foreground">{t('common.loading')}</span>
              ) : noActiveLlmsInSystem ? null : (
                <>
                  <select
                    name="used_llm_id"
                    className="h-8 w-fit rounded-md border border-input bg-card pl-3 pr-8 text-[13px] text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                    value={effectiveSelectedLlmId ?? ''}
                    onChange={(e) => setSelectedLlmId(parseInt(e.target.value))}
                    disabled={llmNames.length === 0 || isStreaming}
                  >
                    {llmNames.map((llm) => (
                      <option key={llm.llm_id} value={llm.llm_id}>
                        {llm.llm_name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          }
        />

        <div className="min-h-0 flex-1 overflow-y-auto py-8">
          {isLoadingMessages ? (
            <div className="mx-auto max-w-[780px] px-6">
              <p className="text-[13px] text-muted-foreground">{t('chat.messagesLoading')}</p>
            </div>
          ) : selectedChatId == null && displayMessages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center space-y-3 max-w-md px-2">
                {noActiveLlmsInSystem ? (
                  <p
                    role="status"
                    className="text-sm font-medium text-amber-950 dark:text-amber-50 leading-relaxed"
                  >
                    {t('chat.noActiveLlmsContactAdmin')}
                  </p>
                ) : (
                  <div className="text-muted-foreground space-y-3">
                    <p className="text-sm font-semibold">{t('chat.startNew')}</p>
                    <p className="text-xs font-medium">{t('chat.writeQuestion')}</p>
                  </div>
                )}
              </div>
            </div>
          ) : displayMessages.length === 0 ? (
            <div className="mx-auto max-w-[780px] px-6">
              <p className="text-[13px] text-muted-foreground">{t('chat.noMessages')}</p>
            </div>
          ) : (
            <div className="mx-auto max-w-[780px] px-6">
              <div className="space-y-7">
                {displayMessages.map((m) => (
                  <div
                    key={m.message_id}
                    className={`flex ${m.is_sent_by_user ? 'justify-end text-right' : 'justify-start text-left'}`}
                  >
                    <div className="max-w-[560px] min-w-0">
                      <div
                        className={`text-[12px] text-muted-foreground mb-1.5 flex items-center gap-2 ${
                          m.is_sent_by_user ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        {m.is_sent_by_user ? (
                          <>
                            <span>{formatChatSentTime(m.sent_time)}</span>
                            <span className="font-semibold text-foreground">
                              {t('chat.userLabel')}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-semibold text-foreground">
                              {m.used_llm_name ?? `LLM ${m.used_llm_id}`}
                            </span>
                            <span>
                              {formatChatSentTime(m.sent_time)}
                              {!m.isStreaming &&
                                !m.is_sent_by_user &&
                                (() => {
                                  const label = formatAnsweringTime(m.answering_time_ms);
                                  return label ? ` (${label})` : '';
                                })()}
                            </span>
                            {!m.isStreaming && (
                              <button
                                type="button"
                                onClick={() =>
                                  flagMessageMutation.mutate({
                                    chatId: selectedChatId!,
                                    messageId: m.message_id,
                                  })
                                }
                                disabled={flagMessageMutation.isPending}
                                title={
                                  m.is_flagged_by_user
                                    ? t('chat.unflagMessage')
                                    : t('chat.flagMessage')
                                }
                                className="ml-1 inline-flex items-center rounded-md p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                              >
                                <Flag
                                  className="h-3.5 w-3.5"
                                  fill={m.is_flagged_by_user ? 'currentColor' : 'none'}
                                />
                              </button>
                            )}
                          </>
                        )}
                      </div>

                      <div
                        className={`relative ${
                          m.is_sent_by_user
                            ? 'inline-block whitespace-pre-wrap rounded-xl border border-primary/15 bg-[color:color-mix(in_oklab,var(--primary)_15%,transparent)] px-4 py-3 text-[14px] text-foreground'
                            : 'text-[14px] text-foreground'
                        }`}
                      >
                        {m.is_sent_by_user ? (
                          m.encrypted_content
                        ) : m.isStreaming ? (
                          m.streamText?.length || m.streamReasoning?.length ? (
                            <ChatAssistantContent
                              thinkingLabel={t('chat.thinking')}
                              streamReasoning={m.streamReasoning}
                              streamText={m.streamText}
                              isStreaming
                            />
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                            </span>
                          )
                        ) : (
                          <ChatAssistantContent
                            thinkingLabel={t('chat.thinking')}
                            content={m.encrypted_content}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {chatError && !isStreaming && (
                  <div className="flex justify-start text-left">
                    <div className="max-w-[560px] min-w-0 w-full">
                      <div className="rounded-xl border border-destructive/25 bg-destructive/5 dark:bg-destructive/10 px-4 py-3 text-[14px]">
                        <div className="flex gap-2.5 items-start">
                          <AlertCircle
                            className="h-4 w-4 text-destructive shrink-0 mt-0.5"
                            aria-hidden
                          />
                          <div className="min-w-0 space-y-2 flex-1">
                            <p className="font-medium text-foreground">
                              {t('chat.assistantError')}
                            </p>
                            <p className="text-[13px] text-muted-foreground whitespace-pre-wrap break-words">
                              {chatError.message}
                            </p>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mt-0.5"
                              disabled={isStreaming}
                              onClick={() =>
                                void handleSend({
                                  resend: true,
                                  retryPlaintext: chatError.retryPlaintext,
                                  retryChatId: chatError.chatId,
                                  retryLlmId: chatError.llmId,
                                })
                              }
                            >
                              {t('chat.retry')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 bg-background px-6 pb-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="mx-auto max-w-[980px]"
          >
            <div className="rounded-xl border border-input bg-card shadow-sm focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] p-2">
              <div className="flex items-end gap-2">
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  disabled={isStreaming || noActiveLlmsInSystem}
                  placeholder={
                    noActiveLlmsInSystem ? t('chat.placeholderNoActiveLlms') : t('chat.placeholder')
                  }
                  className="flex-1 resize-none bg-transparent px-3 py-2 text-[14px] text-foreground outline-none disabled:opacity-50 min-h-[44px] max-h-[200px]"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="shrink-0 h-[44px]"
                  disabled={!composer.trim() || isStreaming || noActiveLlmsInSystem}
                >
                  {t('common.send')}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

function usedLlmIdOrZero(id: number | null): number {
  return id ?? 0;
}
