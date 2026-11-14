package util

import "testing"

func TestMoneyInWords(t *testing.T) {
	cases := []struct{ in, want string }{
		{"0", "Không đồng"},
		{"0.4", "Không đồng"},
		{"5", "Năm đồng"},
		{"10", "Mười đồng"},
		{"11", "Mười một đồng"},
		{"14", "Mười bốn đồng"},
		{"15", "Mười lăm đồng"},
		{"20", "Hai mươi đồng"},
		{"21", "Hai mươi mốt đồng"},
		{"24", "Hai mươi bốn đồng"},
		{"25", "Hai mươi lăm đồng"},
		{"34", "Ba mươi bốn đồng"},
		{"101", "Một trăm linh một đồng"},
		{"105", "Một trăm linh năm đồng"},
		{"110", "Một trăm mười đồng"},
		{"115", "Một trăm mười lăm đồng"},
		{"1001", "Một nghìn không trăm linh một đồng"},
		{"1015000", "Một triệu không trăm mười lăm nghìn đồng"},
		{"1000000", "Một triệu đồng"},
		{"1000005", "Một triệu không trăm linh năm đồng"},
		{"2590000", "Hai triệu năm trăm chín mươi nghìn đồng"},
		{"8455000", "Tám triệu bốn trăm năm mươi lăm nghìn đồng"},
		{"34000000", "Ba mươi bốn triệu đồng"},
		{"2000000000", "Hai tỷ đồng"},
		{"2000000001", "Hai tỷ không trăm linh một đồng"},
		{"999999999999", "Chín trăm chín mươi chín tỷ chín trăm chín mươi chín triệu chín trăm chín mươi chín nghìn chín trăm chín mươi chín đồng"},
		{"1000000000000", "Một nghìn tỷ đồng"},
		{"1000000001000", "Một nghìn tỷ không trăm linh một nghìn đồng"},
		{"1.5", "Hai đồng"},
		{"1.49", "Một đồng"},
		{"2499.5", "Hai nghìn năm trăm đồng"},
		{"-200000", "Âm hai trăm nghìn đồng"},
		{"-0.4", "Không đồng"},
		{"-1.5", "Âm hai đồng"},
	}
	for _, c := range cases {
		if got := MoneyInWords(Dec(c.in)); got != c.want {
			t.Errorf("MoneyInWords(%s) = %q, muốn %q", c.in, got, c.want)
		}
	}
}
