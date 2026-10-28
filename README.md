# quan-ly-thu-chi (FinManager)

Ứng dụng web tĩnh quản lý thu chi cá nhân: nhập thu / chi / chuyển tiền giữa các nguồn tiền, xem số dư từng nguồn, biểu đồ theo tháng, sao lưu JSON và đồng bộ tùy chọn với Google Sheets.

Không cần build. Chạy thử: `npm run serve` rồi mở http://127.0.0.1:4173/ (hoặc host thư mục này bằng bất kỳ static server nào; service worker cần `https` hoặc `localhost`). Dữ liệu lưu trong `localStorage` của trình duyệt. Chart.js và Font Awesome nằm trong `vendor/` nên ứng dụng chạy được hoàn toàn offline sau lần mở đầu tiên (PWA, có thể "Cài đặt ứng dụng").

## Cấu trúc

| File                                  | Vai trò                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `index.html`, `css/style.css`         | Giao diện                                                                   |
| `js/utils.js`                         | Escape HTML, định dạng tiền / ngày theo giờ địa phương, chuẩn hoá giao dịch |
| `js/data.js`                          | State dùng chung, đọc `localStorage` an toàn                                |
| `js/ui.js`                            | Chuyển tab, modal, loại giao dịch, chip nhập nhanh                          |
| `js/transactions.js`                  | Thêm / sửa / xóa và bảng giao dịch                                          |
| `js/categories.js`                    | Danh mục                                                                    |
| `js/sources.js`                       | Nguồn tiền, số dư ban đầu, tính số dư                                       |
| `js/charts.js`                        | Biểu đồ Chart.js                                                            |
| `js/sync.js`                          | Đồng bộ Google Sheets                                                       |
| `js/backup.js`                        | Sao lưu / khôi phục JSON                                                    |
| `js/app.js`                           | Khởi tạo, tổng quan, xóa dữ liệu                                            |
| `js/pwa.js`, `sw.js`, `manifest.json` | PWA: cài đặt và chạy offline                                                |
| `vendor/`                             | Chart.js 4.4.1 (MIT) và Font Awesome Free 6.4.0 (đi kèm giấy phép)          |
| `apps-script/Code.gs`                 | Mã Google Apps Script tham chiếu cho Sheet                                  |
| `tests/`                              | Test e2e (Playwright) và test `Code.gs` (`node:test`)                       |

## Kiểm thử

```bash
npm install
npx playwright install chromium
npm test            # e2e trên Chromium, tự khởi động tests/serve.js
npm run test:gas    # logic Code.gs trên mock Sheet
npm run format:check
```

CI (`.github/workflows/test.yml`) chạy cả ba lệnh trên cho mỗi PR.

## Đồng bộ Google Sheets

1. Mở Google Sheet > Extensions > Apps Script, dán nội dung `apps-script/Code.gs`.
2. Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
3. Dán URL `/exec` vào **Cài đặt & Dữ liệu > Web App URL** rồi bấm Lưu.

Sheet `Transactions` có các cột `id, date, type, source, category, amount, note, targetSource`. Cột `targetSource` bắt buộc để giao dịch chuyển tiền giữ được nguồn nhận.

Quy tắc đồng bộ:

- Chỉ ghi đè Sheet sau khi đã đọc Sheet thành công trong phiên đó.
- Thay đổi chưa được Sheet xác nhận (mất mạng, lỗi) được giữ lại và gộp với Sheet ở lần mở sau; giao dịch đã xóa trên máy này không bị "sống lại".
- Sheet trống không bao giờ xóa dữ liệu trên máy.
- Khôi phục sao lưu hoặc "Xóa toàn bộ dữ liệu" thay thế hẳn nội dung Sheet.
- Sửa cùng một giao dịch trên hai thiết bị: bản sửa trên máy có thay đổi chưa đồng bộ được ưu tiên.

Lưu ý: ai có URL Web App đều đọc / ghi được dữ liệu, hãy coi URL như mật khẩu (file sao lưu cũng chứa URL này).
