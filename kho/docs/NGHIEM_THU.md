# NGHIỆM THU — ma trận 91 đầu việc ↔ test tự động ↔ kết quả

- Test tích hợp: `backend/tests/*_test.go`, chạy trên PostgreSQL 16 thật qua HTTP (`httptest.Server` + handler thật),
  mỗi test một schema CSDL riêng (migrate + seed), độc lập, chạy song song.
- Lệnh: `cd backend && go test ./... -count=1` (và `-race`). Kết quả bên dưới là lần chạy ngày 14/11/2026 (sau đợt sửa lỗi QA B1–B5, Q1–Q3 bổ sung API giai đoạn 2 và các đợt sửa sau E2E F-02/F-03/F-07, F-09/F-12/F-13/F-16):
  **56/56 test tích hợp ĐẠT** (+ 4 unit test `internal/util`, gồm số tiền bằng chữ), cả khi chạy `-race -count=2`.
- Cột "Test" liệt kê mọi test có gắn mã (tên `TestREQxxx_…` hoặc chú thích `// REQ: …`). Một test phủ nhiều mã.
- REQ-001…008 là quy tắc nghiệp vụ đã chốt trong `docs/SPEC.md` §2 (đề xuất kỹ thuật, **cần khách xác nhận**);
  các test liệt kê ở đó minh họa quy tắc. Chỗ diễn giải SPEC: `docs/QUYET_DINH.md`.

