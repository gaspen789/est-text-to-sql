import { ChevronDown, ChevronRight, MessageSquare, MoreHorizontal, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatSession } from '@/contexts/chat-session-context';
import { useTranslation } from '@/hooks/useTranslation';
import { useState } from 'react';

/** Matches backend `isProvisionalChatTitle` (hex buffer titles before rename). */
function isProvisionalChatTitle(title: string, chatId: number): boolean {
  const trimmed = title.trim();
  if (trimmed === `Chat ${Number(chatId)}`) return true;
  return /^[0-9a-f]{8,30}$/i.test(trimmed) && trimmed.length >= 8 && trimmed.length <= 30;
}

export function ChatSidebarPanel() {
  const { t } = useTranslation();
  const [chatsOpen, setChatsOpen] = useState(true);
  const {
    selectedChatId,
    setSelectedChatId,
    openChatMenuId,
    setOpenChatMenuId,
    renamingChatId,
    setRenamingChatId,
    renameValue,
    setRenameValue,
    chats,
    isLoadingChats,
    renameChatMutation,
    deleteChatMutation,
    hasManuallySelectedRef,
    requestNewChat,
  } = useChatSession();

  return (
    <div id="chat-sidebar" className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 p-3 space-y-2 overflow-y-auto min-h-0">
        <div className="rounded-lg border border-border bg-card/30 overflow-hidden">
          <button
            type="button"
            className="w-full pl-3 pr-4 py-2.5 flex items-center justify-between gap-2 hover:bg-muted/40 transition-colors"
            onClick={() => setChatsOpen((v) => !v)}
            aria-expanded={chatsOpen}
          >
            <span className="flex items-center gap-2 min-w-0">
              <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-[13px] font-semibold truncate">
                {t('sidebar.conversations')}
              </span>
            </span>
            {chatsOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </button>

          {chatsOpen && (
            <div className="p-2 pt-1 space-y-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => requestNewChat()}
                className="w-full justify-start gap-2 text-[13px]"
              >
                <Plus className="h-4 w-4" />
                {t('sidebar.newChat')}
              </Button>

              <div className="space-y-1">
                {isLoadingChats ? (
                  <p className="text-[13px] text-muted-foreground px-2 py-1">
                    {t('common.loading')}
                  </p>
                ) : chats.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground px-2 py-1">{t('chat.noChats')}</p>
                ) : (
                  chats.map((chat) => {
                    const selected = chat.chat_id === selectedChatId;
                    const provisional = isProvisionalChatTitle(chat.title, chat.chat_id);
                    const listTitle = provisional ? t('chat.newChatTitlePlaceholder') : chat.title;
                    return (
                      <div
                        key={chat.chat_id}
                        className={`w-full rounded-md text-[13px] transition-colors ${
                          selected
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-foreground hover:bg-muted/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 px-2.5 py-2 relative">
                          {renamingChatId === chat.chat_id ? (
                            <form
                              className="flex-1 flex gap-1"
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (renameValue.trim()) {
                                  renameChatMutation.mutate({
                                    chatId: chat.chat_id,
                                    title: renameValue.trim(),
                                  });
                                }
                              }}
                            >
                              <input
                                autoFocus
                                type="text"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    setRenamingChatId(null);
                                    setRenameValue('');
                                  }
                                }}
                                placeholder={t('chat.newChatTitlePlaceholder')}
                                className="flex-1 min-w-0 px-2 py-1 text-[13px] border border-border rounded-md bg-card outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                                maxLength={30}
                              />
                              <Button
                                type="submit"
                                size="sm"
                                disabled={!renameValue.trim() || renameChatMutation.isPending}
                              >
                                {t('common.ok')}
                              </Button>
                            </form>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                hasManuallySelectedRef.current = true;
                                setSelectedChatId(chat.chat_id);
                              }}
                              aria-current={selected ? 'true' : undefined}
                              className="flex-1 text-left flex items-center min-h-8"
                            >
                              <div
                                className={`${selected ? 'font-medium' : 'font-normal'} leading-none truncate`}
                              >
                                {listTitle}
                              </div>
                            </button>
                          )}

                          <button
                            type="button"
                            className="p-1 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenChatMenuId((prev) =>
                                prev === chat.chat_id ? null : chat.chat_id
                              );
                            }}
                            title={t('chat.chatOptions')}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>

                          {openChatMenuId === chat.chat_id && (
                            <div className="absolute right-0 top-9 z-20 bg-popover text-popover-foreground border border-border rounded-md shadow-lg min-w-40 p-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingChatId(chat.chat_id);
                                  setRenameValue(provisional ? '' : chat.title);
                                  setOpenChatMenuId(null);
                                }}
                                className="w-full text-left px-2.5 py-2 text-[13px] rounded-sm hover:bg-muted"
                              >
                                {t('chat.rename')}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteChatMutation.mutate(chat.chat_id);
                                }}
                                className="w-full text-left px-2.5 py-2 text-[13px] rounded-sm hover:bg-destructive/10 text-destructive"
                              >
                                {t('chat.deleteChat')}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
