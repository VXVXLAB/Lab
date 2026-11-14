import type { ReactNode } from 'react';

export function PageHeader({ title, count, actions, sub }: { title: ReactNode; count?: number; actions?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h2>
          {title}
          {count !== undefined && <span className="count">{count.toLocaleString('vi-VN')}</span>}
        </h2>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