| Mã | Đầu việc | Test | Kết quả |
|---|---|---|---|
| 001 | Mô hình 4 kho | `TestREQ001_DanhMucCRUDVaInUse`<br>`TestREQ009_010_076_TonTong4KhoVaTungKho`<br>`TestREQ011_077_ChuyenKhoNoiBo` | Quy tắc chốt trong SPEC §2 (R1); cần khách xác nhận — có test minh họa: ĐẠT |
| 002 | Nhập-Xuất-Tồn theo mã hàng | `TestREQ012_078_TheKhoViDuKhachHang`<br>`TestREQ016_NhapMuaCuaAi` | Quy tắc chốt trong SPEC §2 (R2); cần khách xác nhận — có test minh họa: ĐẠT |
| 003 | Sửa chứng từ quá khứ | `TestREQ035_039_081_SuaPhieuNhapThang1VaoThang9`<br>`TestREQ038_DoiCoDoiTacVanSuaPhieuCu`<br>`TestREQ039_BoGhiSoVaXoaPhieuTam` | Quy tắc chốt trong SPEC §2 (R3); cần khách xác nhận — có test minh họa: ĐẠT |
| 004 | Cảnh báo bán lỗ | `TestREQ028_029_080_CanhBaoBanLo` | Quy tắc chốt trong SPEC §2 (R4); cần khách xác nhận — có test minh họa: ĐẠT |
| 005 | Phiếu tạm | `TestREQ030_031_032_079_HetTonChanGhiSoVaIn`<br>`TestREQ040_045_082_PhieuTamHaiMay` | Quy tắc chốt trong SPEC §2 (R5); cần khách xác nhận — có test minh họa: ĐẠT |
| 006 | Mã Dịch vụ (DV) | `TestREQ047_083_PhieuBanMauCuaKhachVoiDichVu` | Quy tắc chốt trong SPEC §2 (R7); cần khách xác nhận — có test minh họa: ĐẠT |
| 007 | Thu - chi | `TestREQ056_061_085_ThuChiNhieuDong`<br>`TestREQ062_HoanTienKhongLamSaiCongNo` | Quy tắc chốt trong SPEC §2 (R9); cần khách xác nhận — có test minh họa: ĐẠT |
| 008 | Báo cáo & xuất file | `TestREQ008_PhucVuGiaoDienSPA`<br>`TestREQ008_SettingsLuonCoSauKhiSeed`<br>`TestREQ008_ThongTinCongTyVaGhiChuDong`<br>`TestREQ052_053_084_CongNoKhachHang`<br>`TestREQ071_074_087_XuatPhieuExcelWordChinhSuaDuoc` | Quy tắc chốt trong SPEC §2 (R10); cần khách xác nhận — có test minh họa: ĐẠT |
| 009 | Tồn tổng 4 kho | `TestREQ009_010_076_TonTong4KhoVaTungKho`<br>`TestREQ026_PriceInfoHangLoatVaDanhSachKemTon` | ĐẠT |
| 010 | Tồn từng kho | `TestREQ009_010_076_TonTong4KhoVaTungKho`<br>`TestREQ026_PriceInfoHangLoatVaDanhSachKemTon` | ĐẠT |
| 011 | Chuyển kho nội bộ | `TestREQ011_077_ChuyenKhoNoiBo`<br>`TestREQ047_073_FileXuatKhopBanIn` | ĐẠT |
| 012 | Tra cứu theo mã hàng | `TestREQ012_078_TheKhoViDuKhachHang`<br>`TestREQ012_TimMatHangNhieuTu`<br>`TestREQ019_LocThoiGianTheKho`<br>`TestREQ035_TimKhongDauMoiDanhSach` | ĐẠT |
| 013 | Tồn đầu kỳ | `TestREQ012_078_TheKhoViDuKhachHang`<br>`TestREQ019_NgayTuongMinhKhongBiThay` | ĐẠT |
| 014 | Thông tin giao dịch | `TestREQ012_078_TheKhoViDuKhachHang` | ĐẠT |
| 015 | SL Nhập-Xuất-Tồn | `TestREQ012_078_TheKhoViDuKhachHang` | ĐẠT |
| 016 | Mua của ai | `TestREQ016_NhapMuaCuaAi` | ĐẠT |
| 017 | Bán cho ai | `TestREQ012_078_TheKhoViDuKhachHang` | ĐẠT |
| 018 | Khách trả hàng | `TestREQ012_078_TheKhoViDuKhachHang` | ĐẠT |
| 019 | Lọc thời gian | `TestREQ019_LocThoiGianTheKho`<br>`TestREQ019_NgayTuongMinhKhongBiThay` | ĐẠT |
| 020 | Nhóm VTHH | `TestREQ001_DanhMucCRUDVaInUse`<br>`TestREQ012_TimMatHangNhieuTu`<br>`TestREQ020_TonTheoNhomVTHH`<br>`TestREQ035_TimKhongDauMoiDanhSach` | ĐẠT |
| 021 | Lịch sử bán từng mặt hàng | `TestREQ012_TimMatHangNhieuTu`<br>`TestREQ021_LichSuBanTungMatHang` | ĐẠT |
| 022 | Xuất tồn Excel | `TestREQ022_063_075_XuatTonKhoExcel` | ĐẠT |
| 023 | Phiếu nhập hàng | `TestREQ023_024_PhieuNhapMuaVaGhiSo`<br>`TestREQ023_056_KyTuNULTra400`<br>`TestREQ023_KiemTraDuLieuNhapKhong500`<br>`TestREQ056_SoTienSoLuongQuaNhoBiTuChoi` | ĐẠT |
| 024 | Ghi sổ phiếu nhập | `TestREQ023_024_PhieuNhapMuaVaGhiSo` | ĐẠT |
| 025 | Phiếu bán hàng | `TestREQ023_056_KyTuNULTra400`<br>`TestREQ023_KiemTraDuLieuNhapKhong500`<br>`TestREQ025_026_027_033_034_PhieuBanHang`<br>`TestREQ025_TimDoiTacTronTuTruocMotPhan`<br>`TestREQ025_TraMaKhongBao404KhiOptional`<br>`TestREQ060_TimDoiTacNhieuTuXepHang` | ĐẠT |
| 026 | Giá bán mặc định | `TestREQ001_DanhMucCRUDVaInUse`<br>`TestREQ025_026_027_033_034_PhieuBanHang`<br>`TestREQ026_PriceInfoHangLoatVaDanhSachKemTon` | ĐẠT |
| 027 | Sửa giá bán | `TestREQ025_026_027_033_034_PhieuBanHang` | ĐẠT |
| 028 | So sánh giá bán - giá mua | `TestREQ026_PriceInfoHangLoatVaDanhSachKemTon`<br>`TestREQ028_029_080_CanhBaoBanLo`<br>`TestREQ030_KiemTraPhieuChuaLuu` | ĐẠT |
| 029 | Cảnh báo bán lỗ | `TestREQ028_029_080_CanhBaoBanLo`<br>`TestREQ030_KiemTraPhieuChuaLuu` | ĐẠT |
| 030 | Kiểm tra tồn | `TestREQ023_KiemTraDuLieuNhapKhong500`<br>`TestREQ030_031_032_079_HetTonChanGhiSoVaIn`<br>`TestREQ030_KiemTraPhieuChuaLuu`<br>`TestREQ031_HaiMayCungGhiSoTranhTon` | ĐẠT |
| 031 | Chặn ghi sổ khi tồn = 0 | `TestREQ030_031_032_079_HetTonChanGhiSoVaIn`<br>`TestREQ031_HaiMayCungGhiSoTranhTon` | ĐẠT |
| 032 | Chặn in khi tồn = 0 | `TestREQ030_031_032_079_HetTonChanGhiSoVaIn` | ĐẠT |
| 033 | Trừ tồn khi bán | `TestREQ025_026_027_033_034_PhieuBanHang` | ĐẠT |
| 034 | Công nợ bán hàng | `TestREQ025_026_027_033_034_PhieuBanHang`<br>`TestREQ047_083_PhieuBanMauCuaKhachVoiDichVu`<br>`TestREQ052_053_084_CongNoKhachHang`<br>`TestREQ052_SoDuMotDoiTac` | ĐẠT |
| 035 | Mở phiếu nhập cũ | `TestREQ035_039_081_SuaPhieuNhapThang1VaoThang9`<br>`TestREQ035_TimKhongDauMoiDanhSach` | ĐẠT |
| 036 | Sửa phiếu nhập cũ | `TestREQ035_039_081_SuaPhieuNhapThang1VaoThang9`<br>`TestREQ038_DoiCoDoiTacVanSuaPhieuCu` | ĐẠT |
| 037 | Mở phiếu bán cũ | `TestREQ035_039_081_SuaPhieuNhapThang1VaoThang9`<br>`TestREQ035_TimKhongDauMoiDanhSach` | ĐẠT |
| 038 | Sửa phiếu bán cũ | `TestREQ035_039_081_SuaPhieuNhapThang1VaoThang9`<br>`TestREQ038_DoiCoDoiTacVanSuaPhieuCu` | ĐẠT |
| 039 | Cập nhật sau sửa | `TestREQ035_039_081_SuaPhieuNhapThang1VaoThang9`<br>`TestREQ039_BoGhiSoVaXoaPhieuTam`<br>`TestREQ062_XoaPhieuDangDuocPhieuThuThamChieu` | ĐẠT |
| 040 | Tạo phiếu tạm | `TestREQ040_045_082_PhieuTamHaiMay`<br>`TestREQ040_Dashboard` | ĐẠT |
| 041 | Hàng chưa có tồn | `TestREQ030_031_032_079_HetTonChanGhiSoVaIn`<br>`TestREQ030_KiemTraPhieuChuaLuu`<br>`TestREQ040_045_082_PhieuTamHaiMay` | ĐẠT |
| 042 | Dữ liệu dùng chung | `TestREQ040_045_082_PhieuTamHaiMay`<br>`TestREQ042_DangNhapPhanQuyen`<br>`TestREQ042_DoiMatKhau`<br>`TestREQ043_SuKienSSEGiuaHaiMay` | ĐẠT |
| 043 | Máy khác nhìn thấy | `TestREQ040_045_082_PhieuTamHaiMay`<br>`TestREQ043_SuKienSSEGiuaHaiMay` | ĐẠT |
| 044 | Máy khác tiếp tục | `TestREQ040_045_082_PhieuTamHaiMay`<br>`TestREQ043_SuKienSSEGiuaHaiMay`<br>`TestREQ044_IdDongOnDinhKhiSua` | ĐẠT |
| 045 | Chốt phiếu tạm | `TestREQ039_BoGhiSoVaXoaPhieuTam`<br>`TestREQ040_045_082_PhieuTamHaiMay` | ĐẠT |
| 046 | Kế toán mua xem phiếu tạm | `TestREQ046_HangCanDatTuPhieuTam` | ĐẠT |
| 047 | Mã Dịch vụ (DV) | `TestREQ025_TraMaKhongBao404KhiOptional`<br>`TestREQ047_073_FileXuatKhopBanIn`<br>`TestREQ047_083_PhieuBanMauCuaKhachVoiDichVu` | ĐẠT |
| 048 | Diễn giải Dịch vụ | `TestREQ047_083_PhieuBanMauCuaKhachVoiDichVu` | ĐẠT |
| 049 | Dịch vụ cộng tiền | `TestREQ047_083_PhieuBanMauCuaKhachVoiDichVu`<br>`TestREQ050_DichVuTruTienGiamCongNo` | ĐẠT |
| 050 | Dịch vụ trừ tiền | `TestREQ047_083_PhieuBanMauCuaKhachVoiDichVu`<br>`TestREQ050_DichVuTruTienGiamCongNo` | ĐẠT |
| 051 | Không theo dõi NXT | `TestREQ047_083_PhieuBanMauCuaKhachVoiDichVu`<br>`TestREQ050_DichVuTruTienGiamCongNo` | ĐẠT |
| 052 | Công nợ Khách hàng | `TestREQ040_Dashboard`<br>`TestREQ052_053_084_CongNoKhachHang`<br>`TestREQ052_SoDuMotDoiTac`<br>`TestREQ060_TimDoiTacNhieuTuXepHang`<br>`TestREQ062_HoanTienKhongLamSaiCongNo` | ĐẠT |
| 053 | Chi tiết công nợ KH | `TestREQ052_053_084_CongNoKhachHang` | ĐẠT |
| 054 | Công nợ NCC | `TestREQ040_Dashboard`<br>`TestREQ052_SoDuMotDoiTac`<br>`TestREQ054_055_CongNoNhaCungCap`<br>`TestREQ062_HoanTienKhongLamSaiCongNo` | ĐẠT |
| 055 | Chi tiết công nợ NCC | `TestREQ054_055_CongNoNhaCungCap` | ĐẠT |
| 056 | Thu tiền quỹ | `TestREQ019_NgayTuongMinhKhongBiThay`<br>`TestREQ023_056_KyTuNULTra400`<br>`TestREQ056_061_085_ThuChiNhieuDong`<br>`TestREQ056_SoTienSoLuongQuaNhoBiTuChoi`<br>`TestREQ067_TongTienDanhSachMoiTrang`<br>`TestREQ085_087_PhieuThuChiBangChu` | ĐẠT |
| 057 | Chi tiền quỹ | `TestREQ056_061_085_ThuChiNhieuDong`<br>`TestREQ056_SoTienSoLuongQuaNhoBiTuChoi`<br>`TestREQ085_087_PhieuThuChiBangChu` | ĐẠT |
| 058 | Thu tiền ngân hàng | `TestREQ056_061_085_ThuChiNhieuDong` | ĐẠT |
| 059 | Chi tiền ngân hàng | `TestREQ056_061_085_ThuChiNhieuDong` | ĐẠT |
| 060 | Nhiều dòng cùng KH | `TestREQ025_TimDoiTacTronTuTruocMotPhan`<br>`TestREQ056_061_085_ThuChiNhieuDong`<br>`TestREQ060_IdDongPhieuThuOnDinh`<br>`TestREQ060_TimDoiTacNhieuTuXepHang` | ĐẠT |
| 061 | Nhiều dòng cùng NCC | `TestREQ056_061_085_ThuChiNhieuDong`<br>`TestREQ060_TimDoiTacNhieuTuXepHang` | ĐẠT |
| 062 | Liên kết công nợ | `TestREQ052_053_084_CongNoKhachHang`<br>`TestREQ056_061_085_ThuChiNhieuDong`<br>`TestREQ062_HoanTienKhongLamSaiCongNo`<br>`TestREQ062_XoaPhieuDangDuocPhieuThuThamChieu` | ĐẠT |
| 063 | Báo cáo tồn kho | `TestREQ012_TimMatHangNhieuTu`<br>`TestREQ022_063_075_XuatTonKhoExcel`<br>`TestREQ071_087_ExcelCongThucSoVaDonGiaLe` | ĐẠT |
| 064 | Báo cáo NXT | `TestREQ064_BaoCaoNXT` | ĐẠT |
| 065 | Báo cáo công nợ | `TestREQ054_055_CongNoNhaCungCap`<br>`TestREQ065_066_067_070_BaoCaoMuaBanCongNo` | ĐẠT |
| 066 | Báo cáo mua hàng | `TestREQ065_066_067_070_BaoCaoMuaBanCongNo`<br>`TestREQ067_TongTienDanhSachMoiTrang` | ĐẠT |
| 067 | Báo cáo bán hàng | `TestREQ065_066_067_070_BaoCaoMuaBanCongNo`<br>`TestREQ067_TongTienDanhSachMoiTrang` | ĐẠT |
| 068 | Mở chi tiết từ báo cáo tồn | `TestREQ068_069_086_MoChiTietTuBaoCao` | ĐẠT |
| 069 | Mở chi tiết từ công nợ | `TestREQ068_069_086_MoChiTietTuBaoCao` | ĐẠT |
| 070 | Mở chi tiết từ mua/bán | `TestREQ065_066_067_070_BaoCaoMuaBanCongNo` | ĐẠT |
| 071 | Xuất phiếu nhập Excel | `TestREQ008_ThongTinCongTyVaGhiChuDong`<br>`TestREQ047_073_FileXuatKhopBanIn`<br>`TestREQ071_074_087_XuatPhieuExcelWordChinhSuaDuoc`<br>`TestREQ071_087_ExcelCongThucSoVaDonGiaLe`<br>`TestREQ073_DiaChiTrongKhongInNhanTreo` | ĐẠT |
| 072 | Xuất phiếu xuất Excel | `TestREQ008_ThongTinCongTyVaGhiChuDong`<br>`TestREQ047_073_FileXuatKhopBanIn`<br>`TestREQ071_074_087_XuatPhieuExcelWordChinhSuaDuoc`<br>`TestREQ071_087_ExcelCongThucSoVaDonGiaLe` | ĐẠT |
| 073 | Xuất phiếu Word | `TestREQ008_ThongTinCongTyVaGhiChuDong`<br>`TestREQ047_073_FileXuatKhopBanIn`<br>`TestREQ071_074_087_XuatPhieuExcelWordChinhSuaDuoc`<br>`TestREQ073_DiaChiTrongKhongInNhanTreo` | ĐẠT |
| 074 | File sau xuất chỉnh sửa được | `TestREQ071_074_087_XuatPhieuExcelWordChinhSuaDuoc`<br>`TestREQ071_087_ExcelCongThucSoVaDonGiaLe` | ĐẠT |
| 075 | Xuất tồn toàn bộ mã | `TestREQ022_063_075_XuatTonKhoExcel` | ĐẠT |
| 076 | Kiểm thử tồn 4 kho | `TestREQ009_010_076_TonTong4KhoVaTungKho`<br>`TestREQ031_HaiMayCungGhiSoTranhTon` | ĐẠT |
| 077 | Kiểm thử chuyển kho | `TestREQ011_077_ChuyenKhoNoiBo` | ĐẠT |
| 078 | Kiểm thử NXT | `TestREQ012_078_TheKhoViDuKhachHang` | ĐẠT |
| 079 | Kiểm thử hết tồn | `TestREQ030_031_032_079_HetTonChanGhiSoVaIn` | ĐẠT |
| 080 | Kiểm thử bán lỗ | `TestREQ028_029_080_CanhBaoBanLo` | ĐẠT |
| 081 | Kiểm thử sửa chứng từ cũ | `TestREQ030_KiemTraPhieuChuaLuu`<br>`TestREQ035_039_081_SuaPhieuNhapThang1VaoThang9` | ĐẠT |
| 082 | Kiểm thử phiếu tạm nhiều máy | `TestREQ040_045_082_PhieuTamHaiMay`<br>`TestREQ044_IdDongOnDinhKhiSua` | ĐẠT |
| 083 | Kiểm thử Mã Dịch vụ | `TestREQ047_083_PhieuBanMauCuaKhachVoiDichVu`<br>`TestREQ050_DichVuTruTienGiamCongNo` | ĐẠT |
| 084 | Kiểm thử công nợ | `TestREQ052_053_084_CongNoKhachHang`<br>`TestREQ054_055_CongNoNhaCungCap`<br>`TestREQ062_HoanTienKhongLamSaiCongNo` | ĐẠT |
| 085 | Kiểm thử thu-chi nhiều dòng | `TestREQ056_061_085_ThuChiNhieuDong`<br>`TestREQ060_IdDongPhieuThuOnDinh`<br>`TestREQ062_HoanTienKhongLamSaiCongNo`<br>`TestREQ085_087_PhieuThuChiBangChu` | ĐẠT |
| 086 | Kiểm thử mở chi tiết báo cáo | `TestREQ068_069_086_MoChiTietTuBaoCao` | ĐẠT |
| 087 | Kiểm thử Excel/Word | `TestREQ008_ThongTinCongTyVaGhiChuDong`<br>`TestREQ022_063_075_XuatTonKhoExcel`<br>`TestREQ071_074_087_XuatPhieuExcelWordChinhSuaDuoc`<br>`TestREQ071_087_ExcelCongThucSoVaDonGiaLe`<br>`TestREQ085_087_PhieuThuChiBangChu` | ĐẠT |
| 088 | UAT | — | Cần khách hàng (UAT / sửa lỗi sau UAT) — ngoài phạm vi tự động |
| 089 | Sửa lỗi | — | Cần khách hàng (UAT / sửa lỗi sau UAT) — ngoài phạm vi tự động |
| 090 | Hướng dẫn sử dụng | — | Chưa làm ở giai đoạn backend (tài liệu hướng dẫn sử dụng thuộc GĐ 4); có `backend/README.md`, `docs/API.md` |
| 091 | Bàn giao | — | Cần khách hàng (biên bản bàn giao) |

