import type { Rule } from 'antd/es/form';

export const codeRules: Rule[] = [
  { required: true, whitespace: true, message: 'Vui lòng nhập mã' },
  { pattern: /^\s*\S+\s*$/, message: 'Mã không được có khoảng trắng' },
];

export const nameRules: Rule[] = [{ required: true, whitespace: true, message: 'Vui lòng nhập tên' }];

/** Bỏ khoảng trắng hai đầu; giữ nguyên chữ hoa/thường như người dùng gõ (máy chủ so mã không phân biệt hoa thường). */
export function normalizeCode(code: string): string {
  return code.trim();
}
