"""Reconciliation: long deterministic pseudo-random sequence vs an independent model.

REQ-009/010/011/030/033/034/039/052/054/062/064/076/077/081/084/085
"""
import datetime as dt
import random
from decimal import Decimal as D
from lib import *

Y0 = dt.date(2025, 1, 1)


def ds(d):
    return d.isoformat()


class Model:
    def __init__(self):
        self.docs = {}      # id -> dict(type,date,wh,to,partner,lines=[(pid,qty,price,svc,desc)],status,version)
        self.vouchers = {}  # id -> dict(type,date,account,partner,lines=[amount], version)
        self.opening_rec = {}
        self.opening_pay = {}
        self.acc_opening = {}

    # ---- stock
    def moves(self, docs=None):
        docs = self.docs if docs is None else docs
        out = []
        for d in docs.values():
            if d["status"] != "posted":
                continue
            for (pid, q, pr, svc, _) in d["lines"]:
                if svc:
                    continue
                t = d["type"]
                if t in ("purchase", "sale_return", "opening"):
                    out.append((pid, d["wh"], d["date"], q))
                elif t in ("sale", "purchase_return"):
                    out.append((pid, d["wh"], d["date"], -q))
                elif t == "transfer":
                    out.append((pid, d["wh"], d["date"], -q))
                    out.append((pid, d["to"], d["date"], q))
        return out

    def stock_ok(self, docs):
        by = {}
        for pid, w, date, q in self.moves(docs):
            by.setdefault((pid, w), {}).setdefault(date, D(0))
            by[(pid, w)][date] += q
        for key, days in by.items():
            bal = D(0)
            for date in sorted(days):
                bal += days[date]
                if bal < 0:
                    return False, (key, date, bal)
        return True, None

    def stock(self, pid, w=None, as_of=None):
        s = D(0)
        for p, ww, date, q in self.moves():
            if p == pid and (w is None or ww == w) and (as_of is None or date <= as_of):
                s += q
        return s

    # ---- money
    @staticmethod
    def total(d):
        return sum((rnd(q, pr) if pr is not None else D(0)) for (_, q, pr, _, _) in d["lines"]) if d["lines"] else D(0)

    def debt(self, pid, side, frm=None, to=None):
        """returns opening, increase, decrease, closing"""
        op = D(self.opening_rec.get(pid, 0) if side == "receivable" else self.opening_pay.get(pid, 0))
        inc = D(0); dec = D(0)
        plus, minus, vt = (("sale",), ("sale_return",), "receipt") if side == "receivable" else (("purchase",), ("purchase_return",), "payment")
        items = []
        for d in self.docs.values():
            if d["status"] == "posted" and d["partner"] == pid and d["type"] in plus + minus:
                items.append((d["date"], self.total(d) * (1 if d["type"] in plus else -1)))
        for v in self.vouchers.values():
            if v["partner"] == pid and v["type"] == vt:
                items.append((v["date"], -sum(v["lines"], D(0))))
        for date, amt in items:
            if frm and date < frm:
                op += amt
            elif to and date > to:
                continue
            elif amt >= 0:
                inc += amt
            else:
                dec -= amt
        return op, inc, dec, op + inc - dec

    def cash(self, acc, frm=None, to=None):
        op = D(self.acc_opening.get(acc, 0)); r = D(0); p = D(0)
        for v in self.vouchers.values():
            if v["account"] != acc:
                continue
            amt = sum(v["lines"], D(0))
            if frm and v["date"] < frm:
                op += amt if v["type"] == "receipt" else -amt
            elif to and v["date"] > to:
                continue
            elif v["type"] == "receipt":
                r += amt
            else:
                p += amt
        return op, r, p, op + r - p


