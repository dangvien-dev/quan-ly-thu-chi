# CLAUDE.md — bộ nhớ dự án FinManager (quan-ly-thu-chi)

File này được Claude Code tự đọc ở đầu mỗi phiên. Giữ nó ngắn, đúng và cập nhật sau mỗi thay đổi lớn.

## Bối cảnh

- Chủ repo: Nguyễn Đăng Viên (vienkendo@gmail.com), chuyên gia IT độc lập, thích tự động hoá, ghét việc lặp lại. **Luôn trả lời bằng tiếng Việt**; giữ nguyên thuật ngữ kỹ thuật, tên file, lệnh, API, Git/GitHub bằng English.
- App thu chi cá nhân, web tĩnh (HTML/CSS/JS thuần, không build), dữ liệu ở `localStorage`, đồng bộ tùy chọn với Google Sheets qua Google Apps Script.
- Sheet thật của chủ repo: `DataThuChi_CaNhan`, tab `Transactions`, cột `id,date,type,source,category,amount,note` (chưa có `targetSource`). Ngày trong Sheet là UTC (`2026-10-26T17:00:00.000Z` = 27/10 giờ VN).
- **Apps Script thật của chủ repo** (chủ repo gửi ngày 28/10/2026) được giữ nguyên văn ở `tests/gas/fixtures/user-script.gs`; test e2e chạy đúng script này trong sandbox. Đặc điểm cần nhớ:
    - `doGet` trả mảng giao dịch (7 cột, ngày ra dạng ISO UTC); `?action=save&data=<json>` ghi bằng GET (cách duy nhất từng chạy thật trên trình duyệt của chủ repo vì CORS; giới hạn độ dài URL, và script `decodeURIComponent` lần thứ hai nên dữ liệu có `%` sẽ lỗi).
    - `doPost` chỉ hiểu body `{"transactions": [...]}`. Nó **xóa Sheet trước khi đọc body**, nên mọi body khác (ví dụ `{"action":"save","data":[...]}`) làm mất toàn bộ dữ liệu mà vẫn trả HTTP 200. Lỗi kiểu `{"status":"error","message":...}` cũng trả 200.
    - Chỉ 7 cột `id,date,type,source,category,amount,note`: không có `targetSource`, `updatedAt`, không đồng bộ danh mục/nguồn/số dư.
- Chưa từng chạy trên Google thật: `Code.gs` (bản tham chiếu trong repo, chưa deploy) và việc POST `text/plain` có đọc được phản hồi từ trình duyệt hay không.

## Cấu trúc

`index.html` nạp các script theo thứ tự (hàm/biến là global, không dùng module):
`utils → data → ui → categories → budgets → recurring → transactions → sources → charts → sync → backup → app → pwa`.
Chart.js và Font Awesome nằm trong `vendor/` (không dùng CDN). Mỗi file nội bộ `index.html` nạp phải có trong `APP_SHELL` của `sw.js` (có test kiểm tra).

| File                                  | Vai trò                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `js/utils.js`                         | escapeHtml, formatMoney (vi-VN), ngày theo giờ địa phương, chuẩn hoá giao dịch |
| `js/data.js`                          | state toàn cục, đọc `localStorage` an toàn                                     |
| `js/ui.js`                            | tab, modal, loại giao dịch, chip nhập nhanh                                    |
| `js/transactions.js`                  | thêm/sửa/xóa, bảng giao dịch                                                   |
| `js/categories.js`                    | danh mục                                                                       |
| `js/sources.js`                       | nguồn tiền, số dư                                                              |
| `js/charts.js`                        | Chart.js (có fallback khi thiếu thư viện)                                      |
| `js/sync.js`                          | đồng bộ Google Sheets                                                          |
| `js/backup.js`                        | sao lưu/khôi phục JSON (`format: finmanager-backup`, `version: 1`)             |
| `js/app.js`                           | khởi tạo, Tổng quan, reset                                                     |
| `js/pwa.js`, `sw.js`, `manifest.json` | PWA (service worker stale-while-revalidate, offline)                           |
| `apps-script/Code.gs`                 | backend Apps Script tham chiếu                                                 |
| `tests/e2e/*.spec.js`                 | Playwright; `helpers.js` có mock Apps Script, chặn mọi request ra ngoài        |
| `tests/gas/`                          | `sandbox.js` chạy `Code.gs` trong vm với Sheet giả; `code.test.js`             |

## Mô hình dữ liệu (localStorage)

- `fm_transactions`: `{id, date YYYY-MM-DD, type income|expense|transfer, source, targetSource, category, amount, note, updatedAt}`. Id `TX_<ms>`.
- Dữ liệu "meta" khai báo trong `META_DEFS` (`js/data.js`), lưu bằng `saveMeta(key)` (ghi `localStorage`, đóng dấu `fm_meta_updated[key]`, gọi `queueMeta`): `categories` (`fm_categories`), `sources` (`fm_sources`), `initialBalances` (`fm_initial_balances`), `budgets` (`fm_budgets`), `recurring` (`fm_recurring`); sẽ thêm `debts`. Mỗi loại có hàm `normalize*` thuần trong `js/utils.js` (trả `null` nếu dữ liệu không dùng được).
- Đồng bộ: `fm_script_url`, `fm_sync_dirty`, `fm_sync_baseline`, `fm_deleted_ids`. Sau thay đổi cục bộ luôn gọi `queueUpsert/queueDelete/saveMeta` rồi `syncToGoogleSheet()`.

## Quy ước

