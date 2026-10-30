# quan-ly-thu-chi (FinManager)

Ứng dụng web tĩnh quản lý thu chi cá nhân. Không cần build, không cần server riêng: dữ liệu nằm trong `localStorage` của trình duyệt và có thể đồng bộ tùy chọn với Google Sheets qua Google Apps Script. Cài được như ứng dụng (PWA) và chạy offline.

## Tính năng

- **Giao dịch**: thu / chi / chuyển tiền giữa các nguồn; lọc theo tháng, loại, danh mục, nguồn; tìm kiếm không dấu; xem thêm theo trang. Xuất CSV (UTF-8, mở được trong Excel) nằm ở **Cài đặt & Dữ liệu**: tất cả giao dịch, hoặc chỉ những giao dịch theo bộ lọc đang chọn ở Sổ Giao Dịch.
- **Điện thoại**: thanh dưới gọn 4 mục (Tổng quan, Sổ GD, Nguồn, Vay nợ) với nút `+` thêm giao dịch tròn nhô lên ở giữa; các trang còn lại (Danh mục, Định kỳ, Cài đặt…) nằm trong menu trái mở bằng nút ☰ ở đầu trang. Danh mục cũng là một dòng gọn mỗi mục. Mỗi giao dịch là một dòng (ngày · ghi chú · số tiền, viền màu theo loại thu / chi / chuyển); chạm vào dòng để xem nguồn tiền, danh mục và nút sửa / xóa.
- **Nhập liệu dễ đọc**: ngày hiển thị `dd/mm/yyyy` ở mọi nơi (kể cả CSV); các ô tiền tự thêm dấu chấm ngăn cách hàng nghìn khi gõ (`1500000` → `1.500.000`).
- **Nguồn tiền**: tiền mặt, ngân hàng, ví điện tử, thẻ tín dụng / trả sau (hạn mức, ngày chốt sao kê, hạn thanh toán), khoản nợ; lưu trữ, đổi tên (cập nhật mọi giao dịch).
- **Tổng quan**: thu / chi tháng này, số dư khả dụng, dư nợ, biểu đồ chi tiêu tháng và thu / chi 6 tháng, thanh tiến độ ngân sách.
- **Ngân sách** theo danh mục chi, cảnh báo khi vượt 80% và 100%.
- **Chi tiêu trên lương**: đặt lương hằng tháng và mức cảnh báo (mặc định 80%); thẻ trên Tổng quan cho biết đã chi bao nhiêu % lương, còn lại bao nhiêu, đổi màu xanh / vàng / đỏ, và báo ngay khi một khoản chi làm chạm mốc cảnh báo hoặc hết lương. Chỉ tính khoản chi của tháng hiện tại (thu nhập và chuyển tiền không tính).
- **Chia lương theo nhóm** (ví dụ tiêu dùng cá nhân 50%, công việc 30%, tiết kiệm 20% — mẫu có sẵn, đổi tên / % / thêm bớt tối đa 8 nhóm): mỗi danh mục chi thuộc một nhóm; nhóm chi có hạn mức = % × lương và đổi màu / báo khi sắp hết; nhóm tiết kiệm là phần còn lại sau khi chi, báo khi chi lấn vào mục tiêu tiết kiệm.
- **Giao dịch định kỳ** (hằng tháng / hằng tuần): tự tạo khi đến hạn, không tạo trùng.
- **Sổ vay nợ**: khoản mình nợ và khoản người khác nợ mình, thanh toán từng phần, nhắc khoản quá hạn.
- **Sao lưu / khôi phục** JSON, **đồng bộ Google Sheets**, **PWA offline**.

Chạy thử: `npm run serve` rồi mở http://127.0.0.1:4173/ (hoặc host thư mục này bằng bất kỳ static server nào; service worker cần `https` hoặc `localhost`). Chart.js và Font Awesome nằm trong `vendor/` nên không phụ thuộc CDN.

## Cấu trúc

| File                                                | Vai trò                                                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `index.html`, `css/style.css`                       | Giao diện                                                                                             |
| `js/utils.js`                                       | Hàm thuần dùng chung: escape HTML, định dạng, ngày, chuẩn hoá dữ liệu, lọc, CSV, lịch định kỳ, vay nợ |
| `js/data.js`                                        | State dùng chung, đọc / ghi `localStorage` an toàn, dữ liệu "meta" (`saveMeta`)                       |
| `js/ui.js`                                          | Chuyển tab, hộp thoại, loại giao dịch, thông báo (toast)                                              |
| `js/categories.js`, `js/budgets.js`, `js/salary.js` | Danh mục, ngân sách và chi tiêu trên lương                                                            |
| `js/recurring.js`, `js/debts.js`                    | Giao dịch định kỳ và sổ vay nợ                                                                        |
| `js/transactions.js`, `js/sources.js`               | Giao dịch (bộ lọc, xuất CSV) và nguồn tiền                                                            |
| `js/charts.js`                                      | Biểu đồ Chart.js                                                                                      |
| `js/sync.js`                                        | Đồng bộ Google Sheets                                                                                 |
| `js/backup.js`                                      | Sao lưu / khôi phục JSON                                                                              |
| `js/app.js`                                         | Khởi tạo, tổng quan, xóa dữ liệu                                                                      |
| `js/pwa.js`, `sw.js`, `manifest.json`               | PWA: cài đặt và chạy offline                                                                          |
| `vendor/`                                           | Chart.js 4.4.1 (MIT) và Font Awesome Free 6.4.0 (đi kèm giấy phép)                                    |
| `apps-script/Code.gs`                               | Mã Google Apps Script (giao thức v2)                                                                  |
| `tests/`                                            | Test e2e (Playwright) và test đơn vị / Apps Script (`node:test`)                                      |
| `CLAUDE.md`                                         | Bộ nhớ dự án cho các phiên làm việc với Claude Code                                                   |