## Các kịch bản bắt buộc và test tương ứng

| Kịch bản | Test |
|---|---|
| Thẻ kho đúng ví dụ của khách (WW829HT107k: đầu kỳ 27; bán 4, 3 cho VĨNH PHONG; CHÚ NGỌC MINH trả 1; bán 1 cho NHỰA PHẠM GIA ⇒ tồn 23, 20, 21, 20; cộng 1 / 8 / 20; diễn giải có tên đối tượng) | `TestREQ012_078_TheKhoViDuKhachHang` |
| Phiếu bán đúng mẫu của khách (5 dòng hàng + DICHVU ghi chú giá trống + DICHVU 400.000 ⇒ Cộng 3.990.000; nợ cũ 2.000.000 ⇒ tổng nợ 5.990.000), xuất Excel + Word kiểm tra từng ô | `TestREQ047_083_PhieuBanMauCuaKhachVoiDichVu` |
| Tồn tổng 4 kho + từng kho | `TestREQ009_010_076_TonTong4KhoVaTungKho` |
| Chuyển kho nội bộ | `TestREQ011_077_ChuyenKhoNoiBo` |
| Sửa phiếu nhập tháng 1 vào tháng 9 ⇒ tồn/công nợ/báo cáo đổi; sửa lùi làm âm kho bị từ chối (giảm SL, đổi kho, dời ngày, bỏ ghi sổ) | `TestREQ035_039_081_SuaPhieuNhapThang1VaoThang9` |
| Phiếu tạm có hàng hết tồn: lập được, xuất "PHIẾU TẠM (chưa ghi sổ)", ghi sổ bị chặn | `TestREQ030_031_032_079_HetTonChanGhiSoVaIn` |
| Cảnh báo lỗ + `confirm_loss` | `TestREQ028_029_080_CanhBaoBanLo` |
| Dòng dịch vụ âm làm giảm công nợ | `TestREQ050_DichVuTruTienGiamCongNo` |
| Thu/chi nhiều dòng tiền mặt + ngân hàng | `TestREQ056_061_085_ThuChiNhieuDong` |
| Hai phiên (hai người dùng = hai máy) cùng xem, tiếp tục phiếu tạm; `VERSION_CONFLICT` khi version cũ | `TestREQ040_045_082_PhieuTamHaiMay` |
| SSE giao sự kiện giữa hai máy | `TestREQ043_SuKienSSEGiuaHaiMay` |
| Hai máy cùng ghi sổ tranh cùng lượng tồn — chỉ một thành công (5 vòng + 10 phiếu đồng thời); đã kiểm chứng bỏ khóa thì test đỏ | `TestREQ031_HaiMayCungGhiSoTranhTon` |
| Xuất xlsx/docx mở lại kiểm tra nội dung; xlsx thêm/bớt dòng cột rồi lưu; docx có `<w:tbl>` | `TestREQ071_074_087_XuatPhieuExcelWordChinhSuaDuoc`, `TestREQ022_063_075_XuatTonKhoExcel` |
| Id dòng ổn định khi sửa chứng từ / phiếu thu chi (ghép xung đột hai máy) | `TestREQ044_IdDongOnDinhKhiSua`, `TestREQ060_IdDongPhieuThuOnDinh` |
| Sửa sau E2E đợt 2: tìm đối tác trọn từ trước một phần (F-12); tìm mặt hàng nhiều từ mọi nơi (F-13); bỏ "Địa chỉ:" trống (F-09); tra mã `optional=1` không 404 (F-16) | `TestREQ025_TimDoiTacTronTuTruocMotPhan`, `TestREQ012_TimMatHangNhieuTu`, `TestREQ073_DiaChiTrongKhongInNhanTreo`, `TestREQ025_TraMaKhongBao404KhiOptional` |
| Sửa sau E2E: "Bằng chữ" trên file phiếu thu/chi (F-02); file xuất khớp bản in — DICHVU, nhãn kho, ô ký theo loại phiếu, chuyển kho không cột giá (F-03); tìm đối tác theo từ + xếp hạng (F-07); số dư một đối tác | `TestREQ085_087_PhieuThuChiBangChu`, `TestREQ047_073_FileXuatKhopBanIn`, `TestREQ060_TimDoiTacNhieuTuXepHang`, `TestREQ052_SoDuMotDoiTac`, unit `TestMoneyInWords` |
| Bổ sung API giai đoạn 2: `sum_total_amount`; price-info hàng loạt + `with_stock`; kiểm tra phiếu chưa lưu (kể cả xung đột sửa lùi); đổi mật khẩu; thông tin công ty trên file xuất; cột Ghi chú dòng | `TestREQ067_TongTienDanhSachMoiTrang`, `TestREQ026_PriceInfoHangLoatVaDanhSachKemTon`, `TestREQ030_KiemTraPhieuChuaLuu`, `TestREQ042_DoiMatKhau`, `TestREQ008_ThongTinCongTyVaGhiChuDong`, `TestREQ008_SettingsLuonCoSauKhiSeed` |
| Hồi quy lỗi QA: NUL ⇒ 400 (B1); đổi cờ đối tác vẫn sửa phiếu cũ (B2); ngày tường minh không bị thay (B3); số tiền/SL tròn về 0 bị từ chối (B4); Excel công thức ra số, đơn giá lẻ (B5); hoàn tiền NCC/khách về 0/0 với `debt_side` (Q1); xóa phiếu đang được phiếu thu tham chiếu ⇒ 409 (Q2); tìm không dấu mọi danh sách (Q3) | `TestREQ023_056_KyTuNULTra400`, `TestREQ038_DoiCoDoiTacVanSuaPhieuCu`, `TestREQ019_NgayTuongMinhKhongBiThay`, `TestREQ056_SoTienSoLuongQuaNhoBiTuChoi`, `TestREQ071_087_ExcelCongThucSoVaDonGiaLe`, `TestREQ062_HoanTienKhongLamSaiCongNo`, `TestREQ062_XoaPhieuDangDuocPhieuThuThamChieu`, `TestREQ035_TimKhongDauMoiDanhSach` |

