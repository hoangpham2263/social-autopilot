# Metricool: cách social-autopilot dùng Metricool

Tài liệu chung cho mọi tài khoản Metricool. Không ghi id người dùng, blogId hay email của tài khoản nào: brand của tài khoản đang dùng nằm trong `workspace/metricool-brands.json` (chỉ ở máy, do `sync-brands` ghi; dạng `config/metricool-brands.example.json`). Lệnh và thứ tự: `RUNBOOK.md` Mode 2.

## 1. Đường chính: MCP

| Mục | Giá trị |
|---|---|
| Gói | Gói nào có MCP cũng được (Starter trở lên cho nhiều brand và bài không giới hạn). Không cần REST API |
| Máy chủ | `https://ai.metricool.com/mcp`, qua tool của agent (Node không gọi Metricool) |
| Claude Code | connector claude.ai "Metricool" |
| Codex | `codex mcp add metricool --url https://ai.metricool.com/mcp` rồi `codex mcp login metricool` (hoặc `[mcp_servers.metricool]` với `url` trong `~/.codex/config.toml`) |
| ChatGPT | connector Metricool; chỉ gửi bài từ JSON `payload` người dùng dán |
| Kiểu bài | Luôn **hẹn giờ thật** (`draft: false`, `autoPublish: true`) ở giờ slot của brand; không bao giờ nháp |
| Dự phòng | CSV (`metricool-csv.mjs`, người tự import), mục 4 |

### Tool MCP dùng trong quy trình
- `getBrandSettings`: brand, blogId, múi giờ, mạng đã nối. Bước đầu mỗi lượt Mode 2: lưu JSON trả về ra file → `node scripts/metricool-mcp.mjs sync-brands --from <file>`.
- `createScheduledPost(blogId, date, info)`: tạo bài. `date` = ISO kèm offset; `info` = **chuỗi JSON** (lấy nguyên từ `payload`).
- `getScheduledPosts(brandId, fromDate, toDate, timezone)`: đối chiếu trạng thái (PENDING / ERROR / PUBLISHED); tham số từ `metricool-mcp.mjs status`.
- `getBestTimeToPostByNetwork`: đầu mỗi lượt Create & publish (RUNBOOK 2.0), lưu bằng `metricool-mcp.mjs sync-times`; giờ đăng lấy từ đây (mục 3).
- Không dùng: `createScheduledPostForReview` / `sendScheduledPostForReview` (duyệt bài làm trong app của tool), `updateScheduledPost` (chưa dùng).

### sync-brands
- Ghi tên, blogId, múi giờ, mạng của từng brand vào `workspace/metricool-brands.json`.
- Giữ theo blogId: liên kết skill (`skill_id`, `skill_path`). Brand không còn trong tài khoản: `removed: true`.
- Brand `removed` không bao giờ là đích của `payload`, `record` hay CSV. Brand chưa trỏ skill: không làm bài, không gửi.

### payload → createScheduledPost → record
1. `payload --brand <id> [--posts ...]`: mỗi bài đã duyệt (catalog `approved`) có `media_url`/`video_url`, chưa có `metricool.<network>.id`, qua `check-post.mjs` → một item `{ tool: "createScheduledPost", args: { blogId, date, info }, record }`. Bài không qua kiểm vào `blocked`.
2. Agent gọi `createScheduledPost` với đúng `args` (không sửa `info`), rồi chạy `item.record` với `id`, `uuid`, `plannerUrl`, `publicationDate.dateTime`, `publicationDate.timezone` trả về → catalog `metricool.<network>` + `schedule.<network>`, trạng thái `scheduled`.
3. Bài cũ từng gửi dạng nháp: `payload` gửi lại thành bài hẹn giờ, `record` ghi `replaced_draft` (xoá nháp cũ trong Metricool).

Dạng `info` (ví dụ, giá trị minh hoạ):
```json
{"draft":false,"autoPublish":true,"media":["https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<brand>/2026/11/POST-xx.png"],
 "mediaAltText":["..."],"providers":[{"network":"facebook"}],
 "publicationDate":{"dateTime":"2026-11-17T10:00:00","timezone":"America/Los_Angeles"},"text":"...",
 "facebookData":{"type":"POST"},"shortener":false,"smartLinkData":{"ids":[]},"descendants":[],"firstCommentText":"","hasNotReadNotes":false}
```
Instagram bật thì thêm `instagramData { type: POST|REEL, isAiGenerated: false }`.

### Đã kiểm khi test thật
- `createScheduledPost` trả `id`, `uuid`, `plannerUrl`; Metricool tự đổi `publicationDate` sang múi giờ brand.
- Qua MCP, Metricool **chép media về `static.metricool.com`** (CSV thì không chép, đọc link lúc đăng).
- Hệ quả: múi giờ do Metricool lo khi `publicationDate` mang múi giờ khách (`cadence.timezone`); vẫn chỉ gỡ file host sau khi bài đã đăng.

### Chặn
blogId của brand `removed` và mọi blogId gắn với skill khác; mạng ngoài facebook/instagram (dùng CSV); `language_policy.mode: separate-posts`; giờ đã qua; link không https hoặc WebP; caption có nhãn AI hoặc ký tự ẩn.

