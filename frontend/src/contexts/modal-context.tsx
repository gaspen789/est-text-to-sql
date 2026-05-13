import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

export type AlertOptions = {
  title?: string;
  message: string;
  okText?: string;
};

type ModalContextValue = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: AlertOptions) => Promise<void>;
};

type InternalModalState =
  | { kind: 'none' }
  | ({
      kind: 'confirm';
      resolve: (v: boolean) => void;
    } & Required<Pick<ConfirmOptions, 'message'>> &
      Omit<ConfirmOptions, 'message'>)
  | ({
      kind: 'alert';
      resolve: () => void;
    } & Required<Pick<AlertOptions, 'message'>> &
      Omit<AlertOptions, 'message'>);

const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InternalModalState>({ kind: 'none' });
  const lastFocusedElRef = useRef<HTMLElement | null>(null);

  const closeAndRestoreFocus = useCallback(() => {
    setState({ kind: 'none' });
    const el = lastFocusedElRef.current;
    lastFocusedElRef.current = null;
    // Restore focus on next tick so the modal DOM is gone.
    queueMicrotask(() => el?.focus?.());
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      lastFocusedElRef.current = document.activeElement as HTMLElement | null;
      setState({
        kind: 'confirm',
        resolve,
        title: opts.title,
        message: opts.message,
        confirmText: opts.confirmText,
        cancelText: opts.cancelText,
        destructive: opts.destructive,
      });
    });
  }, []);

  const alert = useCallback((opts: AlertOptions) => {
    return new Promise<void>((resolve) => {
      lastFocusedElRef.current = document.activeElement as HTMLElement | null;
      setState({
        kind: 'alert',
        resolve,
        title: opts.title,
        message: opts.message,
        okText: opts.okText,
      });
    });
  }, []);

  useEffect(() => {
    if (state.kind === 'none') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (state.kind === 'confirm') state.resolve(false);
      if (state.kind === 'alert') state.resolve();
      closeAndRestoreFocus();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeAndRestoreFocus, state]);

  const value = useMemo(() => ({ confirm, alert }), [confirm, alert]);

  return (
    <ModalContext.Provider value={value}>
      {children}
      {state.kind === 'none' ? null : (
        <ModalRoot
          state={state}
          onClose={(result) => {
            if (state.kind === 'confirm') state.resolve(result);
            if (state.kind === 'alert') state.resolve();
            closeAndRestoreFocus();
          }}
        />
      )}
    </ModalContext.Provider>
  );
}

function ModalRoot({
  state,
  onClose,
}: {
  state: Exclude<InternalModalState, { kind: 'none' }>;
  onClose: (confirmResult: boolean) => void;
}) {
  const titleId = 'app-modal-title';
  const bodyId = 'app-modal-body';

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onMouseDown={(e) => {
        if (e.currentTarget !== e.target) return;
        onClose(false);
      }}
    >
      <div className="bg-card border border-border rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4">
        {state.title ? (
          <h3 id={titleId} className="text-[15px] font-semibold">
            {state.title}
          </h3>
        ) : (
          <div id={titleId} className="sr-only">
            Modal
          </div>
        )}

        <div id={bodyId} className="text-[13px] text-muted-foreground whitespace-pre-wrap">
          {state.message}
        </div>

        <div className="flex justify-end gap-2">
          {state.kind === 'confirm' ? (
            <>
              <Button type="button" variant="outline" onClick={() => onClose(false)}>
                {state.cancelText ?? 'Cancel'}
              </Button>
              <Button
                type="button"
                className={state.destructive ? 'bg-destructive hover:bg-destructive/90' : ''}
                onClick={() => onClose(true)}
              >
                {state.confirmText ?? 'OK'}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => onClose(true)}>
              {state.okText ?? 'OK'}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}
