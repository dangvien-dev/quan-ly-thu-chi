# quan-ly-thu-chi (FinManager)

Ứng dụng web tĩnh quản lý thu chi cá nhân. Không cần build, không cần server riêng: dữ liệu nằm trong `localStorage` của trình duyệt và có thể đồng bộ tùy chọn với Google Sheets qua Google Apps Script. Cài được như ứng dụng (PWA) và chạy offline.

## Tính năng

- **Giao dịch**: thu / chi / chuyển tiền giữa các nguồn; lọc theo tháng, loại, danh mục, nguồn; tìm kiếm không dấu; xem thêm theo trang. Xuất CSV (UTF-8, mở được trong Excel) nằm ở **Cài đặt & Dữ liệu**: tất cả giao dịch, hoặc chỉ những giao dịch theo bộ lọc đang chọn ở Sổ Giao Dịch.
- **Điện thoại**: thanh dưới gọn 4 mục (Tổng quan, Sổ GD, Nguồn, Vay nợ) với nút `+` thêm giao dịch tròn nhô lên ở giữa; các trang còn lại (Danh mục, Định kỳ, Cài đặt…) nằm trong menu trái mở bằng nút ☰ ở đầu trang. Kéo làm mới vẫn ở đúng trang đang xem. Danh mục cũng là một dòng gọn mỗi mục. Mỗi giao dịch là một dòng (ngày · ghi chú · số tiền, viền màu theo loại thu / chi / chuyển); chạm vào dòng để xem nguồn tiền, danh mục và nút sửa / xóa.
- **Nhập liệu dễ đọc**: ngày hiển thị `dd/mm/yyyy` ở mọi nơi (kể cả CSV); các ô tiền tự thêm dấu chấm ngăn cách hàng nghìn khi gõ (`1500000` → `1.500.000`).
- **Nguồn tiền**: tiền mặt, ngân hàng, ví điện tử, thẻ tín dụng / trả sau (hạn mức, ngày chốt sao kê, hạn thanh toán), khoản nợ; lưu trữ, đổi tên (cập nhật mọi giao dịch). Nút **Khớp số dư** nhập số thực tế trong ứng dụng ngân hàng / ví (thẻ tín dụng có hạn mức thì nhập số **khả dụng**), app tự tính số dư ban đầu, không phải trừ tay.
- **Nhập sao kê ngân hàng (CSV hoặc PDF)**: Cài đặt → _Nhập sao kê_. Chọn file CSV tải từ internet banking (hoặc file PDF sao kê, kể cả file có mật khẩu: app hỏi mật khẩu, chỉ dùng để mở file ngay trên máy và không lưu) và nguồn tiền; ứng dụng tự nhận dòng tiêu đề và các cột (ngày, nội dung, ghi nợ / ghi có hoặc một cột số tiền), đọc được ngày dd/mm/yyyy, số kiểu `1.234.567` hay `1,234,567`, file UTF-8 / UTF-16 / Windows-1258. Bước xem trước cho sửa loại, danh mục từng dòng (gợi ý từ giao dịch bạn đã nhập, dòng phí / VAT của ngân hàng và vài cửa hàng quen) và **bỏ chọn sẵn các dòng trùng với giao dịch bạn đã gõ tay** (cùng nguồn, cùng số tiền — lệch tối đa 1 đ do làm tròn —, lệch tối đa 2 ngày). Dòng **rút tiền ATM, trả sao kê thẻ hay chuyển giữa các nguồn của bạn** được đề xuất là loại **Chuyển ra / Chuyển vào** kèm nguồn kia (chọn lại được, đổi về Chi / Thu được): ghi thành giao dịch chuyển tiền giữa hai nguồn, không tính là chi hay thu. Nhập lại cùng file không bị nhân đôi; có nút **Hoàn tác lần nhập vừa rồi**. Các cột đã xác nhận được nhớ cho lần sau. Với sao kê PDF app còn **đối chiếu tổng** các dòng đọc được với "Nợ phát sinh trong kỳ" / "Đã thanh toán" của sao kê để biết có sót dòng không, và có thể **cập nhật thẻ tín dụng theo sao kê** (ngày chốt, ngày đến hạn, dư nợ cuối kỳ) để dòng "Cần trả" đúng với ngân hàng. PDF ảnh chụp / scan chưa đọc được.
- **Thẻ (tag)**: gắn thẻ cho giao dịch (ô Thẻ trong biểu mẫu, gõ `khachA dh102` hoặc chạm các thẻ đã dùng) để theo dõi một khách hay một đơn hàng. Thẻ hiện thành chip cạnh ghi chú, chạm chip hoặc dùng bộ lọc **Thẻ** ở Sổ Giao Dịch để xem riêng; dòng tóm tắt (Thu / Chi / Chênh lệch) cho biết lãi lỗ của thẻ đó. Thẻ được lưu dạng `#thẻ` ngay trong ghi chú nên Google Sheet, CSV và sao lưu đều mang theo (CSV còn có cột **Thẻ** riêng). Trang **Thẻ & Khách Hàng** liệt kê mọi thẻ với thu, chi và lãi / lỗ (tất cả thời gian, năm nay hoặc tháng này) để biết mỗi khách hay đơn hàng lãi bao nhiêu; ở đó đổi tên thẻ, hoặc đổi thành tên một thẻ đang có để gộp hai thẻ.
- **Sắp xếp**: nút **Sắp xếp** ở trang Nguồn Tiền và Danh Mục chuyển sang chế độ chỉ có Lên / Xuống để đặt thứ tự; thứ tự này dùng ở mọi ô chọn nguồn tiền / danh mục và bộ lọc, được lưu cùng sao lưu và đồng bộ giữa các máy.
- **Ô nhập tiền**: mọi ô nhập số tiền (giao dịch, hạn mức, số dư ban đầu, lương, tiết kiệm, vay nợ, định kỳ) và các hộp hỏi số tiền (Sửa số dư, Khớp số dư, ngân sách danh mục, trả nợ) đều tự thêm dấu chấm hàng nghìn khi gõ.
- **Phiên bản**: số phiên bản (ngày + mã băm của nội dung code) hiện ở chân menu trái và trong Cài đặt, kèm nút "Kiểm tra bản mới"; khi một bản mới được cài lúc đang mở app sẽ hiện thanh "Tải lại". Nhà phát triển chạy `npm run stamp` sau khi sửa code để cập nhật số này.
- **Tổng quan**: bấm vào từng thẻ để xem chi tiết (Thu / Chi mở Sổ Giao Dịch đã lọc theo tháng này, Dư nợ mở giao dịch của mọi thẻ tín dụng / trả sau / nợ, Số dư khả dụng mở trang Nguồn Tiền, Tổng tiết kiệm mở Sổ Tiết Kiệm); thu / chi tháng này, số dư khả dụng (kèm dòng nhỏ "trừ nợ thẻ / SPay thì còn bao nhiêu"), dư nợ (kèm % so với lương và cảnh báo từ 30% lương, chỉnh được; thêm dòng "tháng này dùng thẻ / trả sau" không về 0 khi trả sao kê, có báo ngay khi một khoản mua trả sau làm chạm mốc), biểu đồ chi tiêu tháng và thu / chi 6 tháng, thanh tiến độ ngân sách.
- **Ngân sách** theo danh mục chi, cảnh báo khi vượt 80% và 100%.
- **Sổ tiết kiệm**: loại nguồn tiền riêng, không tính vào số dư khả dụng (có thẻ "Tổng tiết kiệm" riêng). Đặt ngày lãnh lương thì mỗi tháng ứng dụng tự chuyển một khoản (theo % lương hoặc số tiền cố định) từ nguồn nhận lương vào sổ, không gửi bù các tháng trước ngày cài đặt; có nút Gửi vào / Rút ra và lịch sử gửi / rút.
- **Chi tiêu trên lương**: đặt lương hằng tháng và mức cảnh báo (mặc định 80%); thẻ trên Tổng quan cho biết đã chi bao nhiêu % lương, còn lại bao nhiêu, đổi màu xanh / vàng / đỏ, và báo ngay khi một khoản chi làm chạm mốc cảnh báo hoặc hết lương. Chỉ tính khoản chi của tháng hiện tại (thu nhập và chuyển tiền không tính).
- **Chia lương theo nhóm** (ví dụ tiêu dùng cá nhân 50%, công việc 30%, tiết kiệm 20% — mẫu có sẵn, đổi tên / % / thêm bớt tối đa 8 nhóm): mỗi danh mục chi thuộc một nhóm; nhóm chi có hạn mức = % × lương và đổi màu / báo khi sắp hết; nhóm tiết kiệm là phần còn lại sau khi chi, báo khi chi lấn vào mục tiêu tiết kiệm.
- **Giao dịch định kỳ** (hằng tháng / hằng tuần): tự tạo khi đến hạn, không tạo trùng.
- **Sổ vay nợ**: khoản mình nợ và khoản người khác nợ mình, thanh toán từng phần, nhắc khoản quá hạn. Khi trả / thu nợ có thể chọn nguồn tiền để app tự ghi giao dịch Chi "Trả nợ" hoặc Thu "Thu nợ" (không phải nhập hai nơi); xóa lần trả thì giao dịch đó cũng bị xóa.
- **Phép tính trong ô nhập tiền**: gõ thẳng `582719+11000`, `1200000/3` hay `22,22*26225` vào mọi ô tiền; kết quả hiện ngay dưới ô (`= 593.719 đ`) và thay cho phép tính khi rời ô hoặc nhấn Enter. Dấu `,` là dấu thập phân (`582.719,50` thành `582.720`, không còn thành 58.271.950), dấu `.` là hàng nghìn, kết quả làm tròn đồng. Trên điện thoại / máy tính bảng, khi đang gõ vào ô tiền có thêm 4 nút `+ − × ÷` ngay dưới ô (bàn phím số của điện thoại không có các dấu này).
- **Hạn thanh toán thẻ**: thẻ tín dụng / trả sau có ngày hạn hiện dòng "Cần trả … trước …" (số tiền của kỳ sao kê đã chốt, trừ phần đã trả); từ 3 ngày trước hạn hoặc khi quá hạn dòng đổi đỏ và app nhắc mỗi ngày một lần. Nút **Đã trả** ngay dưới dòng đó ghi khoản đã trả (số tiền, ngày, nguồn trả) thành giao dịch chuyển tiền vào thẻ. Ngày chốt sao kê là **ngày cuối của kỳ** (kỳ 21/09–20/10 thì chốt ngày 20). Điền thêm **dư nợ cuối kỳ** của sao kê gần nhất (ở Sửa nguồn, hoặc bấm **Nhập dư nợ cuối kỳ** ngay trên thẻ) thì "Cần trả" dựa vào số in trên sao kê, không bị lệch khi số dư ban đầu sai; chưa điền thì thẻ ghi rõ "Cần trả" chỉ là ước tính từ số dư ban đầu. Khi sổ lệch so với dư nợ in trên sao kê (thường vì chưa nhập các dòng phí chuyển đổi ngoại tệ / VAT), thẻ có một dòng ghi chú nói rõ lệch bao nhiêu và vì sao, kèm cách làm hết. Với thẻ có ngày chốt, lọc theo thẻ ở Sổ Giao Dịch có thêm ô **Kỳ sao kê** (hoặc bấm **Xem theo kỳ** trên thẻ), kèm tổng phát sinh / đã thanh toán của kỳ để đối chiếu với sao kê.
- **Sao lưu / khôi phục** JSON, **đồng bộ Google Sheets**, **PWA offline**.