## Bộ QA hộp đen độc lập (`qa/`)

`cd qa && ./run.sh` (ngày 15/11/2026, sau đợt sửa F-09/F-12/F-13/F-16): **45 test, 45 ĐẠT**, 0 phản hồi 5xx.

## Bản mở rộng — đợt M1 (SPEC_MO_RONG.md)

Các test chạy với tính năng được bật trong chính test; với mọi tính năng tắt, 56 test cũ và bộ `qa/` (45/45) đạt nguyên vẹn.

| Hạng mục | Test | Kết quả |
|---|---|---|
| §0 công tắc: mặc định tắt, FEATURE_OFF, chỉ quản trị bật/tắt, audit, SSE `features` | `TestMR_Features_MacDinhTatVaBatTat` | ĐẠT |
| §0 giá trị hiệu lực = giá trị quản trị đặt, ngược lại theo bản cài; tính năng chưa có luôn tắt, PUT ⇒ 400 | `TestMR_Features_MacDinhTheoBanCai` | ĐẠT |
| C4 (N10) khóa sổ chặn đổi số dư đầu kỳ (đối tác, tài khoản tiền, nhập công nợ đầu kỳ) | `TestMR_C4_KhoaSoChanSoDuDauKy` | ĐẠT |
| C1 tắt phân quyền khi còn vai trò mới ⇒ 409 / confirm ⇒ như kế toán | `TestMR_Features_TatPhanQuyenCanXacNhan` | ĐẠT |
| C1 ma trận quyền: mọi endpoint ghi (đối chiếu router) × 4 vai trò; quyền đọc; sửa ma trận; tắt tính năng | `TestMR_C1_MaTranQuyenMoiEndpointGhi` | ĐẠT |
| C1 không rò giá vốn: mọi route GET (đối chiếu router), file xlsx/docx, check, LOSS_WARNING, SSE; giữ giá khi người không thấy giá sửa | `TestMR_C1_KhongLoGiaVon` | ĐẠT |
| C4 khóa sổ: tạo/sửa/ghi sổ/bỏ ghi sổ/xóa, dời ngày hai chiều, phiếu tạm, phiếu thu chi, nhập tồn đầu | `TestMR_C4_KhoaSo` | ĐẠT |
| C3 file mẫu tải về → thử nguyên vẹn OK (4 loại) | `TestMR_C3_FileMauNhapLaiNgay` | ĐẠT |
| C3 thử không ghi gì, tất cả hoặc không gì, số kiểu Việt, nhận cột theo tiêu đề, trùng mã | `TestMR_C3_NhapHangHoaTatCaHoacKhongGi` | ĐẠT |
| C3 đối tác, tồn đầu kỳ (phiếu tạm từng kho), công nợ đầu kỳ (thay thế) | `TestMR_C3_DoiTacTonDauCongNoDau` | ĐẠT |
| C3 file 20.000 dòng (thử ≈ 2,1 s, nhập ≈ 2,8 s), 20.001 dòng ⇒ 400 | `TestMR_C3_File20000Dong` | ĐẠT |

