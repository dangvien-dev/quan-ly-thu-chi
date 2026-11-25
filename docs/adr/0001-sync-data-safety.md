# ADR 0001: An toàn dữ liệu khi đồng bộ với Google Sheets

- **Trạng thái:** đề xuất, chờ chủ repo duyệt
- **Ngày:** 22/11/2026
- **Phạm vi:** `js/sync.js`, `js/utils.js` (`isMassRemoteLoss`, `nextStamp`, `fingerprintOf`), `apps-script/Code.gs`
- **Phụ thuộc:** các cơ chế dưới đây nằm trong PR #33 (đồng bộ an toàn dữ liệu). Merge PR này sau PR #33.

## Bối cảnh

App web tĩnh giữ dữ liệu trong `localStorage` của từng thiết bị và đồng bộ qua một Google Sheet bằng Apps Script (`Code.gs`, giao thức v2). Không có server riêng, không có transaction, hai thiết bị cùng sửa được, và mạng hay trình duyệt có thể ngắt bất cứ lúc nào.

18 vòng review của PR #33 cho thấy lỗi không nằm ở một chỗ mà ở các giả định ngầm ("không thấy" nghĩa là "chưa xảy ra", dấu thời gian là bằng chứng duy nhất, một phản hồi nào đó là phản hồi mới nhất). ADR này ghi các giả định đó thành quyết định, mỗi mục kèm bất biến, phản ví dụ đã gặp, nơi thực thi và test, để lần sửa sau không phải đoán. Ma trận tình huống chi tiết (thao tác × sự cố) nằm ở `docs/review-lessons.md`.

## Quyết định

### 1. Nguồn sự thật

- **Không có một nguồn duy nhất.** Mỗi máy giữ bản làm việc ở `localStorage`; Sheet là nơi chung duy nhất. Hai bên được **gộp** theo `updatedAt` (bản mới hơn thắng), không bên nào mặc định ghi đè bên kia.
- Máy chỉ ghi lên Sheet **sau khi đã đọc và nhận diện** giao thức của nó trong phiên đó (`GET ?v=2`; cờ `remoteReady`).
- Ngoại lệ có chủ đích: **Khôi phục sao lưu** và **Xóa toàn bộ dữ liệu** là `replace`, máy thay hẳn Sheet.

| Bất biến                                           | Phản ví dụ đã gặp                                                                                            | Thực thi                                     | Test                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Không ghi trước khi đọc và nhận diện giao thức     | Bản đầu của PR #3 gửi `{"action":"save"}`, thứ script cũ coi là yêu cầu lạ và xóa Sheet (bài học 28/10/2026) | `js/sync.js` (`remoteReady`)                 | `tests/e2e/sync-v2.spec.js` nhóm "lần đầu kết nối"; `tests/e2e/sync.spec.js` "mọi lần ghi trong một phiên … đều là {transactions}" |
| Token không bao giờ nằm trong URL, kể cả khi retry | Khi POST lỗi, `GET ?action=sync&payload=` mang token trong URL (SEC-002)                                     | `postSyncV2` không có đường GET khi có token | `sync-v2.spec.js`: "SEC-002: POST lỗi mạng khi có token thì không dùng GET dự phòng …"                                             |

### 2. Hàng chờ gửi (outbox) và thứ tự ghi `localStorage`

- Thay đổi chưa được Sheet xác nhận nằm trong hàng chờ: `fm_pending_upserts`, `fm_deleted_ids`, `fm_pending_meta`, cờ `fm_sync_dirty` (`merge` hoặc `replace`) và `fm_sync_replace_seq`. Một request đã gửi mà chưa có phản hồi có bản ghi `fm_sync_inflight`.
- `localStorage` không có transaction qua nhiều khóa, nên **thứ tự là bất biến**: ghi baseline, dọn hàng chờ (`clearSentPending`), rồi xóa `fm_sync_inflight` **cuối cùng**. Crash ở giữa chỉ để lại một bản ghi sẽ được hỏi lại; mọi bước chạy lại được.
- Một phản hồi chỉ xác nhận thứ nằm trong request của nó: bằng `replaceSeq`, và bằng việc so **dấu thời gian trước, rồi vân tay SHA-256** của từng bản ghi (`editedSince`, `fingerprintOf`).
- Chỉ **một** request trả về trạng thái Sheet được bay tại một thời điểm (`inSyncLane`); thứ tự server xử lý các request chồng nhau không phải thứ tự gửi. Mọi `fetch` tới Web App có hạn chờ 90 giây (`fetchSheet`), hết hạn không có nghĩa là chưa tới server.