## 2. Media
- Metricool cần **link công khai** trỏ thẳng tới file. Tool host media của bài đã duyệt trên repo công khai `social-autopilot-sources`, link raw GitHub `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/...`. Không dùng tên miền riêng.
- Ảnh raw (`image/png`, `image/jpeg`) được Metricool nhận.
- Raw trả `.mp4` là `application/octet-stream`. Preview CSV vẫn nhận ra video theo đuôi `.mp4`; qua MCP, Metricool chép media nên video nên được, nhưng **chưa test đăng thật**. jsDelivr trả 403 cho mp4 lớn, không dùng.
- URL có chuỗi `.webp` (kể cả CDN đổi định dạng qua tham số) bị Metricool báo lỗi: không dùng.
- Facebook REEL bắt buộc video đúng 9:16; không đúng thì dùng POST (video thường). Carousel tối đa 10 ảnh.

## 3. Giờ đăng

### Giờ đăng tự động: mỗi ngày, giờ tốt nhất
Thương hiệu đăng **mỗi ngày**, `cadence.posts_per_day` bài một ngày (mặc định 1; skill cũ chỉ có `posts_per_week` thì lấy `ceil(posts_per_week / 7)`). Không có giờ đặt tay: `cadence.slots` của skill bị bỏ qua. Giờ của từng ngày, ưu tiên theo thứ tự:
1. **Giờ tốt nhất của Metricool cho brand** (dữ liệu khán giả của chính trang): đầu mỗi lượt Create & publish, agent gọi `getBestTimeToPostByNetwork` rồi `node scripts/metricool-mcp.mjs sync-times --brand <id> --from <file>` → `workspace/metricool-times/<brand>.json`. Lấy các khung điểm cao nhất của ngày đó (cần ít nhất 5 khung có điểm).
2. **Bảng mặc định theo nghiên cứu** khi Metricool chưa có hoặc quá ít dữ liệu (trang mới): `config/best-times.json`, Facebook, khán giả Mỹ, giờ `America/New_York`, mỗi thứ trong tuần một danh sách giờ xếp từ tốt nhất. Không bao giờ dùng giờ cố định tuỳ ý.

Nhiều bài một ngày thì cách nhau ít nhất 3 giờ; không dùng lại giờ đã có bài; bài đã hẹn trong ngày tính vào số bài của ngày đó.

**Giờ dự phòng (backup).** Khi giờ chính của ngày (Metricool hoặc bảng nghiên cứu) không xếp đủ `posts_per_day` bài cách nhau 3 giờ, tool thử giờ dự phòng của chính ngày đó trước khi dời bài sang ngày sau: (1) các khung điểm thấp hơn của Metricool (khung thứ 5 trở đi của ngày; 4 khung điểm cao nhất là giờ chính), (2) danh sách `backup` của `config/best-times.json`; rồi (3) giờ acceptable; vẫn cách nhau 3 giờ; còn thiếu thì giờ dự phòng rồi acceptable, cách nhau ít nhất 2 giờ. Không bao giờ chọn giờ ngẫu nhiên.

Giờ được ghi kèm nguồn chọn (`Metricool best time` / `Metricool backup` / `research default` / `research backup` / `research acceptable` / `catalog schedule`), hiện ở xem trước và tab Log.

Bảng mặc định (giờ địa phương của khán giả, xếp từ tốt nhất):

| Thứ | Giờ |
|---|---|
| Thứ 2 | 12:00, 21:00, 17:00, 09:00 |
| Thứ 3 | 08:00, 12:00, 19:00, 15:00 |
| Thứ 4 | 08:00, 12:00, 18:00, 15:00 |
| Thứ 5 | 09:00, 12:00, 20:00, 15:00 |
| Thứ 6 | 08:00, 12:00, 17:00, 20:00 |
| Thứ 7 | 09:00, 22:00, 12:00, 16:00 |
| Chủ nhật | 10:00, 13:00, 08:00, 18:00 |

Giờ dự phòng (`backup`, xếp từ tốt nhất; giờ phụ của cùng các nghiên cứu, không trùng giờ chính, bỏ khung 5-6 giờ sáng):

| Thứ | Giờ dự phòng | Theo |
|---|---|---|
| Thứ 2 | 22:00, 13:00, 19:00 | Buffer 22h, 19h; Sprout 12-13h |
| Thứ 3 | 07:00, 13:00, 17:00, 20:00, 14:00, 16:00, 18:00 | Buffer 7h; Sprout 12-20h |
| Thứ 4 | 09:00, 13:00, 16:00, 20:00, 14:00, 17:00, 19:00 | Buffer 9h; Sprout 12-20h |
| Thứ 5 | 08:00, 10:00, 13:00, 14:00 | Buffer 8h, 10h; Sprout 12-14h |
| Thứ 6 | 07:00, 13:00, 11:00 | Buffer 7h; Sprout buổi trưa |
| Thứ 7 | 21:00 | Buffer 21h (Sprout không có đỉnh rõ) |
| Chủ nhật | 09:00 | Buffer 9h |

