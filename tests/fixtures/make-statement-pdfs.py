#!/usr/bin/env python3
"""Regenerate the sample PDF bank statements used by tests/e2e/import-pdf.spec.js.

Needs `reportlab`, `pypdf` and `cryptography`:   python3 tests/fixtures/make-statement-pdfs.py

The layout imitates a VPBank credit card statement (summary boxes on the first page, a bilingual
transaction table whose last column is "Số tiền thanh toán (VND)", descriptions that wrap over
several lines, fee / VAT lines whose transaction amount is 0.00, a purchase in USD, no table header
on the second page, a footer on every page). The numbers are made up. The generated files are
committed, so the tests do not need Python.
"""

import os

from pypdf import PdfReader, PdfWriter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
WIDTH, HEIGHT = 700, 842
PASSWORD = "matkhau123"

pdfmetrics.registerFont(TTFont("Sans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("Sans-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))

# Columns: centre of the dates, left edge of the description, right edge of the numbers.
DATE1, DATE2 = 55, 130
DESC_LEFT, DESC_WIDTH = 165, 200
TXN_RIGHT, CCY_CENTRE, FEE_RIGHT, PAY_RIGHT = 465, 500, 575, 680

ROWS = [
    # (transaction date, posting date, description, txn amount, currency, fee, payment amount)
    ("21/09/26", "21/09/26", "Credit Account I2B Virtual Card payment;", "1,200,000.00", "VND", "", "1,200,000.00"),
    ("21/09/26", "22/09/26", "Credit Account I2B Pay2Card on I2B;", "-100,000.00", "VND", "", "-100,000.00"),
    ("23/09/26", "24/09/26", "Retail USA SAN FRANCISCO OPENAI *CHATGPT SUBSCR", "-132,000.00", "VND", "", "-132,000.00"),
    (
        "23/09/26",
        "24/09/26",
        "Retail: : MasterCard Acq --> : Our EuroCard/MasterCard (MasterCard Acq) in 704 International Device Country Custom Fee",
        "0.00",
        "VND",
        "-10,000.00",
        "-10,000.00",
    ),
    ("23/09/26", "24/09/26", "VAT", "0.00", "VND", "-1,000.00", "-1,000.00"),
    # page 2
    ("23/09/26", "24/09/26", "Retail USA Mountain View Google G1AI103M", "-73,333.00", "VND", "", "-73,333.00"),
    ("30/09/26", "01/10/26", "Retail USA SAN FRANCISCO ANTHROPIC* CLAUDE SUB", "-22.22", "USD", "", "-582,719.50"),
    ("02/10/26", "02/10/26", "Retail VN HO CHI MINH HIGHLANDS COFFEE", "-45,000.00", "VND", "", "-45,000.00"),
]
FIRST_PAGE_ROWS = 5


def top(y):
    return HEIGHT - y


def wrap(text, width, font="Sans", size=7.5):
    lines, line = [], ""
    for word in text.split(" "):
        candidate = f"{line} {word}".strip()
        if pdfmetrics.stringWidth(candidate, font, size) <= width or not line:
            line = candidate
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def footer(c, page, pages):
    c.setFont("Sans", 7)
    c.drawString(60, top(815), "Ngân hàng Việt Nam Thịnh Vượng © 2024")
    c.drawString(60, top(825), "Trụ sở chính: 89 Láng Hạ, Đống Đa, Hà Nội")
    c.drawRightString(640, top(825), f"Page {page} of {pages}")


def draw_rows(c, rows, y):
    c.setFont("Sans", 7.5)
    for t_date, p_date, text, txn, ccy, fee, pay in rows:
        lines = wrap(text, DESC_WIDTH)
        c.drawCentredString(DATE1, top(y), t_date)
        c.drawCentredString(DATE2, top(y), p_date)
        c.drawRightString(TXN_RIGHT, top(y), txn)
        c.drawCentredString(CCY_CENTRE, top(y), ccy)
        if fee:
            c.drawRightString(FEE_RIGHT, top(y), fee)
        c.drawRightString(PAY_RIGHT, top(y), pay)
        for index, line in enumerate(lines):
            c.drawString(DESC_LEFT, top(y + index * 10), line)
        y += len(lines) * 10 + 14
    return y


def amount(text):
    return float(text.replace(",", ""))


def money(value, signed=True):
    text = f"{abs(value):,.2f}"
    return ("-" if value < 0 and signed else "") + text


