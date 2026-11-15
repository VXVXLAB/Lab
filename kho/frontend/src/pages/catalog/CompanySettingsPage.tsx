import { useEffect, useRef, useState } from 'react';
import { App, Alert, Button, Form, Input, Select, Skeleton, Space } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '../../api/client';
import { useSettings } from '../../api/hooks';
import { vatApi } from '../../api/extended';
import { useFeature } from '../../auth/AuthContext';
import { qk } from '../../api/queryKeys';
import { settingsApi } from '../../api/reports';
import type { Settings } from '../../api/types';
import { Kbd } from '../../components/Kbd';
import { PageHeader } from '../../components/PageHeader';
import { formatDateTime } from '../../lib/format';
import { enterToNext, focusFirstField, useHotkeys } from '../../lib/keyboard';

/** Thông tin công ty in trên đầu mọi phiếu và file xuất (chỉ quản trị sửa). */
export function CompanySettingsPage() {
  const vatOn = useFeature('vat');
  const q = useSettings();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<Settings>();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.data) {
      form.setFieldsValue(q.data);
      window.setTimeout(() => focusFirstField(ref.current), 50);
    }
  }, [q.data, form]);

  const save = async () => {
    setErr(null);
    const v = await form.validateFields();
    setSaving(true);
    try {
      const s = await settingsApi.update({
        company_name: (v.company_name ?? '').trim(),
        company_address: (v.company_address ?? '').trim(),
        company_phone: (v.company_phone ?? '').trim(),
        company_tax_code: (v.company_tax_code ?? '').trim(),
      });
      qc.setQueryData(qk.catalog('settings'), s);
      message.success('Đã lưu thông tin công ty', 1.5);
    } catch (e) {
      if (e instanceof ApiError && e.field) form.setFields([{ name: e.field as keyof Settings, errors: [e.message] }]);
      else setErr(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  useHotkeys({ 'Ctrl+s': () => void save() });

  if (q.isLoading) return <Skeleton active />;
  return (
    <div className="settings-page">
      <PageHeader
        title="Thông tin công ty"
        sub="In ở đầu mọi phiếu (in trên giấy, Excel, Word) và báo cáo. Mục nào để trống thì không in."
        actions={
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
            Lưu <Kbd>Ctrl+S</Kbd>
          </Button>
        }
      />
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      <div className="settings-card" ref={ref} onKeyDownCapture={enterToNext(() => void save())}>
        <Form<Settings> form={form} layout="horizontal" labelCol={{ flex: '150px' }} labelAlign="left" colon={false}>
          <Form.Item label="Tên công ty" name="company_name" rules={[{ max: 500 }]}>
            <Input placeholder="VD: CÔNG TY TNHH VẬT TƯ HÀN …" />
          </Form.Item>
          <Form.Item label="Địa chỉ" name="company_address" rules={[{ max: 500 }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Điện thoại" name="company_phone" rules={[{ max: 500 }]}>
            <Input style={{ width: 260 }} />
          </Form.Item>
          <Form.Item label="Mã số thuế" name="company_tax_code" rules={[{ max: 500 }]}>
            <Input style={{ width: 260 }} />
          </Form.Item>
        </Form>
        {q.data?.updated_at && (
          <div className="muted">
            Sửa lần cuối: {q.data.updated_by_name} lúc {formatDateTime(q.data.updated_at)}
          </div>
        )}
      </div>
      {vatOn && <VatDefaultSetting />}
    </div>
  );
}

/** C11: thuế suất mặc định chung (dùng khi mặt hàng không đặt thuế suất riêng). */
function VatDefaultSetting() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'vat'], queryFn: vatApi.getDefault });
  const save = async (v: string | null) => {
    try {
      const r = await vatApi.setDefault(v);
      qc.setQueryData(['settings', 'vat'], r);
      message.success('Đã lưu thuế suất mặc định', 1.5);
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  return (
    <div className="settings-card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Thuế GTGT</h3>
      <Space align="center" wrap>
        <span>Thuế suất mặc định cho mặt hàng chưa đặt riêng:</span>
        <Select<string>
          style={{ width: 220 }}
          loading={q.isLoading}
          value={q.data ? (q.data.default_vat_rate ?? 'KCT') : undefined}
          onChange={(v) => void save(v === 'KCT' ? null : v)}
          options={[
            { value: 'KCT', label: 'Không thuế / KCT' },
            { value: '0', label: '0%' },
            { value: '5', label: '5%' },
            { value: '8', label: '8%' },
            { value: '10', label: '10%' },
          ]}
          aria-label="Thuế suất mặc định"
        />
      </Space>
      <div className="muted" style={{ marginTop: 6 }}>Áp cho dòng phiếu mua / bán mới; phiếu đã lập giữ nguyên thuế suất của từng dòng.</div>
    </div>
  );
}