## Bản mở rộng — đợt M2

| Hạng mục | Test | Kết quả |
|---|---|---|
| C5 tồn tối thiểu: tắt ⇒ quy tắc ≤ 5 và JSON như cũ; bật ⇒ dashboard, báo cáo dưới tồn tối thiểu, hàng cần đặt thêm cột, mẫu nhập có cột | `TestMR_C5_TonToiThieu` | ĐẠT |
| C6 giá theo khách: nguồn giá (giá riêng / bán gần nhất theo ngày rồi thứ tự ghi sổ / mặc định), loại trừ trả hàng, phiếu tạm, khách khác; tự điền trên phiếu bán; bảng giá, xóa dây chuyền, nhập Excel | `TestMR_C6_GiaTheoKhach` | ĐẠT |
| C8 hạn mức: CREDIT_WARNING khi ghi sổ / sửa tăng tiền; thiếu hàng chặn trước; gộp với LOSS_WARNING; cờ độc lập; audit người xác nhận; che số nợ | `TestMR_C8_HanMucCongNo` | ĐẠT |
| C8 tuổi nợ: FIFO, nợ đầu kỳ, trả trước, hạn = ngày + số ngày nợ, xlsx | `TestMR_C8_TuoiNoFIFO` | ĐẠT |
| C8 tuổi nợ khớp sổ công nợ — kiểm tra tính chất ngẫu nhiên (bán, trả hàng, thu, trả lại tiền, nợ đầu kỳ, sửa lùi ngày) | `TestMR_C8_TuoiNoKhopSoCongNo_NgauNhien` | ĐẠT |
| C7 lãi gộp: bình quân gia quyền, trả NCC, chuyển kho bỏ qua, ước tính, dịch vụ, khách trả hàng, ba cách nhóm cùng tổng, khớp báo cáo bán, nhập lùi ngày tính lại | `TestMR_C7_LaiGop` | ĐẠT |
| Hiệu năng tuổi nợ / lãi gộp trên 100.000 dòng | `TestMR_C7_C8_HieuNang` | ĐẠT (≤ 1,2 s mỗi báo cáo) |
| Ma trận quyền và kiểm tra rò giá vốn mở rộng cho các route mới | `TestMR_C1_MaTranQuyenMoiEndpointGhi`, `TestMR_C1_KhongLoGiaVon` | ĐẠT |