def build_statement(path):
    pay_total = sum(amount(r[6]) for r in ROWS)
    paid = sum(amount(r[6]) for r in ROWS if amount(r[6]) > 0)
    debit = sum(amount(r[6]) for r in ROWS if amount(r[6]) < 0)
    beginning = -1200000.00
    closing = round(beginning + debit + paid)  # the bank rounds the .50 away

    c = canvas.Canvas(path, pagesize=(WIDTH, HEIGHT))
    c.setTitle("Sao ke the tin dung (mau)")

    c.setFont("Sans-Bold", 11)
    c.drawCentredString(WIDTH / 2, top(40), "BẢNG SAO KÊ TÀI KHOẢN THẺ TÍN DỤNG QUỐC TẾ VPBANK")
    c.setFont("Sans", 9)
    c.drawCentredString(WIDTH / 2, top(55), "VPBANK CREDIT CARD STATEMENT")
    c.setFont("Sans", 8)
    c.drawCentredString(WIDTH / 2, top(72), "Kỳ sao kê / Statement cycle : 21/09/2026 - 20/10/2026")

    # Summary box: due date, minimum amount, outstanding balance.
    c.setFont("Sans-Bold", 7.5)
    for x, vi, en in [
        (40, "Ngày đến hạn thanh toán", "Due date"),
        (190, "Giá trị thanh toán tối thiểu (VND)", "Minimum Amount Due (VND)"),
        (400, "Số dư cuối kỳ", "Outstanding Balance"),
        (520, "Số dư cuối kỳ (nếu có khoản trả góp)", "Outstanding Balance (if having installment)"),
    ]:
        c.drawString(x, top(100), vi)
        c.drawString(x, top(111), en)
    c.setFont("Sans", 8)
    c.drawString(40, top(135), "04/11/2026")
    c.drawString(190, top(135), "-47,203.00")
    c.drawString(400, top(135), f"-{money(closing, False)}.00".replace(".00.00", ".00"))
    c.drawString(520, top(135), f"-{money(closing, False)}".replace(".00.00", ".00"))

    c.setFont("Sans-Bold", 9)
    c.drawString(40, top(170), "TÓM TẮT SAO KÊ / STATEMENT SUMMARY")
    c.setFont("Sans-Bold", 7.5)
    for x, vi, en in [
        (40, "Dư nợ đầu kỳ", "Beginning Balance"),
        (190, "Nợ phát sinh trong kỳ", "Total debit amount"),
        (360, "Đã thanh toán", "Paid during term"),
        (520, "Dư nợ cuối kỳ", "Outstanding Balance"),
    ]:
        c.drawString(x, top(195), vi)
        c.drawString(x, top(206), en)
    c.setFont("Sans", 8)
    c.drawString(40, top(228), money(beginning))
    c.drawString(150, top(228), "+")
    c.drawString(190, top(228), money(debit))
    c.drawString(320, top(228), "+")
    c.drawString(360, top(228), money(paid))
    c.drawString(490, top(228), "=")
    c.drawString(520, top(228), money(closing))

    c.setFont("Sans-Bold", 9)
    c.drawString(40, top(262), "CHI TIẾT GIAO DỊCH CỦA THẺ / TRANSACTION DETAILS OF xxxx-xxxx-xxxx-0000")
    c.setFont("Sans-Bold", 7)
    for x, vi, en in [
        (DATE1, "Ngày giao dịch", "Tnx date"),
        (DATE2, "Ngày hạch toán", "Posting date"),
        (DESC_LEFT + 80, "Chi tiết giao dịch", "Tnx details"),
        (TXN_RIGHT - 35, "Số tiền giao dịch", "Txn amount"),
        (CCY_CENTRE, "Loại tiền", "CCY"),
        (FEE_RIGHT - 18, "Phí (VND)", "Fee (VND)"),
        (PAY_RIGHT - 45, "Số tiền thanh toán (VND)", "Payment amount (VND)"),
    ]:
        c.drawCentredString(x, top(285), vi)
        c.drawCentredString(x, top(295), en)
    draw_rows(c, ROWS[:FIRST_PAGE_ROWS], 322)
    footer(c, 1, 2)
    c.showPage()

    # Page 2: the table goes on without a header.
    draw_rows(c, ROWS[FIRST_PAGE_ROWS:], 60)
    footer(c, 2, 2)
    c.showPage()
    c.save()


def build_without_table(path):
    c = canvas.Canvas(path, pagesize=(WIDTH, HEIGHT))
    c.setFont("Sans", 10)
    c.drawString(60, top(80), "Thư xác nhận số dư")
    c.drawString(60, top(100), "Kính gửi quý khách, đây là thư xác nhận. Không có bảng giao dịch trong tài liệu này.")
    c.showPage()
    c.save()


def lock(source, target, password):
    writer = PdfWriter(clone_from=PdfReader(source))
    writer.encrypt(password, algorithm="AES-128")
    with open(target, "wb") as handle:
        writer.write(handle)


if __name__ == "__main__":
    plain = os.path.join(HERE, "statement-vpbank-sample.pdf")

    build_statement(plain)
    lock(plain, os.path.join(HERE, "statement-vpbank-sample-locked.pdf"), PASSWORD)
    build_without_table(os.path.join(HERE, "statement-no-table.pdf"))
    print("done; password of the locked sample:", PASSWORD)
