import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useRouterState } from '@tanstack/react-router';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import toast from '@/lib/toast';
import { useTranslation } from '@/hooks/useTranslation';
import { apiDelete, apiFetchJson, apiPost, apiPut } from '@/lib/api';
import { formatApiErrorMessage } from '@/lib/apiErrorMessage';

export type ChatRow = {
  chat_id: number;
  title: string;
  start_time: string;
};

type ChatSessionContextValue = {
  selectedChatId: number | null;
  setSelectedChatId: Dispatch<SetStateAction<number | null>>;
  openChatMenuId: number | null;
  setOpenChatMenuId: Dispatch<SetStateAction<number | null>>;
  renamingChatId: number | null;
  setRenamingChatId: Dispatch<SetStateAction<number | null>>;
  renameValue: string;
  setRenameValue: Dispatch<SetStateAction<string>>;
  settingsOpen: boolean;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  chats: ChatRow[];
  isLoadingChats: boolean;
  createChatMutation: UseMutationResult<ChatRow, Error, void, unknown>;
  renameChatMutation: UseMutationResult<unknown, Error, { chatId: number; title: string }, unknown>;
  deleteChatMutation: UseMutationResult<void, Error, number, unknown>;
  hasManuallySelectedRef: React.MutableRefObject<boolean>;
  newChatToken: number;
  requestNewChat: () => void;
};

const ChatSessionContext = createContext<ChatSessionContextValue | null>(null);

export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isChatRoute = pathname === '/' || pathname === '';

  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [openChatMenuId, setOpenChatMenuId] = useState<number | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const hasManuallySelectedRef = useRef(false);
  const [newChatToken, setNewChatToken] = useState(0);

  const requestNewChat = useCallback(() => {
    hasManuallySelectedRef.current = true;
    setSelectedChatId(null);
    setNewChatToken((c) => c + 1);
  }, []);

  const { data: chats = [], isLoading: isLoadingChats } = useQuery({
    queryKey: ['chats'],
    queryFn: () => apiFetchJson<ChatRow[]>('/api/chats'),
    enabled: isChatRoute,
  });

  const createChatMutation = useMutation({
    mutationFn: async () => {
      const res = await apiPost('/api/chats', {});
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'chat.createFailed'));
      }
      return (await res.json()) as ChatRow;
    },
    onSuccess: (createdChat) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setSelectedChatId(createdChat.chat_id);
      toast.success(t('chat.newChat'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const renameChatMutation = useMutation({
    mutationFn: async (payload: { chatId: number; title: string }) => {
      const res = await apiPut(`/api/chats/${payload.chatId}/title`, {
        title: payload.title,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'chat.renameFailed'));
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setRenamingChatId(null);
      setRenameValue('');
      setOpenChatMenuId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteChatMutation = useMutation({
    mutationFn: async (chatId: number) => {
      const res = await apiDelete(`/api/chats/${chatId}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(formatApiErrorMessage(t, errorData, 'chat.deleteFailed'));
      }
    },
    onSuccess: (_data, deletedChatId) => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setSelectedChatId((current) => (current === deletedChatId ? null : current));
      setOpenChatMenuId(null);
      toast.success(t('chat.chatDeleted'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  useEffect(() => {
    if (openChatMenuId == null) return;
    const handleClick = () => setOpenChatMenuId(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [openChatMenuId]);

  const value = useMemo(
    () => ({
      selectedChatId,
      setSelectedChatId,
      openChatMenuId,
      setOpenChatMenuId,
      renamingChatId,
      setRenamingChatId,
      renameValue,
      setRenameValue,
      settingsOpen,
      setSettingsOpen,
      chats,
      isLoadingChats,
      createChatMutation,
      renameChatMutation,
      deleteChatMutation,
      hasManuallySelectedRef,
      newChatToken,
      requestNewChat,
    }),
    [
      selectedChatId,
      openChatMenuId,
      renamingChatId,
      renameValue,
      settingsOpen,
      chats,
      isLoadingChats,
      createChatMutation,
      renameChatMutation,
      deleteChatMutation,
      newChatToken,
      requestNewChat,
    ]
  );

  return <ChatSessionContext.Provider value={value}>{children}</ChatSessionContext.Provider>;
}

export function useChatSession() {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) {
    throw new Error('useChatSession must be used within ChatSessionProvider');
  }
  return ctx;
}