| Bất biến                                                     | Phản ví dụ đã gặp                                                                    | Thực thi                                                | Test                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------- |
| Bản ghi inflight bị xóa cuối cùng                            | Xóa inflight trước khi dọn hàng chờ, crash giữa chừng thì gửi lại `replace` (vòng 9) | `pushV2`, `settleInflightV2`, `secureUnconfirmedWrites` | `sync-v2.spec.js` "review vòng 9" (`failStorageOnce`)    |
| Một ACK chỉ dọn thứ còn giống hệt nội dung đã gửi            | ACK xóa nhầm lần sửa thứ hai; vân tay FNV-32 va chạm (vòng 12, 14)                   | `clearSentPending`, `editedSince`                       | "review vòng 12", "review vòng 14", unit `fingerprintOf` |
| Một request trả về snapshot tại một thời điểm, trong một tab | Snapshot cũ về sau ghi đè dữ liệu mới, `TX_D` bị coi là đã xóa (vòng 8, 10)          | `inSyncLane`                                            | "review vòng 10"                                         |

### 3. Mã yêu cầu, kết quả "không rõ" và fence

- Mỗi lần ghi mang `requestId`; server không áp dụng lại cùng một mã. Sổ `FM_REQUEST_LOG` (Script Property, tối đa 100 mục, có `epoch`) nhớ các mã đã thấy.
- Khi mất phản hồi, app hỏi `appliedCheck` và nhận `true`, `false` hoặc `'unknown'`. Mục sổ được ghi `uncertain` **trước** khi chạm Sheet và chỉ thành `ok` sau `flush`, nên lỗi giữa chừng không bao giờ giống "chưa chạy".
- `replace` và `deletes` **chỉ được gửi lại khi server đã cam kết** (`applied: false` kèm `fenced: true`): server ghi một bia mộ `cancelled` cho mã đó, nên một bản còn trên đường tới muộn bị từ chối (`request-cancelled`). Thiếu cam kết (kể cả `Code.gs` cũ) thì **gộp** dữ liệu hai bên, không ghi đè, và hiện khung "Cần xem lại việc đồng bộ".
- `replace` và `deletes` còn nêu `baseRevision` và `baseEpoch` máy đã thấy; server từ chối (`request-stale`) khi không còn bảo chứng được view đó.
- Upsert thuần được gửi lại thoải mái vì idempotent theo `updatedAt`.

| Bất biến                                                     | Phản ví dụ đã gặp                                                                    | Thực thi                                                                | Test                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| "Không thấy trong sổ" không bao giờ được hiểu là "chưa chạy" | Sổ chỉ nhớ 50 mã; sổ bị xóa nên `appliedAfter = 0` cho `false` sai (vòng 5, 6)       | `Code.gs` `appliedCheck`, `epoch`, `uncertainFlush_`, `readRequestLog_` | `tests/gas/code.test.js`, e2e "review vòng 5", "review vòng 6" |
| Lệnh phá hủy chỉ gửi lại khi đã có cam kết `fenced`          | `replace` tới muộn sau khi đã gửi lại, xóa dữ liệu máy khác ghi xen (vòng 11)        | `cancelRequest_`, `destructiveBaseOk_`, `abandonDestructiveWrite`       | `code.test.js` các test "bia mộ", e2e "review vòng 11"         |
| Lệnh phá hủy chưa xác nhận không bao giờ sang Sheet khác     | Đổi URL Web App còn `replace` đang chờ (vòng 6); phản hồi muộn của Sheet cũ (vòng 7) | `secureUnconfirmedWrites`, `syncGeneration`                             | e2e "review vòng 6", "review vòng 7"                           |

### 4. Khi nào được xóa dữ liệu

