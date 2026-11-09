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
- `getBestTimeToPostByNetwork`: tuỳ chọn; muốn dùng thì ghi giờ vào `cadence.slots` của skill.
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

### Giờ tự động (cadence.slots trống)
Bài chưa có `schedule` trong catalog: `cadence.slots` có giờ thì dùng; trống thì rải `cadence.posts_per_week` (1-7, mặc định 3) vào các ngày tốt nhất của mạng đầu tiên trong kênh bật, theo **múi giờ khách** (`cadence.timezone`). Mỗi ngày tối đa một bài của thương hiệu; không trùng giờ đã có; bài thêm đi theo thứ tự mon, fri, wed, thu, tue, sat, sun. Bảng (`AUTO_TIMES` trong `scripts/metricool-csv.mjs`):

| Mạng | Ngày tốt | Giờ |
|---|---|---|
| Facebook | tue, wed, thu | 09:00, 10:00, 11:00 |
| Instagram | tue, wed, fri | 11:00, 13:00, 10:00 |
| TikTok | tue, thu, fri | 18:00, 19:00, 17:00 |
| LinkedIn | tue, wed, thu | 08:00, 10:00, 12:00 |
| Pinterest | fri, sat, sun | 20:00, 21:00, 14:00 |
| YouTube | thu, fri, sat | 15:00, 17:00, 12:00 |
| X, Threads, Bluesky | tue, wed, thu | 09:00, 12:00, 10:00 |
| Google Business Profile | mon, wed, fri | 10:00, 11:00, 09:00 |

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
