# NGHIỆM THU — ma trận 91 đầu việc ↔ test tự động ↔ kết quả

- Test tích hợp: `backend/tests/*_test.go`, chạy trên PostgreSQL 16 thật qua HTTP (`httptest.Server` + handler thật),
  mỗi test một schema CSDL riêng (migrate + seed), độc lập, chạy song song.
- Lệnh: `cd backend && go test ./... -count=1` (và `-race`). Kết quả bên dưới là lần chạy ngày 14/11/2026 (sau đợt sửa lỗi QA B1–B5, Q1–Q3 bổ sung API giai đoạn 2 và các đợt sửa sau E2E F-02/F-03/F-07, F-09/F-12/F-13/F-16):
  **54/54 test tích hợp ĐẠT** (+ 4 unit test `internal/util`, gồm số tiền bằng chữ), cả khi chạy `-race -count=2`.
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
| 044 | Máy khác tiếp tục | `TestREQ040_045_082_PhieuTamHaiMay`<br>`TestREQ043_SuKienSSEGiuaHaiMay` | ĐẠT |
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
| 060 | Nhiều dòng cùng KH | `TestREQ025_TimDoiTacTronTuTruocMotPhan`<br>`TestREQ056_061_085_ThuChiNhieuDong`<br>`TestREQ060_TimDoiTacNhieuTuXepHang` | ĐẠT |
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
| 082 | Kiểm thử phiếu tạm nhiều máy | `TestREQ040_045_082_PhieuTamHaiMay` | ĐẠT |
| 083 | Kiểm thử Mã Dịch vụ | `TestREQ047_083_PhieuBanMauCuaKhachVoiDichVu`<br>`TestREQ050_DichVuTruTienGiamCongNo` | ĐẠT |
| 084 | Kiểm thử công nợ | `TestREQ052_053_084_CongNoKhachHang`<br>`TestREQ054_055_CongNoNhaCungCap`<br>`TestREQ062_HoanTienKhongLamSaiCongNo` | ĐẠT |
| 085 | Kiểm thử thu-chi nhiều dòng | `TestREQ056_061_085_ThuChiNhieuDong`<br>`TestREQ062_HoanTienKhongLamSaiCongNo`<br>`TestREQ085_087_PhieuThuChiBangChu` | ĐẠT |
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
| Sửa sau E2E đợt 2: tìm đối tác trọn từ trước một phần (F-12); tìm mặt hàng nhiều từ mọi nơi (F-13); bỏ "Địa chỉ:" trống (F-09); tra mã `optional=1` không 404 (F-16) | `TestREQ025_TimDoiTacTronTuTruocMotPhan`, `TestREQ012_TimMatHangNhieuTu`, `TestREQ073_DiaChiTrongKhongInNhanTreo`, `TestREQ025_TraMaKhongBao404KhiOptional` |
| Sửa sau E2E: "Bằng chữ" trên file phiếu thu/chi (F-02); file xuất khớp bản in — DICHVU, nhãn kho, ô ký theo loại phiếu, chuyển kho không cột giá (F-03); tìm đối tác theo từ + xếp hạng (F-07); số dư một đối tác | `TestREQ085_087_PhieuThuChiBangChu`, `TestREQ047_073_FileXuatKhopBanIn`, `TestREQ060_TimDoiTacNhieuTuXepHang`, `TestREQ052_SoDuMotDoiTac`, unit `TestMoneyInWords` |
| Bổ sung API giai đoạn 2: `sum_total_amount`; price-info hàng loạt + `with_stock`; kiểm tra phiếu chưa lưu (kể cả xung đột sửa lùi); đổi mật khẩu; thông tin công ty trên file xuất; cột Ghi chú dòng | `TestREQ067_TongTienDanhSachMoiTrang`, `TestREQ026_PriceInfoHangLoatVaDanhSachKemTon`, `TestREQ030_KiemTraPhieuChuaLuu`, `TestREQ042_DoiMatKhau`, `TestREQ008_ThongTinCongTyVaGhiChuDong`, `TestREQ008_SettingsLuonCoSauKhiSeed` |
| Hồi quy lỗi QA: NUL ⇒ 400 (B1); đổi cờ đối tác vẫn sửa phiếu cũ (B2); ngày tường minh không bị thay (B3); số tiền/SL tròn về 0 bị từ chối (B4); Excel công thức ra số, đơn giá lẻ (B5); hoàn tiền NCC/khách về 0/0 với `debt_side` (Q1); xóa phiếu đang được phiếu thu tham chiếu ⇒ 409 (Q2); tìm không dấu mọi danh sách (Q3) | `TestREQ023_056_KyTuNULTra400`, `TestREQ038_DoiCoDoiTacVanSuaPhieuCu`, `TestREQ019_NgayTuongMinhKhongBiThay`, `TestREQ056_SoTienSoLuongQuaNhoBiTuChoi`, `TestREQ071_087_ExcelCongThucSoVaDonGiaLe`, `TestREQ062_HoanTienKhongLamSaiCongNo`, `TestREQ062_XoaPhieuDangDuocPhieuThuThamChieu`, `TestREQ035_TimKhongDauMoiDanhSach` |

## Bộ QA hộp đen độc lập (`qa/`)

`cd qa && ./run.sh` (ngày 15/11/2026, sau đợt sửa F-09/F-12/F-13/F-16): **45 test, 45 ĐẠT**, 0 phản hồi 5xx.
