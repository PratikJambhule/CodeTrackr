import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

// show(text, tone). ToastProvider (Toast.tsx) renders the messages; this file
// holds the context so Toast.tsx exports only a component (Fast Refresh).
export const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => {});

export const useToast = () => useContext(ToastContext);
