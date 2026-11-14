// Gọi API của máy chủ — CHỈ dùng để chuẩn bị dữ liệu (danh mục, tồn đầu) hoặc đối chiếu một con số
// đã thấy trên màn hình. Thao tác đang được kiểm thử luôn làm qua giao diện.
const { BASE_URL } = require('./env');

class Api {
  constructor(token) {
    this.token = token;
  }

  static async login(username = 'admin', password = 'admin123') {
    const r = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) throw new Error(`Đăng nhập API thất bại (${r.status}): ${await r.text()}`);
    const cookie = r.headers.get('set-cookie') || '';
    const m = /session=([^;]+)/.exec(cookie);
    if (!m) throw new Error('Không thấy cookie session');
    return new Api(m[1]);
  }

  async req(method, path, body) {
    const r = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!r.ok) {
      const e = new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 400)}`);
      e.status = r.status;
      e.body = json;
      throw e;
    }
    return json;
  }

  get(path) {
    return this.req('GET', path);
  }
  post(path, body) {
    return this.req('POST', path, body);
  }
  put(path, body) {
    return this.req('PUT', path, body);
  }

  // ---------- danh mục (idempotent: tìm theo mã, chưa có thì tạo) ----------
  async findByCode(resource, code) {
    const r = await this.get(`/${resource}?q=${encodeURIComponent(code)}&active=all&page_size=200`);
    return r.items.find((x) => x.code.toLowerCase() === code.toLowerCase()) || null;
  }

  async ensure(resource, body) {
    const found = await this.findByCode(resource, body.code);
    if (found) return found;
    return this.post(`/${resource}`, body);
  }

  async ensureGroup(code, name) {
    return this.ensure('product-groups', { code, name, active: true });
  }

  /** p: {code,name,unit,group_code?,sale_price,purchase_price} */
  async ensureProduct(p) {
    let group_id = null;
    if (p.group_code) group_id = (await this.ensureGroup(p.group_code, p.group_name || p.group_code)).id;
    return this.ensure('products', {
      code: p.code,
      name: p.name,
      unit: p.unit,
      group_id,
      sale_price: p.sale_price ?? 0,
      purchase_price: p.purchase_price ?? 0,
      is_service: false,
      active: true,
    });
  }

  /** {code,name,is_customer,is_supplier,opening_receivable,opening_payable,address,phone} */
  async ensurePartner(p) {
    return this.ensure('partners', {
      address: '',
      phone: '',
      tax_code: '',
      is_customer: false,
      is_supplier: false,
      opening_receivable: 0,
      opening_payable: 0,
      active: true,
      ...p,
    });
  }

  async ensureUser(username, full_name, password = 'matkhau1') {
    const list = await this.get('/users');
    const f = list.items.find((u) => u.username === username);
    if (f) return f;
    return this.post('/users', { username, full_name, password, role: 'ketoan', active: true });
  }

  /** Thông tin công ty (nếu câu chuyện 1 chưa nhập qua giao diện). */
  async ensureCompany(c) {
    const s = await this.get('/settings');
    if (s.company_name) return s;
    return this.put('/settings', { company_name: c.name, company_address: c.address, company_phone: c.phone, company_tax_code: c.tax });
  }

  /** Số dư đầu kỳ tài khoản tiền (nếu câu chuyện 1 chưa nhập). */
  async ensureCashOpening(code, amount) {
    const a = await this.findByCode('cash-accounts', code);
    if (a.opening_balance) return a;
    return this.put(`/cash-accounts/${a.id}`, { ...a, opening_balance: amount });
  }

  async warehouses() {
    const r = await this.get('/warehouses?page_size=100');
    return r.items;
  }
  async wh(code) {
    return (await this.warehouses()).find((w) => w.code === code);
  }

  /** Lập + ghi sổ một chứng từ (chỉ để chuẩn bị dữ liệu). lines: [{product_code, qty, unit_price}] */
  async postedDoc(body) {
    const d = await this.post('/documents', body);
    return this.post(`/documents/${d.id}/post`, { version: d.version, confirm_loss: true });
  }

  async openingStock(whCode, date, lines) {
    const w = await this.wh(whCode);
    return this.postedDoc({ doc_type: 'opening', doc_date: date, warehouse_id: w.id, lines });
  }

  // ---------- đối chiếu ----------
  stockSummary(params = {}) {
    return this.get(`/reports/stock-summary?${new URLSearchParams(params)}`);
  }
  async stockOf(code) {
    const p = await this.findByCode('products', code);
    return this.get(`/products/${p.id}/price-info`);
  }
  async debtClosing(partnerCode, side) {
    const p = await this.findByCode('partners', partnerCode);
    const r = await this.get(`/reports/debt-ledger?partner_id=${p.id}&side=${side}`);
    return r.closing;
  }
  async docByNo(no) {
    const r = await this.get(`/documents?q=${encodeURIComponent(no)}&page_size=20`);
    const d = r.items.find((x) => x.display_no === no || x.doc_no === no || x.draft_no === no);
    return d ? this.get(`/documents/${d.id}`) : null;
  }
}

module.exports = { Api };
