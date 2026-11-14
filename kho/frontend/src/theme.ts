import type { ThemeConfig } from 'antd';

// Giao diện: điềm tĩnh, tương phản rõ, chữ ≥ 14px, bảng dày đặc nhưng dễ đọc.
export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#1d5fa8',
    colorInfo: '#1d5fa8',
    colorSuccess: '#2e7d32',
    colorWarning: '#b26a00',
    colorError: '#c62828',
    colorText: '#1c1f23',
    colorTextSecondary: '#4a5160',
    colorTextTertiary: '#6b7280',
    colorBorder: '#c9ced6',
    colorBorderSecondary: '#e1e4e8',
    colorBgLayout: '#f2f4f7',
    fontSize: 14,
    borderRadius: 4,
    controlHeight: 34,
    fontFamily:
      '"Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  },
  components: {
    Table: {
      cellPaddingBlockSM: 6,
      cellPaddingInlineSM: 8,
      headerBg: '#e9edf3',
      headerColor: '#1c1f23',
      rowHoverBg: '#e6f0fb',
      headerSplitColor: '#d3d8e0',
    },
    Menu: {
      itemHeight: 34,
      subMenuItemBg: '#ffffff',
      itemSelectedBg: '#e1ecf8',
      itemSelectedColor: '#1d5fa8',
      itemMarginBlock: 1,
      groupTitleColor: '#6b7280',
    },
    Layout: {
      headerHeight: 48,
      headerPadding: '0 16px',
      headerBg: '#ffffff',
      siderBg: '#ffffff',
    },
    Form: { itemMarginBottom: 14, verticalLabelPadding: '0 0 4px' },
    Modal: { titleFontSize: 17 },
  },
};
