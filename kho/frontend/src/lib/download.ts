/** Tải file từ máy chủ (cookie phiên tự gửi kèm vì cùng địa chỉ). */
export function download(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** In vùng báo cáo đang xem (ẩn menu, thanh lọc…; bảng in đủ mọi dòng). */
export function printReport(from?: HTMLElement | null): void {
  // In từ trong ngăn kéo chi tiết ⇒ chỉ in ngăn kéo đó
  const drawer = from?.closest<HTMLElement>('.ant-drawer') ?? null;
  if (drawer) {
    drawer.classList.add('print-this');
    document.body.classList.add('printing-drawer');
  }
  document.body.classList.add('printing-report');
  // Báo cáo nhiều cột ⇒ in ngang khổ A4
  const page = document.createElement('style');
  page.textContent = '@page { size: A4 landscape; margin: 10mm; }';
  document.head.appendChild(page);
  const done = () => {
    document.body.classList.remove('printing-report', 'printing-drawer');
    drawer?.classList.remove('print-this');
    page.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  window.setTimeout(done, 1000);
}