Chạy thử: `npm run serve` rồi mở http://127.0.0.1:4173/ (hoặc host thư mục này bằng bất kỳ static server nào; service worker cần `https` hoặc `localhost`). Chart.js và Font Awesome nằm trong `vendor/` nên không phụ thuộc CDN.

## Cấu trúc

| File                                                | Vai trò                                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `index.html`, `css/style.css`                       | Giao diện                                                                                                |
| `js/utils.js`                                       | Hàm thuần dùng chung: escape HTML, định dạng, ngày, chuẩn hoá dữ liệu, lọc, CSV, lịch định kỳ, vay nợ    |
| `js/data.js`                                        | State dùng chung, đọc / ghi `localStorage` an toàn, dữ liệu "meta" (`saveMeta`)                          |
| `js/ui.js`                                          | Chuyển tab, hộp thoại, loại giao dịch, thông báo (toast)                                                 |
| `js/categories.js`, `js/budgets.js`, `js/salary.js` | Danh mục, ngân sách và chi tiêu trên lương                                                               |
| `js/recurring.js`, `js/debts.js`                    | Giao dịch định kỳ và sổ vay nợ                                                                           |
| `js/savings.js`                                     | Sổ tiết kiệm: tự động gửi khi lãnh lương, các sổ và lịch sử gửi / rút                                    |
| `js/transactions.js`, `js/sources.js`               | Giao dịch (bộ lọc, xuất CSV) và nguồn tiền                                                               |
| `js/tags.js`                                        | Trang Thẻ & Khách Hàng: báo cáo theo thẻ, đổi tên / gộp thẻ                                              |
| `js/import.js`                                      | Nhập sao kê ngân hàng (CSV, PDF): chọn file, nhận cột, xem trước, ghi giao dịch, hoàn tác                |
| `js/charts.js`                                      | Biểu đồ Chart.js                                                                                         |
| `js/sync.js`                                        | Đồng bộ Google Sheets                                                                                    |
| `js/backup.js`                                      | Sao lưu / khôi phục JSON                                                                                 |
| `js/app.js`                                         | Khởi tạo, tổng quan, xóa dữ liệu                                                                         |
| `js/pwa.js`, `sw.js`, `manifest.json`               | PWA: cài đặt và chạy offline                                                                             |
| `vendor/`                                           | Chart.js 4.4.1 (MIT), Font Awesome Free 6.4.0 và pdf.js 3.11.174 (Apache-2.0, chỉ nạp khi chọn file PDF) |
| `apps-script/Code.gs`                               | Mã Google Apps Script (giao thức v2)                                                                     |
| `tests/`                                            | Test e2e (Playwright) và test đơn vị / Apps Script (`node:test`)                                         |
| `CLAUDE.md`                                         | Bộ nhớ dự án cho các phiên làm việc với Claude Code                                                      |

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
| Bảo vệ         | Ai có URL đều đọc / ghi được            | Bắt buộc mã bảo vệ (`FM_TOKEN`); thiếu thì từ chối mọi yêu cầu                               |