## Bản mở rộng — sửa sau QA M1 + M2

| Hạng mục | Test | Kết quả |
|---|---|---|
| C7 bình quân gia quyền liên hoàn: ví dụ spec (lãi 20), cùng ngày nhập trước xuất sau, nhập lùi ngày, khách trả / trả NCC, ba cách nhóm, khớp báo cáo bán | `TestMR_C7_BinhQuanLienHoan`, `TestMR_C7_LaiGop`, `TestMovingAverage` (đơn vị: bán vào âm rồi mua, giá trị sàn 0) | ĐẠT |
| M-01…M-07, M-10, Q-04, Q-07, Q-12, lịch sử khóa sổ, `/api/audit`, quyền trong phản hồi đăng nhập | `TestMR_QA_SuaLoiM1M2` | ĐẠT |
| Q-02 người bị che giá không đổi được đơn giá đang lưu bằng bất kỳ đường nào; 403 khi sửa / bỏ ghi sổ phiếu giá vốn đã ghi sổ | `TestMR_C1_NguoiBiCheGiaKhongDoiGiaDangLuu` | ĐẠT |
| Q-05 hai phiếu ghi sổ đồng thời không cùng lọt hạn mức | `TestMR_C8_HanMucGhiSoDongThoi` | ĐẠT |
| M-08, M-09, Q-03, Q-06, Q-08, Q-11 nhập Excel | `TestMR_C3_SuaLoiQA` | ĐẠT |