@test("009,010,011,030,033,034,039,052,054,062,064,076,077,081,084,085", "test_RECON_long_random_sequence_vs_model")
def _():
    a = admin()
    rng = random.Random(20261114)
    M = Model()
    whs = W()
    g = mk_group(uid("G"), "Nhóm đối chiếu")
    prods = []
    for i in range(6):
        sp = rng.choice([12000, 25000, 48000, 7600, 150000, 3300])
        p = mk_product(name=f"Hàng đối chiếu {i} – mã R", group_id=g["id"], sale=sp, purchase=int(sp * 0.75) // 100 * 100)
        prods.append(p)
    pids = [p["id"] for p in prods]
    price = {p["id"]: D(p["sale_price"]) for p in prods}
    dv = a.ok("GET", "/products/lookup", params={"code": "DV"})["id"]
    custs = [mk_partner(name=f"Khách đối chiếu {i}", cust=True, rec=rng.choice([0, 1500000, 250000])) for i in range(3)]
    supps = [mk_partner(name=f"NCC đối chiếu {i}", supp=True, pay=rng.choice([0, 3000000])) for i in range(2)]
    both = mk_partner(name="Vừa khách vừa NCC", cust=True, supp=True, rec=100000, pay=200000)
    custs.append(both); supps.append(both)
    for p in custs + supps:
        M.opening_rec[p["id"]] = D(p["opening_receivable"]); M.opening_pay[p["id"]] = D(p["opening_payable"])
    accs = [mk_account("cash", 5000000), mk_account("bank", 0)]
    for acc in accs:
        M.acc_opening[acc["id"]] = D(acc["opening_balance"])
    cust_ids = [c["id"] for c in custs]; supp_ids = [s["id"] for s in supps]
    stats = {"ops": 0, "accepted": 0, "refused": 0, "mismatch": 0}

    def rdate(lo=Y0, hi=dt.date(2025, 12, 31)):
        return lo + dt.timedelta(days=rng.randint(0, (hi - lo).days))

    def rqty():
        q = D(rng.randint(1, 12))
        if rng.random() < 0.2:
            q += D("0.5")
        return q

    def body_of(d, version=None):
        lines = []
        for (pid, q, pr, svc, desc) in d["lines"]:
            ln = {"product_id": pid, "qty": float(q), "unit_price": (float(pr) if pr is not None else None)}
            if svc:
                ln["description"] = desc
            lines.append(ln)
        b = {"doc_type": d["type"], "doc_date": ds(d["date"]), "partner_id": d["partner"], "warehouse_id": d["wh"],
             "to_warehouse_id": d["to"], "note": "", "lines": lines}
        if version is not None:
            b["version"] = version; b["confirm_loss"] = True
        return b

    def snapshot():
        ss = stock_summary(group_id=g["id"], only_with_data="false")
        st = {i["product_id"]: (i["by_warehouse"], i["total"]) for i in ss["items"]}
        dr = a.ok("GET", "/reports/debt-summary", params={"side": "receivable", "include_zero": "true", "q": "đối chiếu"})["totals"]
        dp = a.ok("GET", "/reports/debt-summary", params={"side": "payable", "include_zero": "true", "q": "đối chiếu"})["totals"]
        cb = [a.ok("GET", "/reports/cash-book", params={"account_id": x["id"]})["closing"] for x in accs]
        return st, dr, dp, cb

    def outcome(r, predicted_ok, label, extra=""):
        """compare server decision to model prediction; returns True if server accepted"""
        stats["ops"] += 1
        exp = 200 if predicted_ok else 422
        if r.status not in (200, 422):
            stats["mismatch"] += 1
            fail(f"{label}: unexpected {r.short()[:400]}")
            return False
        if r.status != exp:
            stats["mismatch"] += 1
            fail(f"{label}: model predicted {exp}, server said {r.status} {extra} :: {r.short()[:400]}")
        if r.status == 200:
            stats["accepted"] += 1
        else:
            stats["refused"] += 1
        return r.status == 200

    def new_doc(t, date, w, lines, partner=None, to=None):
        b = {"type": t, "date": date, "wh": w, "to": to, "partner": partner, "lines": lines, "status": "draft", "version": 1}
        r = a.req("POST", "/documents", body_of(b))
        if r.status != 201:
            fail(f"create {t}: {r.short()[:400]}")
            return None, None
        b["version"] = r.json["version"]
        M.docs[r.json["id"]] = b
        eq(r.json["total_amount"], M.total(b), f"created {t} total")
        return r.json["id"], b

    def try_post(did, label):
        d = M.docs[did]
        cand = dict(M.docs); cand[did] = {**d, "status": "posted"}
        ok, why = M.stock_ok(cand)
        r = a.post(f"/documents/{did}/post", {"version": d["version"], "confirm_loss": True})
        if outcome(r, ok, label, str(why)):
            d["status"] = "posted"; d["version"] = r.json["version"]
            return True
        return False

    def mk_lines(t):
        n = rng.randint(1, 3)
        lines = []
        for _ in range(n):
            pid = rng.choice(pids)
            if t in ("purchase", "purchase_return", "opening"):
                pr = (price[pid] * D("0.75") / 100).quantize(D("1")) * 100 + rng.choice([-100, 0, 100, 200])
            elif t == "transfer":
                pr = None
            else:
                pr = price[pid] + rng.choice([-1000, 0, 0, 500])
                pr = max(pr, D(100))
            lines.append((pid, rqty() * (3 if t in ("purchase", "opening") else 1), pr, False, ""))
        if rng.random() < 0.3 and len(lines) >= 1:  # same product twice
            l0 = lines[0]
            lines.append((l0[0], rqty(), l0[2], False, ""))
        if t in ("sale", "purchase") and rng.random() < 0.25:
            lines.append((dv, D(1), D(rng.choice([50000, -1000, 30000])), True, rng.choice(["Phí vận chuyển", "Chiết khấu", "Phí sửa xe"])))
        return lines

    def full_compare(tag, final=False):
        ss = stock_summary(group_id=g["id"], only_with_data="false")
        items = {i["product_id"]: i for i in ss["items"]}
        for pid in pids:
            it = items.get(pid)
            if not check(it, f"[{tag}] product {pid} in stock-summary"):
                continue
            tot = M.stock(pid)
            eq(it["total"], tot, f"[{tag}] stock-summary total p{pid}")
            for w in whs:
                eq(it["by_warehouse"].get(str(w)), M.stock(pid, w), f"[{tag}] stock-summary p{pid} wh{w}")
            eq(sum(num(v) for v in it["by_warehouse"].values()), tot, f"[{tag}] p{pid} sum of warehouses = total")
            lg = ledger(pid)
            eq(lg["closing"], tot, f"[{tag}] ledger(all) closing p{pid}")
            bal = num(lg["opening"])
            for r in lg["rows"]:
                bal += num(r["qty_in"]) - num(r["qty_out"])
                if not eq(r["balance"], bal, f"[{tag}] ledger running balance p{pid} {r['doc_no']}"):
                    break
            if final:
                for w in whs:
                    eq(ledger(pid, warehouse_id=w)["closing"], M.stock(pid, w), f"[{tag}] ledger wh{w} closing p{pid}")
                    lp = ledger(pid, warehouse_id=w, **{"from": "2025-04-01", "to": "2025-08-31"})
                    eq(lp["opening"], M.stock(pid, w, as_of=dt.date(2025, 3, 31)), f"[{tag}] ledger wh{w} period opening p{pid}")
                    eq(lp["closing"], M.stock(pid, w, as_of=dt.date(2025, 8, 31)), f"[{tag}] ledger wh{w} period closing p{pid}")
        nx = {i["product_id"]: i for i in a.ok("GET", "/reports/stock-nxt", params={"from": "2025-01-01", "to": "2025-12-31", "group_id": g["id"]})["items"]}
        for pid in pids:
            tot = M.stock(pid)
            it = nx.get(pid)
            if it is None:
                check(tot == 0, f"[{tag}] NXT missing p{pid} with stock {tot}")
                continue
            eq(it["opening"], 0, f"[{tag}] NXT opening p{pid}"); eq(it["closing"], tot, f"[{tag}] NXT closing p{pid}")
            eq(num(it["qty_in"]) - num(it["qty_out"]), tot, f"[{tag}] NXT in-out p{pid}")
        # as_of snapshot
        asof = rdate()
        ss2 = {i["product_id"]: i for i in stock_summary(group_id=g["id"], only_with_data="false", as_of=ds(asof))["items"]}
        for pid in pids:
            eq(ss2[pid]["total"] if pid in ss2 else 0, M.stock(pid, as_of=asof), f"[{tag}] stock as_of {asof} p{pid}")
        if final:
            mid_f, mid_t = "2025-04-01", "2025-08-31"
            for w in whs:
                nxw = {i["product_id"]: i for i in a.ok("GET", "/reports/stock-nxt", params={"from": mid_f, "to": mid_t, "warehouse_id": w, "group_id": g["id"]})["items"]}
                for pid in pids:
                    op = M.stock(pid, w, as_of=dt.date(2025, 3, 31)); cl = M.stock(pid, w, as_of=dt.date(2025, 8, 31))
                    it = nxw.get(pid)
                    if it is None:
                        check(op == 0 and cl == 0, f"[{tag}] NXT wh{w} missing p{pid} ({op},{cl})")
                    else:
                        eq(it["opening"], op, f"[{tag}] NXT wh{w} opening p{pid}"); eq(it["closing"], cl, f"[{tag}] NXT wh{w} closing p{pid}")
        # debts
        for side, ids in (("receivable", cust_ids), ("payable", supp_ids)):
            for pid in ids:
                exp = M.debt(pid, side)
                dl = debt_ledger(pid, side)
                eq(dl["closing"], exp[3], f"[{tag}] debt-ledger {side} partner {pid}")
                it = debt_summary_item(pid, side)
                eq(it and it["closing"], exp[3], f"[{tag}] debt-summary {side} partner {pid}")
                if final:
                    f, t = dt.date(2025, 5, 1), dt.date(2025, 9, 30)
                    e = M.debt(pid, side, f, t)
                    it = debt_summary_item(pid, side, **{"from": ds(f), "to": ds(t)})
                    if check(it, f"[{tag}] period summary {side} {pid}"):
                        for k, v in zip(("opening", "increase", "decrease", "closing"), e):
                            eq(it[k], v, f"[{tag}] period {side} partner {pid} {k}")
                    dlp = debt_ledger(pid, side, **{"from": ds(f), "to": ds(t)})
                    eq(dlp["opening"], e[0], f"[{tag}] period ledger opening {side} {pid}")
                    eq(dlp["closing"], e[3], f"[{tag}] period ledger closing {side} {pid}")
        for acc in accs:
            e = M.cash(acc["id"])
            cb = a.ok("GET", "/reports/cash-book", params={"account_id": acc["id"]})
            eq(cb["closing"], e[3], f"[{tag}] cash-book closing acc {acc['code']}")
            eq(cb["total_receipt"], e[1], f"[{tag}] cash-book receipts acc {acc['code']}")
            if final:
                e = M.cash(acc["id"], dt.date(2025, 6, 1), dt.date(2025, 10, 31))
                cb = a.ok("GET", "/reports/cash-book", params={"account_id": acc["id"], "from": "2025-06-01", "to": "2025-10-31"})
                for k, v in zip(("opening", "total_receipt", "total_payment", "closing"), e):
                    eq(cb[k], v, f"[{tag}] period cash-book {acc['code']} {k}")
        if final:
            for did, d in M.docs.items():
                sd = a.get(f"/documents/{did}")
                if d.get("deleted"):
                    eq(sd.status, 404, f"deleted doc {did}")
                    continue
                if check(sd.status == 200, f"doc {did} exists"):
                    eq(sd.json["status"], d["status"], f"doc {did} status"); eq(sd.json["total_amount"], M.total(d), f"doc {did} total")
                    eq(sd.json["version"], d["version"], f"doc {did} version")
            sr = a.ok("GET", "/reports/sales", params={"from": "2025-01-01", "to": "2025-12-31", "group_id": g["id"]})
            exp_qty = sum((q for d in M.docs.values() if d["status"] == "posted" and d["type"] == "sale" for (pid, q, pr, svc, _) in d["lines"] if not svc), D(0))
            eq(sr["total_qty"], exp_qty, f"[{tag}] sales report qty for group")

    # ---------------- initial stock
    for w in whs:
        did, d = new_doc("purchase", dt.date(2025, 1, rng.randint(2, 10)), w,
                         [(pid, D(rng.randint(20, 40)), price[pid] * D("0.7"), False, "") for pid in pids], rng.choice(supp_ids))
        try_post(did, "initial purchase")

    ops = ["purchase"] * 14 + ["sale"] * 22 + ["sale_return"] * 4 + ["purchase_return"] * 4 + ["transfer"] * 10 + \
          ["edit"] * 18 + ["unpost"] * 5 + ["repost"] * 3 + ["draft"] * 6 + ["voucher"] * 8 + ["vedit"] * 3 + ["vdel"] * 2
    N = 260
    for i in range(N):
        op = rng.choice(ops)
        label = f"op#{i} {op}"
        if op in ("purchase", "sale", "sale_return", "purchase_return", "transfer"):
            w = rng.choice(whs)
            to = rng.choice([x for x in whs if x != w]) if op == "transfer" else None
            partner = None if op == "transfer" else rng.choice(cust_ids if op in ("sale", "sale_return") else supp_ids)
            before = snapshot()[0] if op == "transfer" else None
            did, d = new_doc(op, rdate(), w, mk_lines(op), partner, to)
            if did is None:
                continue
            okk = try_post(did, label)
            if op == "transfer" and okk:
                after = snapshot()[0]
                for pid in pids:
                    eq(after.get(pid, (0, 0))[1], before.get(pid, (0, 0))[1], f"{label}: transfer leaves total of p{pid} unchanged")
            if not okk and rng.random() < 0.5:
                r = a.delete(f"/documents/{did}", version=d["version"])
                if eq(r.status, 200, f"{label}: delete refused draft"):
                    d["deleted"] = True; d["status"] = "deleted"
        elif op == "edit":
            cands = [k for k, d in M.docs.items() if d["status"] == "posted"]
            if not cands:
                continue
            did = rng.choice(cands); d = M.docs[did]
            nd = {**d, "lines": list(d["lines"])}
            kind = rng.choice(["qty", "qty", "price", "date", "date", "partner", "wh", "add", "remove"])
            if kind == "qty":
                j = rng.randrange(len(nd["lines"])); l = nd["lines"][j]
                if l[3]:
                    continue
                nq = (l[1] * D(str(rng.choice([0.2, 0.5, 0.8, 1.5, 2, 3])))).quantize(D("0.5"))
                nd["lines"][j] = (l[0], max(nq, D("0.5")), l[2], l[3], l[4])
            elif kind == "price":
                j = rng.randrange(len(nd["lines"])); l = nd["lines"][j]
                if l[2] is None:
                    continue
                nd["lines"][j] = (l[0], l[1], max(l[2] + rng.choice([-500, 700, 1200]), D(100)) if not l[3] else l[2] + 1000, l[3], l[4])
            elif kind == "date":
                nd["date"] = min(max(d["date"] + dt.timedelta(days=rng.randint(-120, 120)), Y0), dt.date(2025, 12, 31))
            elif kind == "partner":
                if d["type"] in ("transfer", "opening"):
                    continue
                pool = cust_ids if d["type"] in ("sale", "sale_return") else supp_ids
                nd["partner"] = rng.choice([x for x in pool if x != d["partner"]])
            elif kind == "wh":
                nd["wh"] = rng.choice([x for x in whs if x != d["wh"] and x != d["to"]])
            elif kind == "add":
                extra = mk_lines(d["type"])[0]
                nd["lines"].append(extra)
            elif kind == "remove":
                if len(nd["lines"]) < 2:
                    continue
                nd["lines"].pop(rng.randrange(len(nd["lines"])))
            cand = dict(M.docs); cand[did] = nd
            ok, why = M.stock_ok(cand)
            before_v = get_doc(did)
            r = a.put(f"/documents/{did}", body_of(nd, d["version"]))
            if outcome(r, ok, f"{label}/{kind} doc {did} ({d['type']})", str(why)):
                nd["version"] = r.json["version"]
                M.docs[did] = nd
                eq(r.json["doc_no"], before_v["doc_no"], f"{label}: doc_no unchanged")
                eq(r.json["total_amount"], M.total(nd), f"{label}: total after edit")
            elif r.status == 422:
                after_v = get_doc(did)
                eq(after_v["version"], before_v["version"], f"{label}: refused edit leaves version")
                eq(after_v["total_amount"], before_v["total_amount"], f"{label}: refused edit leaves total")
                eq(after_v["doc_date"], before_v["doc_date"], f"{label}: refused edit leaves date")
        elif op == "unpost":
            cands = [k for k, d in M.docs.items() if d["status"] == "posted"]
            if not cands:
                continue
            did = rng.choice(cands); d = M.docs[did]
            cand = dict(M.docs); cand[did] = {**d, "status": "draft"}
            ok, why = M.stock_ok(cand)
            r = a.post(f"/documents/{did}/unpost", {"version": d["version"]})
            if outcome(r, ok, f"{label} doc {did} ({d['type']})", str(why)):
                d["status"] = "draft"; d["version"] = r.json["version"]
                if rng.random() < 0.5:
                    try_post(did, f"{label} immediate repost")
        elif op == "repost":
            cands = [k for k, d in M.docs.items() if d["status"] == "draft"]
            if cands:
                try_post(rng.choice(cands), label)
        elif op == "draft":
            before = snapshot()
            t = rng.choice(["sale", "purchase", "transfer", "sale_return"])
            w = rng.choice(whs)
            did, d = new_doc(t, rdate(), w, mk_lines(t) + [(rng.choice(pids), D(5000), price[pids[0]], False, "")] if t == "sale" else mk_lines(t),
                             None if t == "transfer" else rng.choice(cust_ids if t in ("sale", "sale_return") else supp_ids),
                             rng.choice([x for x in whs if x != w]) if t == "transfer" else None)
            if did is None:
                continue
            nd = {**d, "lines": d["lines"][:1]}
            r = a.put(f"/documents/{did}", body_of(nd, d["version"]))
            if eq(r.status, 200, f"{label}: edit draft"):
                nd["version"] = r.json["version"]; M.docs[did] = nd; d = nd
            if rng.random() < 0.6:
                r = a.delete(f"/documents/{did}", version=d["version"])
                if eq(r.status, 200, f"{label}: delete draft"):
                    d["deleted"] = True; d["status"] = "deleted"
            eq(snapshot(), before, f"{label}: draft create/edit/delete changed reports")
        elif op == "voucher":
            vt = rng.choice(["receipt", "payment"])
            acc = rng.choice(accs)["id"]
            partner = rng.choice(cust_ids if vt == "receipt" else supp_ids)
            lines = [D(rng.randint(1, 40) * 25000) for _ in range(rng.randint(1, 4))]
            date = rdate()
            r = mk_voucher(vt, acc, partner, [{"description": f"Dòng {k+1}", "amount": float(x)} for k, x in enumerate(lines)], date=ds(date))
            if eq(r.status, 201, f"{label}: create voucher"):
                M.vouchers[r.json["id"]] = {"type": vt, "date": date, "account": acc, "partner": partner, "lines": lines, "version": r.json["version"]}
                eq(r.json["total_amount"], sum(lines, D(0)), f"{label}: voucher total")
        elif op == "vedit":
            if not M.vouchers:
                continue
            vid = rng.choice(list(M.vouchers)); v = M.vouchers[vid]
            nv = {**v, "lines": [x + 10000 for x in v["lines"]] + ([D(77000)] if rng.random() < 0.5 else []),
                  "date": rdate(), "account": rng.choice(accs)["id"]}
            b = {"voucher_type": nv["type"], "voucher_date": ds(nv["date"]), "account_id": nv["account"], "partner_id": nv["partner"],
                 "note": "sửa", "lines": [{"description": "x", "amount": float(x)} for x in nv["lines"]], "version": v["version"]}
            r = a.put(f"/vouchers/{vid}", b)
            if eq(r.status, 200, f"{label}: edit voucher"):
                nv["version"] = r.json["version"]; M.vouchers[vid] = nv
        elif op == "vdel":
            if not M.vouchers:
                continue
            vid = rng.choice(list(M.vouchers))
            r = a.delete(f"/vouchers/{vid}", version=M.vouchers[vid]["version"])
            if eq(r.status, 200, f"{label}: delete voucher"):
                del M.vouchers[vid]
        if (i + 1) % 40 == 0:
            full_compare(f"after op {i+1}")
    full_compare("final", final=True)
    print(f"      recon stats: {stats}, docs={len(M.docs)}, vouchers={len(M.vouchers)}", flush=True)
    check(stats["refused"] > 5 and stats["accepted"] > 50, f"sequence exercised both outcomes: {stats}")