### Nâng cấp lên v2

1. Mở Google Sheet > Extensions > Apps Script, thay toàn bộ mã bằng nội dung `apps-script/Code.gs`.
2. Deploy > Manage deployments > Edit > Version: New version > Deploy (URL `/exec` giữ nguyên). Nếu tạo **New deployment** thì URL đổi: bắt buộc chọn **Execute as: Me** và **Who has access: Anyone** (mặc định là "Chỉ mình tôi" / "Người dùng truy cập vào ứng dụng web" làm app báo `Failed to fetch` và "Dùng bản offline"), rồi dán URL mới vào **mọi** thiết bị, điện thoại trước.
3. **Bắt buộc**: Project Settings > Script properties > thêm `FM_TOKEN` với một chuỗi bí mật dài (32 ký tự trở lên), rồi nhập cùng giá trị vào **Cài đặt & Dữ liệu > Mã bảo vệ** trên mọi thiết bị và bấm Lưu. Chưa có `FM_TOKEN` thì script từ chối mọi yêu cầu (app báo "Sai mã bảo vệ"). Chỉ khi dữ liệu thật sự được phép công khai mới thêm `FM_ALLOW_OPEN` = `true` thay cho token. App không bao giờ đưa mã bảo vệ vào URL: đọc bằng `GET ?v=2` (không token) rồi `POST` có token trong body; khi `POST` không gửi được thì thay đổi được giữ lại để gửi sau, không chuyển sang `GET` (cách dự phòng `GET ?action=sync` chỉ dùng khi không có mã bảo vệ).
4. Sau khi đổi URL (New deployment), vào **Manage deployments** và **Archive** các deployment cũ: URL cũ vẫn chạy cho tới khi bị archive.

