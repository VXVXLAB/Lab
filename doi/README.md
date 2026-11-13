# Cổng Chỉ Vừa Một Đứa

Game ức chế cho hai người chơi chung một bàn phím, cùng thế giới với `../cuoi/`.
Bé Sao và Bé Trăng phải giúp nhau mới tới được cổng hội: làm ghế cho nhau trèo, đạp phiến đá giữ cửa, giữ cầu.
Nhưng Cuội bảo cổng chỉ vừa một đứa, nên thắp xong chiếc đèn đôi là thành cuộc đua. Năm màn, màn cuối có một cú lật.

Game kể một sự tích trọn vẹn qua các trang truyện giữa các màn: vì sao cây đa lên trời, vì sao Cuội phải nói dối,
Bé Sao và Bé Trăng mỗi đứa cần gì ở cánh cổng, và chuyện kết thúc ra sao. Kịch bản đầy đủ ở [KICH-BAN.md](KICH-BAN.md).

Cuội còn nhớ thói quen của từng người: ô nào một đứa hay đáp chân sẽ mọc một cái bẫy chỉ bật lên với riêng đứa đó
(vết nứt cùng màu với nhân vật), còn đứa kia đi qua bình thường.

## Chạy

Mở `index.html` bằng trình duyệt trên máy tính. Không cần cài đặt hay máy chủ. Cần bàn phím; không chơi được trên điện thoại.

| | Đi | Nhảy |
|---|---|---|
| Bé Sao (vàng) | `A` `D` | `W` |
| Bé Trăng (xanh) | `←` `→` | `↑` |

`R` làm lại màn, `M` tắt tiếng, `Enter` bắt đầu.

## Luật

- Đứng lên đầu nhau thì nhảy cao hơn. Ván gỗ nhảy xuyên từ dưới lên được.
- Phiến đá vàng giữ cửa hoặc cầu chừng nào còn có người đứng trên.
- Trước khi cả hai thắp chiếc đèn đôi: một đứa ngã thì cả hai làm lại màn. Bước khỏi phiến đá làm bạn rơi bị tính là "phản sớm".
- Sau khi đèn đôi sáng: cổng mở, ai vào trước được một điểm; ngã thì hồi sinh ở đèn đôi.
- Hai bên cứ đứng nhìn nhau thì một lúc sau Cuội sẽ chen vào.

## Kỹ thuật

Một file `game.js`, Canvas 2D, hình và âm thanh sinh bằng code. Mô phỏng bước cố định 120 Hz;
`window.__doi.step(n, [inputSao, inputTrang])` dùng để chạy thử bằng kịch bản. Cả năm màn đã được hai bot phối hợp đi hết.
