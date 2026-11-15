import { App, Alert, Skeleton, Switch, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '../../api/client';
import { featuresApi } from '../../api/extended';
import type { FeatureItem, FeatureKey } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../components/PageHeader';

/** Các tính năng đã làm xong (đợt M1). Máy chủ mới trả `available`; máy chủ cũ chưa có thì dùng danh sách này. */
const READY: FeatureKey[] = ['permissions', 'period_lock', 'import_excel'];

/** Giải thích bằng lời thường (khi máy chủ chưa gửi `description`). */
const ABOUT: Record<FeatureKey, { what: string; on: string; off: string }> = {
  permissions: {
    what: 'Chia người dùng thành Kế toán, Bán hàng, Mua hàng, Thủ kho; mỗi vai trò chỉ thấy và làm được phần việc của mình. Người không có quyền xem giá mua thì không thấy giá vốn, giá nhập.',
    on: 'Thêm màn Hệ thống › Phân quyền và các vai trò mới khi sửa người dùng. Ai thiếu quyền sẽ không thấy nút, menu tương ứng.',
    off: 'Mọi người dùng lại làm được mọi việc như bản chuẩn; người đang mang vai trò mới được coi như Kế toán.',
  },
  period_lock: {
    what: 'Chốt sổ đến một ngày: chứng từ và phiếu thu chi từ ngày đó trở về trước không sửa, không xóa, không ghi sổ được nữa.',
    on: 'Thêm màn Hệ thống › Khóa sổ. Phiếu trong kỳ đã khóa có nhãn "Đã khóa sổ".',
    off: 'Không còn chặn sửa theo ngày khóa (ngày khóa vẫn được nhớ để bật lại).',
  },
  import_excel: {
    what: 'Nhập danh mục hàng hóa, đối tác, tồn đầu kỳ, công nợ đầu kỳ từ file Excel theo mẫu, có kiểm tra lỗi từng dòng trước khi nhập.',
    on: 'Thêm màn Danh mục › Nhập từ Excel.',
    off: 'Ẩn màn nhập Excel. Dữ liệu đã nhập vẫn giữ nguyên.',
  },
  min_stock: { what: 'Đặt mức tồn tối thiểu riêng cho từng mã hàng; "Hàng cần đặt" dùng mức này.', on: '', off: '' },
  price_list: { what: 'Bảng giá riêng theo khách hàng, tự điền khi lập phiếu bán.', on: '', off: '' },
  credit_limit: { what: 'Hạn mức nợ cho từng khách và báo cáo tuổi nợ.', on: '', off: '' },
  profit_report: { what: 'Báo cáo lãi gộp theo phiếu, theo mặt hàng, theo khách.', on: '', off: '' },
  stocktake: { what: 'Phiếu kiểm kê: đếm thực tế, tự tính chênh lệch và điều chỉnh tồn.', on: '', off: '' },
  unit_conversion: { what: 'Mua theo thùng, bán theo cái: quy đổi đơn vị tính.', on: '', off: '' },
  vat: { what: 'Thuế GTGT trên phiếu bán, phiếu mua.', on: '', off: '' },
  print_template: { what: 'Tự chỉnh mẫu in phiếu (logo, chữ ký, ghi chú cuối phiếu).', on: '', off: '' },
};

const qkFeatures = ['features'] as const;

/** Danh mục › Tính năng mở rộng (chỉ quản trị; có ở cả bản chuẩn để bật tính năng). */
export function FeaturesPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const q = useQuery({ queryKey: qkFeatures, queryFn: featuresApi.get });

  const list: FeatureItem[] = (() => {
    const d = q.data;
    if (!d) return [];
    const src: FeatureItem[] = d.items ?? d.keys ?? (Object.keys(d.features) as FeatureKey[]).map((key) => ({ key, name: key }));
    return src.map((it) => ({
      ...it,
      enabled: it.enabled ?? !!d.features[it.key],
      available: it.available ?? READY.includes(it.key),
    }));
  })();

  const apply = async (key: FeatureKey, on: boolean, confirm = false) => {
    try {
      await featuresApi.set({ [key]: on }, confirm);
      message.success(on ? 'Đã bật tính năng' : 'Đã tắt tính năng', 1.5);
      await Promise.all([qc.invalidateQueries({ queryKey: qkFeatures }), refresh()]);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IN_USE' && !confirm) {
        const users = usersOf(e.details);
        modal.confirm({
          title: 'Còn người dùng mang vai trò mới',
          width: 520,
          content: (
            <>
              <p>{e.message}</p>
              {users.length > 0 && (
                <ul>
                  {users.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              )}
              <p>Nếu vẫn tắt, những người này được coi như <b>Kế toán</b> (làm được mọi nghiệp vụ) cho tới khi bật lại.</p>
            </>
          ),
          okText: 'Vẫn tắt',
          okButtonProps: { danger: true },
          cancelText: 'Để nguyên',
          onOk: () => apply(key, on, true),
        });
      } else message.error(errorMessage(e));
    }
  };

  const ask = (it: FeatureItem, on: boolean) => {
    const about = ABOUT[it.key];
    modal.confirm({
      title: `${on ? 'Bật' : 'Tắt'} “${it.name}”?`,
      width: 520,
      content: (
        <>
          <p>{about?.what ?? it.description}</p>
          {(on ? about?.on : about?.off) && <p>{on ? about.on : about.off}</p>}
          <p className="muted">Các máy khác thấy thay đổi ngay, không cần tải lại.</p>
        </>
      ),
      okText: on ? 'Bật' : 'Tắt',
      okButtonProps: on ? undefined : { danger: true },
      cancelText: 'Thôi',
      onOk: () => apply(it.key, on),
    });
  };

  return (
    <div className="features-page">
      <PageHeader
        title="Tính năng mở rộng"
        sub="Bật thêm những phần việc ngoài bản chuẩn. Tắt một tính năng thì phần mềm trở lại như bản chuẩn; số liệu đã ghi vẫn giữ nguyên."
      />
      {q.isLoading ? (
        <Skeleton active />
      ) : q.isError ? (
        <Alert type="error" showIcon message={errorMessage(q.error)} />
      ) : (
        <div className="feature-list">
          {list.map((it) => (
            <div key={it.key} className={`feature-row${it.available ? '' : ' feature-soon'}`}>
              <div className="feature-text">
                <div className="feature-name">
                  {it.name} {!it.available && <Tag>Sắp có</Tag>}
                  {it.available && it.enabled && <Tag color="green">Đang bật</Tag>}
                </div>
                <div className="feature-desc">{ABOUT[it.key]?.what ?? it.description}</div>
              </div>
              <Switch
                checked={!!it.enabled && !!it.available}
                disabled={!it.available}
                onChange={(v) => ask(it, v)}
                aria-label={`${it.enabled ? 'Tắt' : 'Bật'} ${it.name}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function usersOf(details: unknown): string[] {
  const u = (details as { users?: unknown } | null)?.users;
  if (!Array.isArray(u)) return [];
  return u.map((x) => {
    if (typeof x === 'string') return x;
    const o = x as { full_name?: string; username?: string; name?: string };
    return o.full_name ? `${o.full_name}${o.username ? ` (${o.username})` : ''}` : (o.name ?? o.username ?? '');
  });
}