Sheet `Transactions` được bổ sung cột `targetSource` và `updatedAt`, sheet `Meta` được tạo khi cần. Dữ liệu cũ được giữ; các dòng chuyển tiền do bản cũ ghi sẽ tự chuyển sang dạng mới.

### Nâng cấp và thử trên Sheet thử nghiệm trước khi dùng dữ liệu thật

Test tự động chạy trên bản giả của Google Sheets, nên **không chứng minh** được cách Google xử lý khóa, hạn mức, thời gian chờ và giới hạn của Script Property. Trước khi dùng bản mới với dữ liệu thật:

1. **Sao lưu**: Cài đặt > Sao lưu trên một máy, cất file JSON.
2. **Đóng mọi cửa sổ / tab FinManager đang mở** (kể cả PWA đã cài trên điện thoại và máy tính): một tab cũ vẫn chạy mã cũ, không gửi `fence` / `baseRevision` nên không được bảo vệ.
3. **Deploy `Code.gs` mới trước** (Manage deployments > Edit > New version), rồi mới tải app mới và mở lại các máy; kiểm tra mục Phiên Bản Ứng Dụng đã đổi.
4. **Thử trên một bản sao của Sheet** (File > Make a copy), có Apps Script, `FM_TOKEN` và URL riêng, mở bằng một hồ sơ trình duyệt hoặc cửa sổ ẩn danh riêng. **Không dùng token và URL thật.** Các việc cần kiểm tra bằng tay:
    - mở `<URL thử>/exec?v=2` trong cửa sổ ẩn danh: phải ra `unauthorized`; nhập sai mã bảo vệ: app báo "Sai mã bảo vệ";
    - thêm, sửa, xóa giao dịch và sửa một cấu hình (ví dụ ngân sách): nhìn vào Sheet thử thấy đúng;
    - tắt mạng, sửa vài thứ, bật lại: nhãn về "Đã lưu", không có giao dịch nào mất hay nhân đôi;
    - hai thiết bị cùng Sheet thử: sửa ở máy này, máy kia nhận sau khi quay lại cửa sổ;
    - Khôi phục sao lưu ở máy A: máy B hỏi Khôi phục / Xóa / Để sau, chọn Để sau thì dữ liệu máy B còn nguyên;
    - Apps Script > Executions không có lỗi đỏ; Project Settings > Script properties: `FM_REQUEST_LOG` còn dưới khoảng 9 KB.
