import { Radio } from 'antd';
import type { MergeChoice } from '../lib/merge3';

/** Lựa chọn cho một dòng hai máy cùng sửa: mặc định giữ bản máy kia đã lưu. */
export function MergeChoicePicker({ value, onChange, text }: { value: MergeChoice; onChange: (v: MergeChoice) => void; text: string }) {
  return (
    <span className="merge-choice">
      <span className="merge-choice-text">{text}</span>{' '}
      <Radio.Group size="small" value={value} onChange={(e) => onChange(e.target.value as MergeChoice)} optionType="button">
        <Radio value="theirs">Giữ của máy kia</Radio>
        <Radio value="mine">Dùng của tôi</Radio>
      </Radio.Group>
    </span>
  );
}
