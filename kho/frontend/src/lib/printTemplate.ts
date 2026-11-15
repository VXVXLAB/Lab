// Mẫu in (bản mở rộng C12): đọc một lần, dùng cho mọi bản in. Tính năng tắt ⇒ null (bản in như bản chuẩn).
import { useQuery } from '@tanstack/react-query';
import { printTemplateApi } from '../api/extended';
import type { PrintTemplateResponse } from '../api/types';
import { useFeature } from '../auth/AuthContext';

export const qkPrintTemplate = ['print-template'] as const;

export interface ActiveTemplate extends PrintTemplateResponse {
  logoUrl: string | null;
}

export function usePrintTemplate(): ActiveTemplate | null {
  const on = useFeature('print_template');
  const q = useQuery({ queryKey: qkPrintTemplate, queryFn: printTemplateApi.get, enabled: on, staleTime: 5 * 60_000 });
  if (!on || !q.data) return null;
  const t = q.data.template;
  return { ...q.data, logoUrl: t.has_logo ? printTemplateApi.logoUrl(t.logo_updated_at) : null };
}

/** Tên các ô ký của loại phiếu: theo mẫu in nếu đã đặt, ngược lại theo mặc định của phần mềm. */
export function signersOf(t: ActiveTemplate | null, key: string, fallback: string[]): string[] {
  const s = t?.template.signatures[key];
  return s && s.length ? s : fallback;
}
