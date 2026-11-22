# Bài học từ lỗi và review (đồng bộ dữ liệu)

File này là "bộ nhớ học được" của dự án: mỗi lần phát hiện lỗi hoặc xử lý một vòng review, **đọc nó trước** và **cập nhật nó sau**. Hook `.claude/hooks/review-lessons.js` tự nhắc việc này khi lời nhắn của chủ repo nhắc tới review (`RV vòng N`) hoặc lỗi / bug / sự cố. Giữ ngắn, ghi sự thật đã kiểm chứng; chi tiết thiết kế nằm ở `CLAUDE.md` và `js/sync.js`.

## Quy trình sau mỗi lần phát hiện lỗi

1. **Tái hiện trước**: viết test đỏ trên bản chưa sửa (kịch bản đúng như mô tả, không phải bản gần giống). Chưa đỏ được thì chưa hiểu lỗi.
2. **Sửa cả họ lỗi, không chỉ chỗ được nêu**: tìm mọi chỗ cùng mẫu (`grep` các điểm `fetch`, các chỗ xóa bằng chứng, các chỗ áp dụng phản hồi) và đối chiếu với bảng "Họ lỗi" dưới đây. Mỗi vòng review 5–11 đều là một biến thể mới của cùng vài họ.
3. **Kiểm tra đột biến**: phá từng cơ chế vừa thêm (bỏ guard, đảo thứ tự bước); mỗi lần phải có ít nhất một test đỏ. Test vẫn xanh nghĩa là test yếu: thêm test rồi mới coi là xong.
4. **Ghi bài học**: thêm biến thể vào họ lỗi (hoặc họ mới), cập nhật bất biến nếu đổi, điền ô ma trận kèm tên nhóm test. Chỉ sửa `CLAUDE.md` khi quy ước thay đổi.
5. **Báo cáo trung thực**: nói rõ đã kiểm chứng gì (test, đột biến) và chưa kiểm chứng gì (Google Sheets thật, nhiều tab, crash thật của trình duyệt). Không merge, không deploy khi chưa được bảo.

## Họ lỗi đã gặp

| Họ                                                                 | Biến thể đã gặp (vòng)                                                                                                                                                                                                                                        | Bất biến rút ra                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kết quả cũ / của ngữ cảnh khác bị áp dụng như thể mới**          | phản hồi của Sheet cũ sau khi đổi URL (7); ack của request cũ hủy ý định `replace` mới (8); snapshot cũ ghi đè dữ liệu vừa đồng bộ (8); snapshot xếp theo thứ tự gửi chứ không theo thứ tự server đọc (10); `revision` / `epoch` nhớ từ snapshot bị bác (9)   | Mỗi phản hồi chỉ áp dụng khi thuộc kết nối hiện tại, và request sau chỉ gửi khi phản hồi trước đã áp dụng (`inSyncLane`). Một ack chỉ xác nhận thứ nằm trong request.                                                                                      |
| **"Không thấy" bị hiểu thành "chưa xảy ra"**                       | `applied: false` khi sổ chỉ nhớ 50 mã (5); sổ bị xóa cho `false` với `appliedAfter = 0` (6); flush lỗi sau khi đã ghi (5)                                                                                                                                     | Chỉ khẳng định "chưa chạy" khi chứng minh được; còn lại là `'unknown'`, và `'unknown'` không bao giờ gửi lại `replace` / `deletes`.                                                                                                                        |
| **Hành động phá hủy dựa trên ý định cũ hoặc của ngữ cảnh khác**    | gửi lại `replace` / lệnh xóa đã áp dụng (4); `replace` đi sang Sheet mới sau khi đổi URL (6); lệnh xóa làm trước khi kết nối xóa dữ liệu có sẵn của Sheet (7); gửi lại bằng `requestId` mới sau crash (9)                                                     | Lệnh phá hủy chỉ đi khi chắc chắn lần trước chưa áp dụng và thuộc đúng Sheet; nếu không thì gộp, không xóa.                                                                                                                                                |
| **Bằng chứng về request đã gửi bị xóa trước khi hậu quả được dọn** | xóa `fm_sync_inflight` trước `clearSentPending` (9); xóa bản ghi rồi mới bỏ ý định khi đổi URL (9); cờ `fm_sync_dirty` đổi bằng hai lần ghi (9)                                                                                                               | Bằng chứng (`fm_sync_inflight`) xóa **cuối cùng**; mọi bước dọn chạy lại được; một trạng thái đổi bằng một lần ghi.                                                                                                                                        |
| **Ghi trước, kiểm tra sau (server)**                               | xóa Sheet rồi mới ghi, ghi vượt số hàng (1); ghi một phần giữa `Transactions` và `Meta` (2); `null` / sai kiểu bị coi là rỗng (3, 4); rollback nuốt lỗi (3)                                                                                                   | Server kiểm tra toàn bộ payload trước khi chạm vào Sheet; thất bại phải nói rõ, không âm thầm bỏ dòng.                                                                                                                                                     |
| **Quan sát tại một thời điểm bị dùng như cam kết cho tương lai**   | `applied: false` ("chưa thấy lúc kiểm tra") bị coi là "request sẽ không bao giờ tới", nên gửi lại `replace` / lệnh xóa dưới mã mới; bản cũ tới muộn áp dụng lần nữa và xóa dữ liệu máy khác (11); hết thời gian chờ ở client bị coi là "chưa tới server" (11) | Chỉ hành động trên một "không" khi nó là **cam kết** (`appliedCheck` kèm `fence`: server ghi bia mộ, request tới muộn bị từ chối) hoặc hành động đó idempotent; lệnh phá hủy mang `baseRevision` / `baseEpoch` để server từ chối khi không bảo chứng được. |
| **Giả định môi trường chưa kiểm chứng**                            | `localStorage` thuộc về origin, không theo thư mục repo (10)                                                                                                                                                                                                  | Ghi rõ điều kiện triển khai; điều không kiểm chứng được từ sandbox thì nói là chưa kiểm chứng và nhờ chủ repo xác nhận.                                                                                                                                    |

