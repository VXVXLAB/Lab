import { App, Alert, Skeleton, Switch, Tag } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '../../api/client';
import { featuresApi } from '../../api/extended';
import type { FeatureItem, FeatureKey } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { PageHeader } from '../../components/PageHeader';

/** Các tính năng đã làm xong (đợt M1). Máy chủ mới trả `available`; máy chủ cũ chưa có thì dùng danh sách này. */
const READY: FeatureKey[] = ['permissions', 'period_lock', 'import_excel', 'min_stock', 'price_list', 'credit_limit', 'profit_report'];

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
  min_stock: {
    what: 'Đặt tồn tối thiểu cho từng mã hàng. Mã có tồn (tổng các kho) không quá mức này được báo "dưới mức tối thiểu"; Hàng cần đặt tính luôn số cần đặt thêm để còn đủ mức.',
    on: 'Thêm ô "Tồn tối thiểu" trong Danh mục › Hàng hóa, báo cáo "Hàng dưới mức tối thiểu"; ô "Hàng sắp hết" ở Tổng quan dùng mức của từng mã.',
    off: 'Trở lại cách cũ: hàng sắp hết = tồn ≤ 5. Mức tối thiểu đã đặt vẫn được nhớ.',
  },
  price_list: {
    what: 'Mỗi khách có bảng giá riêng. Lập phiếu bán, giá tự điền theo thứ tự: giá riêng của khách → giá bán lần trước cho khách đó → giá bán mặc định; dưới ô giá ghi rõ lấy từ đâu.',
    on: 'Thêm "Bảng giá riêng" ở Danh mục › Khách hàng, nút "Lưu giá này cho khách" trên phiếu bán, loại "Bảng giá riêng" ở Nhập từ Excel.',
    off: 'Phiếu bán lại tự điền giá bán mặc định như bản chuẩn. Bảng giá đã lập vẫn được giữ.',
  },
  credit_limit: {
    what: 'Đặt hạn mức nợ và số ngày được nợ cho từng khách. Ghi sổ phiếu bán làm khách nợ vượt hạn mức thì phần mềm hỏi lại (không chặn hẳn). Có báo cáo Tuổi nợ phải thu.',
    on: 'Thêm ô "Hạn mức nợ", "Số ngày được nợ" ở hồ sơ khách, dòng "Nợ hiện tại / Hạn mức" trên phiếu bán, báo cáo Tuổi nợ phải thu.',
    off: 'Không còn hỏi khi vượt hạn mức; hạn mức đã đặt vẫn được nhớ.',
  },
  profit_report: {
    what: 'Báo cáo lãi gộp theo phiếu, theo mặt hàng, theo khách. Giá vốn tính bình quân gia quyền sau mỗi lần nhập, chung các kho.',
    on: 'Thêm báo cáo "Lãi gộp" ở trang Báo cáo (người có quyền xem giá mua và xem báo cáo).',
    off: 'Ẩn báo cáo Lãi gộp.',
  },
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