- Prettier theo `.prettierrc.json` (4 space, single quote, `;`, trailing comma, width 100). Comment code bằng English, chuỗi giao diện bằng tiếng Việt.
- Không nội suy dữ liệu người dùng vào `innerHTML` mà không qua `escapeHtml`; không dùng `onclick="fn('${data}')"` — dùng `data-*` + event delegation.
- Ngày luôn là chuỗi `YYYY-MM-DD` theo giờ địa phương. Không dùng `toISOString().split('T')[0]` cho ngày hiển thị/nhập (UTC lệch ngày).
- Mỗi view render độc lập trong `renderAll()` (một view lỗi không được chặn view khác). Chart.js/CDN có thể không tải được.
- Tiền là số nguyên VND; hiển thị bằng `formatMoney`.

## Quyết định thiết kế đã chốt (đừng đảo ngược khi chưa hỏi)

- "Tổng số dư khả dụng" = tổng số dư các nguồn **không phải nợ** (kể cả số dư ban đầu). Nguồn nợ = nguồn có loại `credit` (thẻ tín dụng/trả sau) hoặc `debt` (khoản nợ), định nghĩa ở `SOURCE_KINDS` trong `js/utils.js`; mặc định `Thẻ Tín Dụng`, `Spaylater` là `credit`, `Nợ Công Ty` là `debt` (nếu "Nợ Công Ty" thực ra là công ty nợ chủ repo thì đổi loại sang `other`). "Dư nợ" = tổng phần âm của các nguồn nợ.
- Card "Thu/Chi tháng này" chỉ cộng tháng hiện tại; biểu đồ tròn = chi tháng này; biểu đồ cột = 6 tháng gần nhất.
- Sync (xem comment đầu `js/sync.js`): **không bao giờ ghi lên server trước khi đã đọc và nhận diện được giao thức** (`GET ?v=2`; mảng = `legacy`). Giao thức `legacy` ghi bằng đúng `{"transactions": [...]}` (POST `text/plain`, không preflight), nếu không gửi được thì dự phòng `GET ?action=save&data=` khi URL ≤ 6000 ký tự và không có `%`, ngược lại không gửi gì và báo lỗi. Có test hồi quy `mọi lần ghi ... đều là {transactions}`.
    - `targetSource` của giao dịch chuyển tiền đi trong cột category (`Chuyển tiền nội bộ → <nguồn nhận>`) khi server là legacy.
    - Thay đổi chưa xác nhận được giữ (`fm_sync_dirty`, `fm_deleted_ids`) và gộp ở lần mở sau; Sheet trống không xóa dữ liệu máy; khôi phục backup/reset là `replace`.
    - Bài học (sự cố 28/10/2026): bản đầu của PR #3 gửi `{"action":"save","data":...}` — do giả định giao thức khi chưa thấy script thật — sẽ xóa Sheet. Luôn kiểm chứng giao thức với script thật trong sandbox trước khi đổi cách ghi.
- URL Web App coi như mật khẩu (ai có URL đều đọc/ghi được).

## Cách kiểm thử

```bash
npm install && npx playwright install chromium   # lần đầu
npm test               # Playwright e2e (tự chạy tests/serve.js ở cổng 4173)
npm run test:unit      # node:test: Code.gs trên Sheet giả (tests/gas) + hàm thuần của js/utils.js (tests/unit)
npm run format:check   # Prettier (npm run format để sửa)
```

- Test e2e chạy hoàn toàn không cần mạng: mọi request tới host ngoài bị chặn và ghi vào `state.external` (phải rỗng); `script.google.com` được mock trong `tests/e2e/helpers.js`.
- Khi dùng `page.clock.setFixedTime` thì animation Chart.js bị đóng băng (chỉ kiểm tra dữ liệu, đừng chụp ảnh biểu đồ).
- Sandbox không tải được CDN; mọi thư viện đã nằm trong `vendor/`. `npm` registry thì dùng được.
- Mock `Code.gs` chỉ là mock — chưa từng chạy trên Google thật.

## Tiến độ nâng cấp (PR #3, branch `claude/hopeful-einstein-l7hu3u`)

Đã xong (commit a723408): sửa lỗi chuyển tiền, step số tiền, ngày lệch, sync mất dữ liệu, XSS, số liệu Tổng quan, localStorage hỏng/CDN lỗi, Apps Script tham chiếu, README.

Đang làm theo thứ tự (đánh dấu khi xong):

- [x] Dọn repo (xóa `script.js`, css/asset trống), chuyển `style.css` → `css/style.css`
- [x] Vendor Chart.js + Font Awesome, PWA (`manifest.json`, `sw.js`, icon)
- [x] Test e2e + CI trong repo
- [x] Quản lý nguồn tiền (thêm/sửa/lưu trữ/xóa, loại, hạn mức, ngày sao kê; nguồn lạ từ Sheet tự thêm)
- [x] Lọc/tìm kiếm/phân trang/xuất CSV (lọc thuần ở `filterTransactions` trong `js/utils.js`, có unit test)
- [x] Ngân sách theo danh mục (meta `budgets` = `{tênDanhMục: hạnMức}`; toast qua `showToast` trong `js/ui.js`)
- [x] Giao dịch định kỳ (meta `recurring`; logic ngày đến hạn là hàm thuần trong `js/utils.js`, có unit test)
- [ ] Sổ vay nợ (tab "Vay Nợ & Cty")
- [ ] Đồng bộ từng dòng (upsert/delete + `updatedAt`) + token + đồng bộ danh mục/số dư/... (v2)
- [ ] Mobile (bảng → thẻ) + truy cập bằng bàn phím/ARIA