## Bất biến của đồng bộ (đừng phá)

1. Không ghi lên server trước khi đã đọc và nhận diện giao thức; token không bao giờ nằm trong URL.
2. Mọi request mà phản hồi là trạng thái Sheet chạy qua `inSyncLane` (một lần một request). Chỗ gọi `fetch` mới trả về trạng thái phải nằm trong làn.
3. `replace` và `deletes` không bao giờ tự gửi lại khi kết quả lần trước là `'unknown'`; đổi URL không mang chúng sang Sheet mới.
4. `fm_sync_inflight` bị xóa cuối cùng; `clearSentPending` chỉ xác nhận thứ nằm trong request của nó (`replaceSeq`).
5. Sheet trống hay mất hàng loạt không xóa dữ liệu máy mà không hỏi; đóng hộp thoại không bao giờ xóa.
6. Server kiểm tra toàn bộ trước khi ghi; yêu cầu làm trống Sheet cần `confirmWipe`.
7. Mỗi cơ chế bảo vệ có một test đỏ khi bỏ nó (đã kiểm tra bằng đột biến).
8. `replace` / `deletes` chỉ được gửi lại khi server trả `applied: false` **và** `fenced: true`; thiếu `fenced` (`Code.gs` cũ) thì gộp. Mọi `fetch` tới Web App có hạn chờ (`fetchSheet`); bỏ chờ phía client không có nghĩa là request chưa tới server.

## Ma trận tình huống (thao tác × sự cố) và test đã có

Tên nhóm test nằm trong `tests/e2e/sync-v2.spec.js` ("review vòng N") và `tests/gas/code.test.js`. "chưa" nghĩa là chưa có test hoặc không thể có.