5. Xong thì xóa hoặc Archive deployment thử.

### Quy tắc đồng bộ

- Chỉ ghi lên Sheet sau khi đã đọc Sheet thành công trong phiên đó.
- Quay lại cửa sổ hoặc tab (sau ít nhất 30 giây) thì ứng dụng đọc lại Sheet để nhận thay đổi từ máy khác, không cần tải lại trang.
- Thay đổi chưa được Sheet xác nhận (mất mạng, lỗi) được giữ lại và gộp với Sheet ở lần mở sau; giao dịch đã xóa trên máy này không bị "sống lại".
- Sheet trống không bao giờ tự xóa dữ liệu trên máy. Với v2, khi Sheet bỗng thiếu nhiều giao dịch máy này đã đồng bộ (Sheet trống, thiếu quá nửa, hoặc thiếu từ 20 dòng một lúc), app hỏi trước với ba lựa chọn: **Khôi phục** (khuyên dùng) giữ dữ liệu trên máy và đưa lại lên Sheet; **Xóa trên máy** cho giống Sheet, chỉ khi bấm OK ở câu hỏi "Xóa …"; **Để sau** giữ trên máy, chưa gửi lên Sheet, hỏi lại khi mở app lần sau (trong lúc đó nhãn đồng bộ hiện **Chờ xử lý (N)** thay vì "Đã lưu"). Đóng hộp thoại hay bấm Esc không bao giờ xóa dữ liệu. Máy khác xóa vài giao dịch thì vẫn nhận việc xóa như thường.
- `Code.gs` từ chối mọi yêu cầu làm trống Sheet (v2 `replace` rỗng, v2 `deletes` xóa hết các dòng, hay kiểu cũ `{transactions: []}` / `?action=save&data=[]`) nếu không có `confirmWipe` (app chỉ gửi cờ này khi máy không còn giao dịch nào: "Xóa toàn bộ dữ liệu", khôi phục bản sao lưu rỗng, hoặc xóa giao dịch cuối cùng). Mỗi yêu cầu đồng bộ được **kiểm tra toàn bộ trước khi ghi** sheet nào: sai kiểu dữ liệu hay chỉ một giao dịch không hợp lệ là cả yêu cầu bị từ chối (không âm thầm bỏ dòng). Apps Script không có giao dịch (transaction) nên phần ghi chỉ là "cố gắng hết mức": ghi lỗi thì đặt lại sheet đó, ghi `Meta` lỗi sau khi đã ghi `Transactions` thì đặt lại `Transactions`; nếu chính bước đặt lại cũng lỗi, app báo rõ "KHÔNG khôi phục được … sheet …" kèm cách khôi phục (Nhật ký phiên bản của Google Sheet hoặc file sao lưu). Mỗi lần ghi mang một mã yêu cầu (`requestId`) và server không bao giờ áp dụng cùng một mã hai lần. Khi mất phản hồi, app **hỏi server trước** (`appliedCheck`) xem lần trước đã được áp dụng chưa; server trả lời "đã áp dụng", "chắc chắn chưa" hoặc **"không rõ"** (sổ yêu cầu của server chỉ nhớ 100 lần ghi gần nhất, hoặc lần ghi đó kết thúc bằng lỗi `flush` / lỗi ghi nhật ký). Một lần khôi phục sao lưu (`replace`) hay lệnh xóa **chỉ được gửi lại khi server đã cam kết lần trước sẽ không bao giờ được áp dụng**: app hỏi kèm `fence`, server ghi một "bia mộ" cho mã yêu cầu đó (`cancelled`) rồi trả `fenced: true`, và một bản của yêu cầu ấy còn đang trên đường (mạng, hàng đợi khóa của Apps Script) hoặc bị app bỏ vì hết thời gian chờ mà tới muộn sẽ bị **từ chối** (`request-cancelled`) nên không thể ghi đè hay xóa lại dữ liệu máy khác ghi sau đó. Chỉ "chưa áp dụng tới lúc kiểm tra" thì không đủ. Mỗi lệnh thay thế / xóa còn ghi revision và epoch mà máy đã thấy (`baseRevision`, `baseEpoch`); server từ chối (`request-stale`) lệnh dựa trên một view mà sổ không còn bảo chứng được (khác epoch, hoặc các mục có thể chứa bia mộ đã bị đẩy khỏi sổ), khi đó app gộp dữ liệu thay vì ghi đè và hiện khung cảnh báo. Mọi request tới Apps Script có **hạn chờ 90 giây**: hết hạn thì app bỏ chờ (không còn kẹt cả đồng bộ), giữ bản ghi inflight và hỏi lại như khi mất phản hồi; hết hạn không có nghĩa là request chưa tới server. Khi "không rõ" (kể cả khi server là bản `Code.gs` cũ chưa biết trả lời), app **không gửi lại** mà gộp dữ liệu trên máy với Sheet và báo bằng thông báo màu vàng: lần thay thế biến thành gộp (dòng định bỏ có thể quay lại, hãy làm lại nếu cần), lệnh xóa không được gửi lại (giao dịch còn trên Sheet sẽ quay về máy). Sổ yêu cầu có "epoch": nếu Script Properties bị xóa hay làm hỏng thì sổ mới có epoch khác và mọi câu hỏi về lần ghi cũ đều thành "không rõ" (không bao giờ bị hiểu là "chắc chắn chưa"). Nhờ vậy không có trường hợp nào một lệnh thay thế / xóa đã áp dụng bị gửi lại đè lên dữ liệu máy khác vừa ghi. **Đổi URL Web App** khi còn lần thay thế / lệnh xóa chưa được Sheet cũ xác nhận thì chúng **không bao giờ** được gửi sang Sheet mới: dữ liệu trên máy được gộp với Sheet mới. Lệnh xóa làm **trước khi kết nối** một Sheet cũng không được áp dụng lên dòng có sẵn của Sheet đó (dòng ấy quay về máy), và phản hồi của một lần gửi tới Sheet cũ mà đến muộn, sau khi bạn đã đổi sang Sheet khác, bị bỏ qua. Trên **cùng một Sheet**, app chỉ có **một** request trả về trạng thái Sheet (đọc, gửi thay đổi, hỏi `appliedCheck`) đang chạy tại một thời điểm: request sau chỉ được gửi khi phản hồi của request trước đã được áp dụng. Lý do: thứ tự server xử lý các request chồng nhau không phải thứ tự app gửi (độ trễ mạng, chờ khóa `LockService`, lịch chạy của Apps Script), nên một snapshot đến sau có thể là bản **cũ hơn** và làm giao dịch vừa đồng bộ bị coi là đã xóa trên Sheet. Đổi lại, nếu một request mãi không có phản hồi thì các thao tác sau chờ cho tới khi trình duyệt bỏ nó (thay đổi vẫn được giữ trong hàng chờ, không mất); đổi URL Web App thì không phải chờ Sheet cũ. Phản hồi của một lần gửi chỉ xác nhận đúng thứ nằm trong lần gửi đó, không hủy một lần khôi phục sao lưu hay "Xóa toàn bộ dữ liệu" mà bạn vừa làm trong lúc nó còn đang chạy. Nếu máy tắt hoặc bộ nhớ trình duyệt lỗi đúng lúc vừa nhận xác nhận của Sheet, lần mở sau app **hỏi lại Sheet** về lần gửi đó (không gửi lại lệnh thay thế / xóa bằng một mã mới) rồi mới dọn nốt hàng chờ. Mọi trường hợp app cố ý không gửi một thay đổi như vậy đều hiện khung vàng **"Cần xem lại việc đồng bộ"** ngay dưới tiêu đề trang, nằm lại qua lần tải lại cho tới khi bạn bấm **Đã xem** (khôi phục sao lưu trên máy chưa có URL, nơi app lấy URL trong file theo đúng sự đồng ý của bạn, không bị coi là đổi URL). Lỗi `flush` sau khi ghi được báo là **"Không chắc dữ liệu đã được ghi xong"**. Lưu ý: sau khi khôi phục sao lưu ở một máy, các máy khác sẽ thấy Sheet "thiếu" giao dịch cũ và hỏi; nếu việc khôi phục là cố ý thì chọn **Xóa trên máy** ở các máy đó. Đọc dữ liệu cũng giữ khóa (`LockService`) nên không bao giờ thấy Sheet đang ghi dở. Trước khi xóa dữ liệu cũ, script kiểm tra mọi ô ≤ 50.000 ký tự và thêm hàng / cột cho đủ chỗ ghi; nếu lần ghi vẫn lỗi thì đặt lại các dòng cũ rồi mới báo lỗi, nên một lần ghi lỗi không để lại Sheet trống. Ghi chú giao dịch tối đa 2.000 ký tự.
- **Sau khi cập nhật `Code.gs` phải deploy lại** (Manage deployments > Edit > New version) và kiểm tra lại: Script properties có `FM_TOKEN`, không có `FM_ALLOW_OPEN`; mở `<URL>/exec?v=2` trong cửa sổ ẩn danh phải ra `unauthorized`. Hãy deploy `Code.gs` **trước**, rồi mới tải lại app trên các máy: app mới chạy với `Code.gs` cũ vẫn an toàn (không bao giờ gửi lại lệnh thay thế / xóa khi mất phản hồi, vì `Code.gs` cũ không hứa được `fenced`) nhưng sẽ gộp thay vì ghi đè; tuy nhiên chỉ `Code.gs` mới mới chặn được một bản lệnh thay thế / xóa tới muộn, nên cần deploy lại. Script Property `FM_REQUEST_LOG` do `Code.gs` tự tạo (sổ yêu cầu): đừng xóa hay sửa tay.
- Phản hồi của Sheet chỉ xác nhận (và dọn khỏi hàng chờ) đúng nội dung **đã gửi**: mỗi giao dịch và mỗi mục cấu hình trong một request có một vân tay nội dung. Nếu bạn sửa lại ngay sau khi gửi, kể cả trong cùng một mili-giây (dấu thời gian trùng nhau), thay đổi mới vẫn nằm trong hàng chờ, được gửi ở lần sau và không bị dữ liệu cũ từ Sheet ghi đè.
- Khôi phục sao lưu hoặc "Xóa toàn bộ dữ liệu" thay thế hẳn nội dung Sheet. Khôi phục **giữ nguyên URL Web App đang dùng của máy**; máy chưa có URL chỉ lấy URL trong file khi đó là URL `https://script.google.com/.../exec` và người dùng đồng ý (hộp hỏi ghi rõ URL), nên một file sao lưu lạ không đẩy được dữ liệu đi nơi khác.
- Với v2, nếu sửa một giao dịch trên máy này trong khi máy khác xóa nó thì bản sửa được giữ lại.