## Bản mở rộng — đợt M3 (và sửa sau QA lần 2)

| Hạng mục | Test | Kết quả |
|---|---|---|
| M-11 `/api/audit` to < from; M-12 nhật ký người dùng (không ghi mật khẩu); đăng nhập với mật khẩu / tên lưu dạng NFD, băm lại NFC | `TestMR_QA_NhatKyNguoiDungVaMatKhauNFD` | ĐẠT |
| C9 kiểm kê: tồn sổ sách, chênh lệch, R6, thẻ kho, không vào công nợ / báo cáo mua bán, giá vốn bình quân với thừa / thiếu, nhập lùi ngày ⇒ báo lệch, sửa / bỏ ghi sổ / khóa sổ / quyền / tắt tính năng, biên bản xlsx | `TestMR_C9_KiemKe` | ĐẠT |
| C9 ghi sổ kiểm kê đồng thời với phiếu bán (khóa trước khi tính tồn sổ sách) | `TestMR_C9_KiemKeDongThoiVoiBan` | ĐẠT |
| C10 quy đổi đơn vị: khai báo / đang dùng 409, sổ kho theo đơn vị gốc, thiếu hàng, giá mặc định / giá gần nhất / giá riêng, cảnh báo lỗ theo đơn vị gốc, hàng cần đặt, lãi gộp, báo cáo bán, chuyển kho, kiểm kê, máy khách cũ, nhập Excel, tắt tính năng | `TestMR_C10_QuyDoiDonVi` | ĐẠT |
| C11 thuế GTGT: mặc định mặt hàng / chung, thuế từng dòng, ba tổng, công nợ / Nợ cũ – Tổng nợ / hạn mức theo tổng thanh toán, lỗ + lãi gộp trước thuế, báo cáo bán + bảng kê, che thuế phiếu mua, xuất file, bật / tắt không đổi công nợ | `TestMR_C11_ThueGTGT` | ĐẠT |
| Đơn vị × thuế × dịch vụ × giá riêng × hạn mức × bán lỗ trên một phiếu | `TestMR_M3_TuongTacMotPhieuBan` | ĐẠT |
| C12 mẫu in: kiểm tra cấu hình, logo theo nội dung, quyền, file xuất dùng ô ký / chân trang / ẩn cột, mặc định = như tắt | `TestMR_C12_MauIn` | ĐẠT |
| C13 HTTPS: chứng thư tự ký, cookie Secure, lỗi file rõ ràng, cảnh báo hết hạn | `TestMR_C13_HTTPS` | ĐẠT |
| Ma trận quyền / không rò giá vốn mở rộng cho route M3 (phiếu mua có thuế + đơn vị quy đổi, kiểm kê) | `TestMR_C1_MaTranQuyenMoiEndpointGhi`, `TestMR_C1_KhongLoGiaVon` | ĐẠT |
| M-13 trường không thuộc loại phiếu; M-14 hệ số ≥ 1, SL quy đổi chính xác (bán lẻ 24 Lon hết đúng 1 Thùng); M-15/M-16 lưu lại không id dòng không mất đơn vị / hệ số / thuế / giá bị che (bật, tắt, máy khách cũ, kiểm kê), khác dãy ⇒ LINE_IDS_REQUIRED, tồn / công nợ không đổi | `TestMR_QA_M13_…`, `TestMR_QA_M14_HeSoVaSoLe`, `TestMR_QA_M15_M16_LuuLaiKhongIDDong` | ĐẠT |
| Quy tắc id dòng hợp nhất (M-17 trộn id, M-18 đảo đơn vị cùng mặt hàng, khóa tường minh, bỏ dòng, phiếu thường, giao diện gộp xung đột, người bị che giá), mọi tổ hợp bật / tắt quy đổi + thuế, phiếu đã ghi sổ và phiếu tạm; 400 không đổi phiếu / version | `TestMR_QA_QuyTacIDDong`, `TestMR_QA_M15_M16_LuuLaiKhongIDDong` | ĐẠT |
| Id dòng hợp lệ (M-19 id lặp, M-20 tráo id khác mặt hàng): kiểm tra tính chất 300 thân PUT ngẫu nhiên — 400 thì phiếu không đổi, 200 thì dữ liệu đặc biệt chỉ đổi qua khóa tường minh, không dòng mới nào thừa hưởng | `TestMR_QA_QuyTacIDDong_NgauNhien` | ĐẠT |
