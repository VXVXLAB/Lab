import { useCallback, useState } from 'react';

/** Trạng thái hộp thoại thêm/sửa: `record = null` là thêm mới. */
export function useEditor<T>() {
  const [state, setState] = useState<{ open: boolean; record: T | null }>({ open: false, record: null });
  const openCreate = useCallback(() => setState({ open: true, record: null }), []);
  const openEdit = useCallback((record: T) => setState({ open: true, record }), []);
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  return { ...state, openCreate, openEdit, close };
}
