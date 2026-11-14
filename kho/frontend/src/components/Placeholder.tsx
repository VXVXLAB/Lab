import { Result } from 'antd';
import { ToolOutlined } from '@ant-design/icons';

/** Màn chưa làm: giữ chỗ để menu và đường dẫn ổn định. */
export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <Result
      icon={<ToolOutlined style={{ color: '#8c8c8c' }} />}
      title={title}
      subTitle={
        <>
          Đang xây dựng — chức năng này sẽ có trong đợt cập nhật tới.
          {note && (
            <>
              <br />
              {note}
            </>
          )}
        </>
      }
    />
  );
}
