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
- Chưa từng chạy trên Google thật: `Code.gs` v2 (chưa deploy) và việc POST `text/plain` có đọc được phản hồi từ trình duyệt hay không (v2 có dự phòng `GET ?action=sync&payload=` khi POST bị chặn).

## Cấu trúc

`index.html` nạp các script theo thứ tự (hàm/biến là global, không dùng module):
`utils → data → ui → categories → budgets → recurring → debts → transactions → sources → charts → sync → backup → app → pwa`.
Chart.js và Font Awesome nằm trong `vendor/` (không dùng CDN). Mỗi file nội bộ `index.html` nạp phải có trong `APP_SHELL` của `sw.js` (có test kiểm tra).

| File                                  | Vai trò                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/utils.js`                         | Hàm thuần dùng chung (có unit test): escapeHtml, formatMoney (vi-VN), ngày theo giờ địa phương, chuẩn hoá giao dịch/nguồn/ngân sách/định kỳ/vay nợ, `filterTransactions`, CSV, tính ngày định kỳ                                                                   |
| `js/data.js`                          | state toàn cục, `META_DEFS`/`saveMeta`, đọc `localStorage` an toàn                                                                                                                                                                                                 |
| `js/ui.js`                            | tab, `openDialog/closeDialog`, modal giao dịch, `showToast`, `selectValue`, tải file                                                                                                                                                                               |
| `js/categories.js`                    | danh mục (bảng có cột ngân sách)                                                                                                                                                                                                                                   |
| `js/budgets.js`                       | ngân sách tháng theo danh mục chi: đặt, thanh tiến độ trên Tổng quan, toast khi vượt 80%/100% (chỉ khi _vượt qua_ mốc)                                                                                                                                             |
| `js/recurring.js`                     | giao dịch định kỳ: quy tắc (tab Định Kỳ), sinh giao dịch đến hạn khi mở app / quay lại tab. Id sinh ra xác định `TX_R<số của id quy tắc>_<yyyymmdd>` nên nhiều thiết bị không tạo trùng; tạm dừng rồi tiếp tục không tạo bù; `lastGenerated` quyết định kỳ đã chạy |
| `js/debts.js`                         | sổ vay nợ (tab Vay Nợ & Cty): khoản `owe` (tôi nợ) / `owed` (họ nợ tôi), thanh toán từng phần, lịch sử, quá hạn, nhắc 1 lần/ngày (`fm_debt_reminder_day`, chỉ trên thiết bị). Độc lập với giao dịch và nguồn tiền (chưa tự ghi giao dịch khi trả nợ)               |
| `js/transactions.js`                  | thêm/sửa/xóa, bảng giao dịch, bộ lọc/tìm kiếm/"Xem thêm"/xuất CSV                                                                                                                                                                                                  |
| `js/sources.js`                       | nguồn tiền (`{name, kind, creditLimit, statementDay, dueDay, archived}`), số dư, thêm/sửa/lưu trữ/xóa/đổi tên                                                                                                                                                      |
| `js/charts.js`                        | Chart.js (có fallback khi thiếu thư viện)                                                                                                                                                                                                                          |
| `js/sync.js`                          | đồng bộ Google Sheets: legacy + v2 (xem mục Quyết định thiết kế)                                                                                                                                                                                                   |
| `js/backup.js`                        | sao lưu/khôi phục JSON (`format: finmanager-backup`, `version: 1`; mọi loại meta đều có trong file)                                                                                                                                                                |
| `js/app.js`                           | khởi tạo, Tổng quan, `renderAll`, reset                                                                                                                                                                                                                            |
| `js/pwa.js`, `sw.js`, `manifest.json` | PWA (service worker stale-while-revalidate, offline)                                                                                                                                                                                                               |
| `apps-script/Code.gs`                 | backend Apps Script v2 (superset của script cũ; chưa deploy, chưa chạy trên Google thật)                                                                                                                                                                           |
| `tests/e2e/*.spec.js`                 | Playwright; `helpers.js` có `newServer('legacy' \| 'v2')` chạy script Apps Script thật (script của chủ repo hoặc `Code.gs`) trong sandbox, dùng chung cho nhiều "thiết bị" (context), chặn mọi request ra ngoài                                                    |
| `tests/gas/`                          | `sandbox.js` chạy script Apps Script trong vm với Sheet giả (ngày thành ô ngày như Sheets thật); `fixtures/user-script.gs` = script thật của chủ repo; `code.test.js`                                                                                              |
| `tests/unit/`                         | `load.js` nạp script trình duyệt không cần DOM vào vm; `utils.test.js`                                                                                                                                                                                             |

## Mô hình dữ liệu (localStorage)

- `fm_transactions`: `{id, date YYYY-MM-DD, type income|expense|transfer, source, targetSource, category, amount, note, updatedAt}`. Id `TX_<ms>`.
- Dữ liệu "meta" khai báo trong `META_DEFS` (`js/data.js`), lưu bằng `saveMeta(key)` (ghi `localStorage`, đóng dấu `fm_meta_updated[key]`, gọi `queueMeta`): `categories` (`fm_categories`), `sources` (`fm_sources`), `initialBalances` (`fm_initial_balances`), `budgets` (`fm_budgets`), `recurring` (`fm_recurring`), `debts` (`fm_debts`). Mỗi loại có hàm `normalize*` thuần trong `js/utils.js` (trả `null` nếu dữ liệu không dùng được).
- Đồng bộ: `fm_script_url`, `fm_script_token`, `fm_sync_baseline`, `fm_sync_dirty`, `fm_pending_upserts`, `fm_deleted_ids`, `fm_pending_meta`, `fm_meta_updated`. Sau thay đổi cục bộ luôn gọi `queueUpsert/queueDelete/saveMeta` (đặt `updatedAt` mới cho giao dịch đã sửa) rồi `syncToGoogleSheet()`.

## Quy ước

- Khi sửa file bằng script (Python `str.replace`) luôn `assert` chuỗi tìm thấy: Prettier đổi bố cục code/bảng nên thay chuỗi có thể âm thầm không làm gì (đã từng khiến tab Vay Nợ không render và bỏ sót cập nhật tài liệu).
- Git: làm việc trên branch được giao và không tạo PR trùng khi branch đã có PR (cập nhật mô tả PR bằng `update_pull_request`); commit message viết bằng English, mỗi cột mốc một commit, chạy `npm test`, `npm run test:unit`, `npm run format:check` trước khi push.
- Prettier theo `.prettierrc.json` (4 space, single quote, `;`, trailing comma, width 100). Comment code bằng English, chuỗi giao diện bằng tiếng Việt.
- Không nội suy dữ liệu người dùng vào `innerHTML` mà không qua `escapeHtml`; không dùng `onclick="fn('${data}')"` — dùng `data-*` + event delegation.
- Ngày luôn là chuỗi `YYYY-MM-DD` theo giờ địa phương. Không dùng `toISOString().split('T')[0]` cho ngày hiển thị/nhập (UTC lệch ngày).
- Mỗi view render độc lập trong `renderAll()` (một view lỗi không được chặn view khác). Chart.js/CDN có thể không tải được.
- Tiền là số nguyên VND; hiển thị bằng `formatMoney`.
- Trợ năng (có test axe `tests/e2e/a11y.spec.js`, WCAG 2 A/AA): bảng dùng `class="responsive-table"` và `data-label` ở mỗi `td` (thành thẻ ở ≤768px); nút chỉ có icon phải có `aria-label`; hộp thoại mở/đóng bằng `openDialog/closeDialog` (đưa focus vào, trả focus, Esc, giữ Tab trong hộp thoại) và có `role="dialog" aria-modal aria-labelledby`; mọi ô nhập có `<label for>`. Giữ `--success/--danger/--warning` ở sắc đậm (đã chọn để đạt tương phản 4,5:1; màu biểu đồ ở `js/charts.js` là hex riêng).

## Quyết định thiết kế đã chốt (đừng đảo ngược khi chưa hỏi)

- "Tổng số dư khả dụng" = tổng số dư các nguồn **không phải nợ** (kể cả số dư ban đầu). Nguồn nợ = nguồn có loại `credit` (thẻ tín dụng/trả sau) hoặc `debt` (khoản nợ), định nghĩa ở `SOURCE_KINDS` trong `js/utils.js`; mặc định `Thẻ Tín Dụng`, `Spaylater` là `credit`, `Nợ Công Ty` là `debt` (nếu "Nợ Công Ty" thực ra là công ty nợ chủ repo thì đổi loại sang `other`). "Dư nợ" = tổng phần âm của các nguồn nợ.
- Card "Thu/Chi tháng này" chỉ cộng tháng hiện tại; biểu đồ tròn = chi tháng này; biểu đồ cột = 6 tháng gần nhất.
- Sync (xem comment đầu `js/sync.js`): **không bao giờ ghi lên server trước khi đã đọc và nhận diện được giao thức** (`GET ?v=2`: mảng = `legacy`, `{version: 2}` = `v2`).
    - `legacy` (script thật hiện tại của chủ repo): ghi bằng đúng `{"transactions": [...]}` (POST `text/plain`, không preflight); nếu không gửi được thì dự phòng `GET ?action=save&data=` khi URL ≤ 6000 ký tự và không có `%`, ngược lại không gửi gì và báo lỗi. `targetSource` đi trong cột category (`Chuyển tiền nội bộ → <nguồn nhận>`). Chỉ đồng bộ giao dịch; thay đổi danh mục/meta không kích hoạt ghi. Có test hồi quy `mọi lần ghi ... đều là {transactions}`.
    - `v2` (`apps-script/Code.gs`, chủ repo cần dán và deploy): POST `{action:'sync', token, replace, upserts, deletes, meta}`; server áp dụng theo `updatedAt` (bản mới hơn hoặc bằng thắng) và trả lại **toàn bộ trạng thái**, client gộp lại (`reconcileV2`). Meta (`categories, sources, initialBalances, budgets, recurring, debts`) đồng bộ nguyên khối theo `fm_meta_updated[key]`; lần đầu kết nối thì gộp hai phía (`mergeMetaFirstContact`). Token = Script Property `FM_TOKEN`, chủ repo nhập ở Cài đặt (`fm_script_token`, không nằm trong backup). `Code.gs` luôn validate trước khi ghi và vẫn hiểu các yêu cầu của script cũ (superset).
    - Hàng chờ cục bộ: `fm_sync_dirty` (`merge|replace`), `fm_pending_upserts`, `fm_deleted_ids`, `fm_pending_meta`; xóa khi server xác nhận _trừ_ phần thay đổi sau khi request được dựng. Sheet trống không xóa dữ liệu máy; khôi phục backup/reset là `replace` (server thay hẳn kể cả meta).
    - Bài học (sự cố 28/10/2026): bản đầu của PR #3 gửi `{"action":"save","data":...}` — do giả định giao thức khi chưa thấy script thật — sẽ xóa Sheet. Luôn kiểm chứng giao thức với script thật trong sandbox trước khi đổi cách ghi.
- URL Web App coi như mật khẩu (ai có URL đều đọc/ghi được).

## Cách kiểm thử

```bash
npm install && npx playwright install chromium   # lần đầu
npm test               # Playwright e2e (tự chạy tests/serve.js ở cổng 4173)
npm run test:unit      # node:test: Code.gs trên Sheet giả (tests/gas) + hàm thuần của js/utils.js (tests/unit)
npm run format:check   # Prettier (npm run format để sửa)
```

- Test e2e chạy hoàn toàn không cần mạng: mọi request tới host ngoài bị chặn và ghi vào `state.external` (phải rỗng); `script.google.com` được trả lời bởi script thật của chủ repo chạy trong sandbox (`tests/e2e/helpers.js`).
- Khi dùng `page.clock.setFixedTime` thì animation Chart.js bị đóng băng (chỉ kiểm tra dữ liệu, đừng chụp ảnh biểu đồ).
- Sandbox không tải được CDN; mọi thư viện đã nằm trong `vendor/`. `npm` registry thì dùng được.
- Sandbox Apps Script chỉ là mock của Sheets/ContentService — script chạy đúng trong mock chưa chứng minh chạy y hệt trên Google.

## Trạng thái (cập nhật 28/10/2026)

PR #3 (`claude/hopeful-einstein-l7hu3u` → `main`) gồm, theo thứ tự commit: sửa lỗi gốc (chuyển tiền không lưu được, `step` số tiền, ngày lệch múi giờ, sync mất dữ liệu, XSS, số liệu Tổng quan, localStorage hỏng/CDN lỗi) → PWA + vendor thư viện + test/CI trong repo → **sửa giao thức sync cho khớp script thật** → quản lý nguồn tiền → lọc/tìm kiếm/CSV → ngân sách → định kỳ → vay nợ → đồng bộ v2 → mobile + trợ năng. Toàn bộ test (162 e2e, 51 unit) pass trên bản clone sạch.

Việc chủ repo cần làm / quyết định:

- Xem và merge PR #3. Sau khi merge, bật GitHub Pages (hoặc host tĩnh bất kỳ) nếu muốn dùng PWA trên điện thoại (service worker cần https).
- Tùy chọn: nâng cấp Apps Script lên `apps-script/Code.gs` (xem README "Nâng cấp lên v2") để đồng bộ danh mục/nguồn/ngân sách/định kỳ/vay nợ và bật `FM_TOKEN`. **Chưa ai chạy `Code.gs` trên Google thật** — sau khi deploy, thử thêm/sửa/xóa một giao dịch và mở app trên máy thứ hai.
- Xác nhận cách POST `text/plain` đọc được phản hồi trên Web App thật (nếu không, app tự dự phòng bằng GET khi dữ liệu nhỏ).
- Nếu "Nợ Công Ty" thực ra là công ty nợ chủ repo: đổi loại nguồn đó sang "Khác".

Chưa làm / ý tưởng cho phiên sau:

- Trả nợ trong sổ vay nợ chưa tự ghi giao dịch/nguồn tiền tương ứng.
- Meta đồng bộ nguyên khối (hai thiết bị cùng sửa danh sách vay nợ/định kỳ một lúc thì bản mới hơn thắng cả danh sách, không gộp từng phần tử).
- Xóa trên server không có "bia mộ": sửa một giao dịch trên máy này trong khi máy khác xóa nó thì bản sửa sống lại.
- Biểu đồ theo nguồn tiền / theo danh mục nhiều tháng, ngân sách theo tháng cụ thể, nhập CSV, nhiều ví tiền tệ.
