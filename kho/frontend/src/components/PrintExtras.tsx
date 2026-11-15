import type { ActiveTemplate } from '../lib/printTemplate';

/** Logo trên đầu bản in (mẫu in, bản mở rộng C12). Không có mẫu / logo ⇒ không vẽ gì. */
export function PrintLogo({ tpl }: { tpl: ActiveTemplate | null }) {
  if (!tpl?.logoUrl) return null;
  return <img className="ps-logo" src={tpl.logoUrl} alt="Logo" />;
}

/** Dòng chân trang của mẫu in. */
export function PrintFooter({ tpl }: { tpl: ActiveTemplate | null }) {
  const f = tpl?.template.footer?.trim();
  if (!f) return null;
  return <div className="ps-footer-line">{f}</div>;
}