Lưu ý: script cũ (legacy) và Code.gs bật `FM_ALLOW_OPEN` thì ai có URL Web App đều đọc / ghi được dữ liệu (Cài đặt hiện cảnh báo khi server v2 đang mở); hãy coi URL như mật khẩu và đừng commit nó vào repo (file sao lưu cũng chứa URL này, nhưng không chứa mã bảo vệ).

## Triển khai và cách ly dữ liệu

Dữ liệu thu chi, URL Web App và mã bảo vệ (`FM_TOKEN`) nằm trong `localStorage` của trình duyệt. `localStorage` thuộc về **origin** (giao thức + tên miền + cổng), **không** theo thư mục hay repository. Với GitHub Pages dạng `https://<tài khoản>.github.io/quan-ly-thu-chi/`, mọi trang khác trên `https://<tài khoản>.github.io` (repo khác bật Pages, trang `<tài khoản>.github.io`) có **cùng origin**: script chạy ở một trang như vậy (do lỗi XSS, thư viện bên thứ ba bị cấy mã, hay nội dung không tin cậy) đọc được dữ liệu và mã bảo vệ của ứng dụng này rồi dùng mã đó gọi Apps Script. Mã nguồn công khai không làm lộ mã bảo vệ; vấn đề chỉ nằm ở việc dùng chung origin. Cài đặt hiện một dòng nhắc khi app chạy ở địa chỉ `*.github.io`.