- **Đọc**: phản hồi chậm (10), server chưa xử lý (10, `state.deferReads`), hai lần đọc gần nhau (10), máy khác ghi xen giữa (10).
- **Đẩy upsert**: mất phản hồi, kể cả `Code.gs` cũ không trả `applied` (5); chậm (7, 10); chờ sau lần đọc (10); lỗi `localStorage` ngay sau ACK (9).
- **`replace` (khôi phục sao lưu, xóa toàn bộ)**: mất phản hồi và máy khác ghi xen giữa (4); server quên sổ, flush lỗi, chưa từng tới server (5, 6); lần thứ hai khi lần một chưa rõ (8); ack của lần ghi cũ (8); lỗi `localStorage` (9).
- **`deletes`**: mất phản hồi (4); `'unknown'` (5); lệnh xóa ở lần tiếp xúc đầu (7); lỗi `localStorage` (9).
- **Request tới muộn sau `appliedCheck = false`** (client được báo lỗi nhưng request vẫn tới sau): `replace` và lệnh xóa bị từ chối, dữ liệu máy khác còn nguyên (11, `state.lateWrites` / `arriveLate`); bia mộ bị đẩy khỏi sổ vẫn bị từ chối bằng `floor` (11, `tests/gas/code.test.js`); `Code.gs` cũ không `fenced` thì không gửi lại (11, `withoutFence`); view quá cũ bị từ chối (11).
- **Hết thời gian chờ**: lần đọc treo giải phóng làn (11); lần ghi treo không đi đường GET dự phòng (v2 và legacy), inflight còn và gửi lại bằng POST (11); `replace` treo rồi tới muộn (11).
- **Đổi URL**: có / không có bản ghi inflight, bật Sheet lần đầu (6); phản hồi muộn của Sheet cũ (7); lần đọc của Sheet cũ không bao giờ trả lời, lần đẩy xếp hàng của kết nối cũ (10); lỗi `localStorage` (9).
- **Legacy (script cũ, không có `requestId`)**: phản hồi muộn và thứ tự (7, 8, 10). Mất phản hồi và crash giữa các bước: **chưa** (không có cách hỏi lại, giới hạn đã biết).
- **Chưa có / không thể có**: hạn chờ khi server đã trả header rồi treo phần body (chưa mô phỏng); bản lệnh phá hủy tới muộn trên `Code.gs` cũ (không chặn được); nhiều tab cùng trình duyệt (chưa hỗ trợ); crash thật của tab (test dùng `Storage.prototype` bị ghi đè); đổi cờ `fm_sync_dirty` bằng một lần ghi (không quan sát được từ ngoài); Google Sheets / Apps Script thật (mock không chứng minh được); origin dùng chung của GitHub Pages (URL thật đã được chủ repo xác nhận 22/11/2026: `https://dangvien-dev.github.io/quan-ly-thu-chi/`; chỉ có thêm một site cùng origin là trang gốc `dangvien-dev.github.io`, đã đọc tĩnh ở commit `e4f2569`: không có nguồn ngoài, id từ URL được escape, rủi ro thấp; phải xem lại khi trang gốc đổi hoặc có site thứ ba).

## Câu hỏi tự hỏi khi viết hoặc sửa code đồng bộ

- Phản hồi này có thuộc đúng kết nối và đúng ý định hiện tại không? Có cũ hơn thứ đã áp dụng không?
- Nếu máy tắt ở giữa bước này, còn bằng chứng để hỏi lại server không? Mở lại có làm lại được an toàn không?
- Chỗ nào "không thấy" đang được hiểu là "chưa xảy ra", hay "không có" là "đã xóa"?
- Hành động phá hủy này dựa trên ý định nào, từ lúc nào, nhắm vào Sheet nào?
- Server có chắc xử lý theo thứ tự client gửi không? (Không.)
- Một "không" đang được dùng để hành động: nó là cam kết (đã chặn cả tương lai) hay chỉ là quan sát lúc này? Request mà client đã bỏ có còn có thể tới sau không?
- Guard này đã có test đỏ khi bỏ nó chưa? Test có đang bị che bởi một quy tắc khác (ví dụ `Math.max`) không?

## Bài học về cách làm

- Kịch bản phải cụ thể (ai gửi gì, server làm gì trước, phản hồi nào về trước) và đo ở phía server (`state.posts`, `state.gets`), không chỉ nhìn giao diện.
- Khi thiết kế đổi làm test cũ không còn xảy ra được, viết lại test cũ với **cùng kịch bản, kỳ vọng mới**, đừng xóa.
- Sửa file bằng `str.replace` luôn `assert` đã tìm thấy: Prettier đổi bố cục nên thay thế có thể âm thầm không làm gì.
- Không đưa token thật vào test, log hay lệnh kiểm tra.
- Phân biệt ba cách mô phỏng: `dropRequests` (không bao giờ tới server), `loseReplies` (tới ngay, mất phản hồi), `lateWrites` (client báo lỗi ngay nhưng tới server sau). Lỗi vòng 11 chỉ lộ ra ở kiểu thứ ba.
- Test "đệm nhiều ghi để đẩy mục khỏi sổ" che mất lỗi biên (đột biến: bia mộ không lấy revision mới vẫn xanh vì đệm đẩy ra quá nhiều mục); dựng đúng biên (mục cần kiểm tra là mục đầu tiên bị đẩy ra) và dùng id đệm **duy nhất** (id lặp bị server coi là gửi lại, không thêm mục nào).

## Mẫu ghi một bài học mới

```text
Họ: <tên họ lỗi, hoặc họ mới>
Vòng / nguồn: <review vòng N, hoặc sự cố ngày ...>
Kịch bản: <ai gửi gì, thứ tự nào, kết quả sai>
Sửa: <cơ chế, file>
Bất biến: <điều không được phá>
Test: <nhóm test, đột biến đã thử>
Chưa kiểm chứng: <điều còn lại>
```