## Kiểm thử

```bash
npm install
npx playwright install chromium
npm test            # e2e trên Chromium, tự khởi động tests/serve.js
npm run test:unit   # hàm thuần + script Apps Script trên Sheet giả
npm run format:check
```

CI (`.github/workflows/test.yml`) chạy cả ba lệnh trên cho mỗi PR. Test e2e không dùng mạng: mọi request ra ngoài đều bị chặn, và Google Apps Script được thay bằng chính mã Apps Script chạy trong sandbox trên Sheet giả.

## Đồng bộ Google Sheets

### Định dạng ngày trên Google Sheet

Ứng dụng luôn lưu ngày dạng `YYYY-MM-DD` và chỉ hiển thị `dd/mm/yyyy`, nên Sheet không bắt buộc phải đổi. Để cột ngày trong Sheet cũng hiện `dd/mm/yyyy`:

- **Script v2 (`apps-script/Code.gs`)**: tự đặt định dạng `dd/mm/yyyy` cho cột `date` mỗi lần ghi.
- **Script cũ**: chọn cả cột `date` (cột B) > Format > Number > Custom date and time > chọn `dd/mm/yyyy` > Apply. Chỉ cần làm một lần; ứng dụng vẫn đọc đúng cả giá trị ngày kiểu UTC (`2026-10-26T17:00:00.000Z` = 27/10 giờ Việt Nam).

Ô chọn ngày của trình duyệt hiện theo ngôn ngữ của thiết bị (điện thoại đặt tiếng Việt thì là `dd/mm/yyyy`). File CSV xuất ra cũng dùng `dd/mm/yyyy`: Excel đặt vùng Việt Nam hiểu đúng; nếu mở bằng Excel vùng Mỹ thì cột ngày có thể bị đọc nhầm tháng và ngày.

Ứng dụng tự nhận ra loại Apps Script đang dùng và không ghi gì trước khi đã đọc xong:

|                | Script cũ (legacy)                      | `apps-script/Code.gs` (v2)                                                                   |
| -------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| Đồng bộ        | Giao dịch (7 cột), ghi lại cả danh sách | Từng giao dịch (theo `updatedAt`) và danh mục, nguồn tiền, số dư, ngân sách, định kỳ, vay nợ |
| Chuyển tiền    | Nguồn nhận lưu trong cột danh mục       | Cột `targetSource`                                                                           |
| Nhiều thiết bị | Bản ghi cuối cùng thắng cả danh sách    | Bản có `updatedAt` mới hơn thắng từng dòng; xóa ở máy khác được áp dụng                      |
| Bảo vệ         | Ai có URL đều đọc / ghi được            | Mã bảo vệ (token) tùy chọn                                                                   |

### Nâng cấp lên v2

1. Mở Google Sheet > Extensions > Apps Script, thay toàn bộ mã bằng nội dung `apps-script/Code.gs`.
2. Deploy > Manage deployments > Edit > Version: New version > Deploy (URL `/exec` giữ nguyên).
3. Khuyến nghị: Project Settings > Script properties > thêm `FM_TOKEN` với một chuỗi bí mật dài, rồi nhập cùng giá trị vào **Cài đặt & Dữ liệu > Mã bảo vệ** trên mọi thiết bị và bấm Lưu.

Sheet `Transactions` được bổ sung cột `targetSource` và `updatedAt`, sheet `Meta` được tạo khi cần. Dữ liệu cũ được giữ; các dòng chuyển tiền do bản cũ ghi sẽ tự chuyển sang dạng mới.

### Quy tắc đồng bộ

- Chỉ ghi lên Sheet sau khi đã đọc Sheet thành công trong phiên đó.
- Thay đổi chưa được Sheet xác nhận (mất mạng, lỗi) được giữ lại và gộp với Sheet ở lần mở sau; giao dịch đã xóa trên máy này không bị "sống lại".
- Sheet trống không bao giờ xóa dữ liệu trên máy.
- Khôi phục sao lưu hoặc "Xóa toàn bộ dữ liệu" thay thế hẳn nội dung Sheet.
- Với v2, nếu sửa một giao dịch trên máy này trong khi máy khác xóa nó thì bản sửa được giữ lại.

Lưu ý: nếu chưa đặt `FM_TOKEN`, ai có URL Web App đều đọc / ghi được dữ liệu; hãy coi URL như mật khẩu (file sao lưu cũng chứa URL này, nhưng không chứa mã bảo vệ).