Cách xử lý, từ tốt nhất:

1. **Origin riêng cho app này**: tên miền riêng (Settings > Pages > Custom domain, ví dụ `thuchi.<tên miền của bạn>`), hoặc đặt repo trong một tài khoản / tổ chức GitHub chỉ chứa app này (khi đó `<tài khoản mới>.github.io` không có trang nào khác).
2. Nếu giữ chung origin: không bật Pages cho repo khác của tài khoản, không để trang chạy nội dung hay thư viện bên ngoài mà bạn không kiểm soát trên cùng tên miền.
3. Mã bảo vệ chỉ bảo vệ URL Web App; nó không mã hóa dữ liệu đang nằm trong `localStorage` của máy.

Chuyển repo sang **Private không giải quyết** vấn đề origin (nó chỉ giới hạn ai xem được mã nguồn / trang).

**Chuyển sang origin mới** (dữ liệu không tự chuyển theo, vì `localStorage` là của origin cũ):

1. Ở địa chỉ cũ: Cài đặt > **Sao lưu** (file JSON, không chứa mã bảo vệ).
2. Mở địa chỉ mới, **Khôi phục** file sao lưu, nhập lại URL Web App và mã bảo vệ.
3. Xóa dữ liệu của địa chỉ cũ bằng chức năng xóa dữ liệu trang của trình duyệt. **Đừng** dùng "Xóa toàn bộ dữ liệu" trong app khi còn đồng bộ: nó thay toàn bộ Sheet bằng dữ liệu trống.

**Kiểm tra nhanh** (không dùng mã bảo vệ thật): ở trang app chạy `localStorage.setItem('thu_origin', '1')` trong Console, mở một trang khác của cùng tài khoản rồi chạy `localStorage.getItem('thu_origin')`: ra `'1'` nghĩa là hai trang dùng chung bộ nhớ. Xong chạy `localStorage.removeItem('thu_origin')`.
