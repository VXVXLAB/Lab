import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Trang Hướng dẫn đọc docs/HUONG_DAN_SU_DUNG.md (ngoài thư mục frontend)
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Tách thư viện để trình duyệt các máy giữ cache khi chỉ mã ứng dụng đổi.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          antd: ['antd', '@ant-design/icons', 'dayjs'],
        },
      },
    },
  },
});
