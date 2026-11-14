import { Fragment, type ReactNode } from 'react';
import guide from '../../../docs/HUONG_DAN_SU_DUNG.md?raw';
import { PageHeader } from '../components/PageHeader';

// Một nguồn nội dung duy nhất: docs/HUONG_DAN_SU_DUNG.md (cũng là tài liệu bàn giao).
// Trình hiển thị Markdown tối giản: tiêu đề, đoạn, danh sách, bảng, **đậm**, `mã`.

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <b key={i++}>{t.slice(2, -2)}</b> : <code key={i++}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function render(md: string): { toc: { id: string; title: string }[]; body: ReactNode[] } {
  const lines = md.split('\n');
  const body: ReactNode[] = [];
  const toc: { id: string; title: string }[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.startsWith('# ')) {
      i++;
      continue; // tiêu đề trang đã có
    }
    if (l.startsWith('## ')) {
      const title = l.slice(3).trim();
      const id = `muc-${toc.length + 1}`;
      toc.push({ id, title });
      body.push(<h3 key={k++} id={id}>{title}</h3>);
      i++;
      continue;
    }
    if (/^\d+\. /.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i]!)) items.push(lines[i++]!.replace(/^\d+\. /, ''));
      body.push(<ol key={k++}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>);
      continue;
    }
    if (l.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('- ')) items.push(lines[i++]!.slice(2));
      body.push(<ul key={k++}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
      continue;
    }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith('|')) {
        const r = lines[i++]!.split('|').slice(1, -1).map((c) => c.trim());
        if (!r.every((c) => /^-+$/.test(c))) rows.push(r);
      }
      const [head, ...rest] = rows;
      body.push(
        <table key={k++} className="guide-table">
          <thead>
            <tr>{head?.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rest.map((r, j) => (
              <tr key={j}>{r.map((c, n) => <td key={n}>{inline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (l.trim()) body.push(<p key={k++}>{inline(l)}</p>);
    i++;
  }
  return { toc, body };
}

export function GuidePage() {
  const { toc, body } = render(guide);
  return (
    <div className="guide">
      <PageHeader title="Hướng dẫn sử dụng" sub="Các việc thường làm, từng bước. Bấm mục bên trái để đi nhanh." />
      <div className="guide-layout">
        <nav className="guide-toc">
          {toc.map((t) => (
            <a key={t.id} href={`#${t.id}`} onClick={(e) => (e.preventDefault(), document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth' }))}>
              {t.title}
            </a>
          ))}
        </nav>
        <article className="guide-body">
          {body.map((n, i) => (
            <Fragment key={i}>{n}</Fragment>
          ))}
        </article>
      </div>
    </div>
  );
}