- **Máy xóa giao dịch cục bộ vì Sheet thiếu chúng** chỉ trong hai trường hợp: (a) vài dòng, dưới ngưỡng `isMassRemoteLoss` (Sheet trống, thiếu quá nửa số dòng đã đồng bộ, hoặc thiếu từ 20 dòng một lúc): áp dụng không hỏi; (b) vượt ngưỡng: hỏi (`decideRemoteLoss`) với ba lựa chọn Khôi phục / Xóa trên máy / Để sau. Đóng hộp thoại hay Esc là "Để sau", **không bao giờ xóa**.
- **Lệnh xóa làm trước khi kết nối một Sheet** không có thẩm quyền lên những gì Sheet đang có (`giveUpDeletesAtFirstContact`).
- **Server chỉ làm trống Sheet khi yêu cầu có `confirmWipe`** (v2 `replace` rỗng, v2 `deletes` xóa hết các dòng, `POST {transactions: []}`, `?action=save&data=[]`). Client chỉ gửi cờ khi máy không còn giao dịch nào (`js/sync.js`: `transactions.length === 0 && (replace || deletes.length > 0)`).
- Mỗi yêu cầu được **kiểm tra toàn bộ trước khi ghi** (`validateSyncBody_`, `planTransactionChanges_`, `planMetaChanges_`, kiểm tra độ dài ô và `ensureSize_`). Phần ghi là best effort có rollback (`replaceDataRows_`); rollback thất bại thì báo rõ, không im lặng.
- **Giới hạn:** Sheet không có bia mộ cho giao dịch (issue #26), nên "xóa có chủ đích ở máy khác" và "mất do lỗi" chỉ phân biệt được bằng số lượng. Một lần xóa hợp lệ từ 20 dòng trở lên (ví dụ "Hoàn tác lần nhập") cũng bị hỏi.

| Bất biến                                       | Phản ví dụ đã gặp                                                     | Thực thi                                                       | Test                                                                         |
| ---------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Sheet trống không xóa dữ liệu máy mà không hỏi | Một Sheet bị làm trống làm mọi máy đã đồng bộ mất sạch (SEC-001)      | `isMassRemoteLoss`, `decideRemoteLoss`                         | unit `isMassRemoteLoss`; e2e "SEC-001: tập nhỏ mất quá nửa (6 → 1) cũng hỏi" |
| Không làm trống Sheet khi thiếu `confirmWipe`  | `deletes` xóa hết dòng; `{transactions: []}` của đường cũ (vòng 1, 2) | `Code.gs` `replaceAllTransactions_`, `planTransactionChanges_` | `tests/gas/code.test.js`                                                     |
| Kiểm tra xong mới ghi                          | `clearContent()` rồi ghi vượt số hàng, Sheet trống (SEC-005)          | `Code.gs` `ensureSize_`, `replaceDataRows_`                    | `tests/gas/code.test.js` (fault injection)                                   |

### 5. Ý nghĩa của `updatedAt`

- Là chuỗi ISO (mili-giây) theo **đồng hồ của máy sửa**. Server giữ bản có `updatedAt` lớn hơn (so chuỗi); **bằng nhau thì bản tới sau thắng** (`>=` trong `planTransactionChanges_` và `planMetaChanges_`).
- Mỗi lần sửa một bản ghi có dấu lớn hơn hẳn dấu trước của chính nó (`nextStamp`), kể cả khi đồng hồ không nhích hoặc bị chỉnh lùi. Bảo đảm này chỉ có cho **một bản ghi trên một thiết bị**.
- Nó **không phải đồng hồ nhân quả**: hai thiết bị lệch đồng hồ có thể để một bản sửa thật sự cũ hơn thắng; cùng mili-giây thì hòa.
- `deletes` không so `updatedAt`, và trong một request chúng chạy trước `upserts`. Xóa và sửa cùng một dòng từ hai máy vì thế **phụ thuộc thứ tự tới server**: xóa tới trước, sửa tới sau thì dòng được tạo lại với bản sửa; sửa tới trước, xóa tới sau thì dòng mất (đọc từ `planTransactionChanges_`; SEC-003 và issue #26).
- Vân tay nội dung (`fingerprintOf`) chỉ là bằng chứng "chưa đổi" cho ACK, không dùng để giải quyết xung đột.

### 6. Giới hạn đã biết (không phải lỗi mới của PR #33)

| Giới hạn                                                                                                                                                                                                                                   | Hậu quả                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nhiều tab cùng một trình duyệt.** Các tab dùng chung `localStorage` (hàng chờ, cờ `replace`, inflight) nhưng mỗi tab giữ dữ liệu trong bộ nhớ riêng và có `inSyncLane` riêng; chưa có `storage` event, khóa liên tab hay leader election | Hai tab cùng đồng bộ có thể gửi trùng (upsert vẫn idempotent) và thấy snapshot của nhau không theo thứ tự, tức mất bảo đảm của `inSyncLane`. Hậu quả dữ liệu chưa được đo |
| **Hai thiết bị cùng sửa một dòng** (mục 5)                                                                                                                                                                                                 | Last-write-wins theo đồng hồ máy; xóa và sửa phụ thuộc thứ tự tới server                                                                                                  |
| **`Code.gs` cũ hoặc client cũ**                                                                                                                                                                                                            | Không có fence, nên một lệnh `replace` / `deletes` tới muộn vẫn được áp dụng. Phải deploy `Code.gs` mới trước rồi tải lại app trên các máy                                |
| **Sheet không có ACID**; `localStorage` không có transaction qua nhiều khóa                                                                                                                                                                | An toàn dựa vào thứ tự ghi và phục hồi best effort. Test crash giả lập, không phải crash thật của tab hay quota thật                                                      |
| **Origin GitHub Pages dùng chung** (README, "Triển khai và cách ly dữ liệu")                                                                                                                                                               | Mã bảo vệ và dữ liệu nằm trong `localStorage` của origin; cảnh báo trong app không phải là cách ly                                                                        |
| **Chỉ kiểm chứng trên Sheet giả (mock)**                                                                                                                                                                                                   | Quota, timeout, giới hạn 9 KB của một Script Property và thứ tự xử lý request chồng nhau trên Google thật chưa được đo                                                    |

### 7. RPO và RTO (hiện trạng, chưa phải cam kết)

- **Mất ở đâu:** thay đổi chưa được Sheet xác nhận chỉ nằm trong `localStorage` của máy đó. Mất thiết bị hoặc xóa dữ liệu trình duyệt trước khi đồng bộ thì mất đúng phần đó. Nhãn "Đã lưu" nghĩa là Sheet đã xác nhận; "Chờ xử lý (N)" hoặc lỗi nghĩa là chưa.
- **Điểm khôi phục:** Nhật ký phiên bản (Version history) của Google Sheet, và file sao lưu JSON do người dùng tự bấm ở Cài đặt (không tự động, không chứa `FM_TOKEN`). Việc khôi phục từ Nhật ký phiên bản trên Sheet thật **chưa được thử** (`NOT_TESTED`).
- **Thời gian khôi phục:** hoàn toàn thủ công (chọn phiên bản trong Nhật ký, hoặc Khôi phục file sao lưu, tức một `replace`). Chưa có số đo thực tế; nên ghi lại thời gian thật sau lần smoke test trên bản sao Sheet.
- **Điều cần làm:** sao lưu thủ công trước mỗi lần nâng cấp `Code.gs` hoặc khôi phục dữ liệu; chụp lại dữ liệu trước và sau khi thử.

## Hậu quả

- Mọi chỗ gọi `fetch` mới trả về trạng thái Sheet phải nằm trong `inSyncLane` và đi qua `fetchSheet`.
- Mọi chỗ **sửa** một bản ghi đã có dấu thời gian phải dùng `nextStamp`.
- Một cơ chế bảo vệ mới phải đi kèm: bất biến, phản ví dụ, nơi thực thi, test đỏ khi bỏ nó (kiểm tra đột biến) và một ô trong ma trận ở `docs/review-lessons.md`.
- Khi đổi một mục trong ADR này, cập nhật README ("Quy tắc đồng bộ") và `CLAUDE.md` cho khớp.

## Chưa quyết định hoặc chưa làm

- **Nhiều tab:** hướng khả dĩ là Web Locks API (`navigator.locks`) bao quanh `inSyncLane`, hoặc `storage` event cộng leader election. Chưa chọn. Trong lúc đó README hướng dẫn chỉ mở một tab.
- **Bia mộ cho giao dịch và gộp meta theo từng phần tử:** issue #26 (gồm SEC-003, SEC-004).
- **Smoke test trên bản sao Sheet thật** và đo RPO / RTO: chủ repo làm theo README, mục "Nâng cấp và thử trên Sheet thử nghiệm…".
- **Origin riêng** (tên miền riêng): quyết định triển khai của chủ repo.