Tầng 3 **acceptable** (`acceptable_curve`): mọi giờ 07:00-22:00 xếp theo đường tương tác Facebook chung của ba nghiên cứu (trưa mạnh nhất, rồi buổi sáng, rồi đầu buổi tối, đêm muộn yếu nhất): 12, 09, 10, 11, 13, 08, 14, 15, 18, 19, 17, 16, 20, 07, 21, 22 giờ. Mỗi ngày lấy các giờ chưa là giờ chính hay dự phòng của ngày đó, giữ nguyên thứ tự này; ngày nào nghiên cứu ít giờ (thứ 7, chủ nhật, thứ 2, thứ 6) vẫn có ít nhất 6 giờ dự phòng + acceptable. Mọi danh sách đều theo thứ tự ưu tiên tuyệt đối (tương tác cao nhất trước); bộ chọn giờ luôn thử: giờ chính → dự phòng → acceptable (cách 3 giờ), rồi dự phòng → acceptable (cách 2 giờ), rồi mới sang ngày sau. Tab Settings hiện bảng "Posting times" (đọc) với đủ ba tầng theo từng ngày.

Nguồn (tổng hợp, ưu tiên giờ các nghiên cứu cùng chỉ ra; bỏ khung 5-6 giờ sáng):
- [Sprout Social, Best times to post on Facebook](https://sproutsocial.com/insights/best-times-to-post-on-facebook/): dữ liệu 27/11/2025 - 27/02/2026, ~2 tỷ tương tác, ~307.000 trang, giờ địa phương. Thứ 2 12-13h; thứ 3, thứ 4 12-20h; thứ 5 12-14h và 20h; thứ 6 buổi trưa; thứ 7, chủ nhật không có đỉnh rõ.
- [Buffer, Best time to post on Facebook](https://buffer.com/resources/best-time-to-post-on-facebook/): hơn 14 triệu bài, giờ địa phương. Thứ 2 21h, 22h, 19h; thứ 3 8h, 19h, 7h; thứ 4 8h, 9h, 18h; thứ 5 9h, 8h, 10h; thứ 6 8h, 7h, 6h; thứ 7 22h, 6h, 21h; chủ nhật 10h, 9h, 8h. Ngày tốt nhất thứ 4, kém nhất thứ 7.
- [Hootsuite, Best time to post on Facebook](https://blog.hootsuite.com/best-time-to-post-on-facebook/): hơn 1 triệu bài, công bố 19/11/2025, theo giờ địa phương. Thứ 2 17h; thứ 3 5h; thứ 4, 5, 6, 7 6h; chủ nhật 8h.

### Múi giờ: lên lịch theo khách
- Mọi giờ đăng lên lịch theo `cadence.timezone` (múi giờ khách xem).
- MCP: `publicationDate.timezone` = múi giờ khách, Metricool tự quy đổi.
- CSV: không có cột timezone, Metricool đọc Date/Time theo múi giờ brand; `metricool-csv.mjs export` quy đổi từng giờ sang múi giờ brand (`metricool.timezone` của skill, không có thì `workspace/metricool-brands.json`), đúng cả giờ mùa hè. Kết quả ghi `planned` (giờ khách), `metricool` (giờ ghi vào CSV) và `time_note`.
- Cảnh báo thật: `metricool.timezone` của skill khác múi giờ brand đã đồng bộ (sai cấu hình).

## 4. CSV (dự phòng)
- Calendar → ⋮ → Import CSV. Template thật: `docs/metricool-csv-template.csv`, **99 cột** (vd `Text, Date, Time, Draft, Facebook, ..., Picture Url 1..10, Alt text picture 1..10, ..., Facebook Post Type, ..., Brand name`). Cột là `Youtube`, boolean viết thường; ô FALSE để trống được. Ngày `YYYY-MM-DD`, giờ `HH:mm:ss`. UTF-8, tối đa khoảng 50 bài mỗi file.
- Một file nhập được cho nhiều brand (cột `Brand name` khớp đúng nhãn brand).
- Có lỗi ở preview → Metricool nhập dạng nháp và ngày sai thành "hôm nay giờ hiện tại": **không bấm Import khi còn lỗi**.
- Video đặt ở `Picture Url 1` (+ `Video Thumbnail Url`); template không có cột Video Url.
- Xoá bài: Edit post → thùng rác → Confirm (vào Deleted posts, khôi phục được).

## 5. Tài liệu chính thức
- MCP: https://help.metricool.com/mcp-limits-and-plan-requirements-h72jg, https://help.metricool.com/faqs-about-the-metricool-mcp-1i3w0, https://help.metricool.com/more-scheduling-options-with-metricools-mcp-ylkdd
- CSV: https://help.metricool.com/how-to-schedule-posts-in-batch-with-a-csv-file-in-metricool-3zwxj
- Giới hạn đăng theo mạng: https://help.metricool.com/daily-posting-limits-on-social-media-sh58j
- Best time: https://help.metricool.com/best-time-to-post-on-social-media-in-metricool-w7ll9
- Giá: https://metricool.com/pricing/
