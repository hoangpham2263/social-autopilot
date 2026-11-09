# Metricool: tài khoản hiện có và cách dùng cho social-autopilot

Ngày kiểm tra: 2026-11-07. Chỉ xem, không đổi gì trong tài khoản.

## 0. Hiện tại (2026-11-09): gói Starter, đăng qua MCP

Mục 1-7 bên dưới là ghi chép lúc tài khoản còn Free; dữ kiện đang đúng là mục này.

| Mục | Giá trị |
|---|---|
| Gói | **Starter**: nhiều brand, bài không giới hạn, **không REST API**, không duyệt bài (team) |
| Brand | Dreamy Vows `<blog_id_2>`, Grenheim `<blog_id_3>` (cả hai chỉ Facebook, múi giờ brand `Indian/Christmas`); Fortera Apparel `<blog_id_1>` (không phải skill, **không bao giờ đụng**) |
| Đường chính | Connector claude.ai "Metricool": tool MCP cho **agent Claude** (Node không gọi được) |
| Đường dự phòng | CSV (`metricool-csv.mjs`, người tự import), mục 5-7 |

### Tool MCP dùng được
- `getBrandSettings`: brand, blogId, múi giờ, mạng đã nối.
- `createScheduledPost(blogId, date, info)`: tạo bài (nháp hoặc hẹn giờ). `date` = ISO kèm offset; `info` = **chuỗi JSON**.
- `getScheduledPosts(brandId, fromDate, toDate, timezone)`: đọc bài đã hẹn để đối chiếu trạng thái (PENDING / ERROR / PUBLISHED).
- `updateScheduledPost`: sửa bài đã tạo (chưa dùng trong quy trình).
- `getBestTimeToPostByNetwork`: giờ tốt; muốn dùng thì ghi vào `cadence.slots`.
- `createScheduledPostForReview`: cần gói team, **không dùng được**.

### Test thật 2026-11-09 (phiên chính)
`createScheduledPost(blogId "<blog_id_2>", date "2026-11-17T10:00:00-08:00", info)` với `info`:
```json
{"draft":true,"autoPublish":true,"media":["<link Pages>"],"mediaAltText":["..."],"providers":[{"network":"facebook"}],
 "publicationDate":{"dateTime":"2026-11-17T10:00:00","timezone":"America/Los_Angeles"},"text":"...",
 "facebookData":{"type":"POST"},"shortener":false,"smartLinkData":{"ids":[]},"descendants":[],"firstCommentText":"","hasNotReadNotes":false}
```
Kết quả: id `421362711`, uuid `3757973938339334504`, `draft: true`, có `plannerUrl`; Metricool tự đổi `publicationDate` sang múi giờ brand (`2026-11-18T01:00` Indian/Christmas) và **chép ảnh về `static.metricool.com`** (khác CSV, không chép).

Hệ quả: **múi giờ do Metricool lo** khi `publicationDate` mang múi giờ khách (`cadence.timezone`); không quy đổi tay như CSV. Vẫn chỉ gỡ file host sau khi bài `published`.

### Quy trình (RUNBOOK bước 5c, `scripts/metricool-mcp.mjs`)
1. `status --brand <id>` → `query` cho `getScheduledPosts`; agent khớp theo id: ERROR báo người dùng, PUBLISHED chạy `mark-published.mjs` của skill.
2. `payload --brand <id> [--posts ...] [--draft|--schedule]` → mỗi bài `approved` có `media_url`/`video_url` và chưa có `metricool.<network>.id` một item `{ tool: "createScheduledPost", args: { blogId, date, info } }`. Giờ: catalog `schedule`, `--date/--time`, `cadence.slots` hoặc giờ tự động (cùng bộ lập lịch `planPosts` với CSV), theo `cadence.timezone`. Text chỉ ngôn ngữ đăng (không `review_langs`), không nhãn AI; `facebookData.type` POST/REEL; `instagramData { type, isAiGenerated: false }` chỉ khi bật Instagram. Mặc định `draft: true`.
3. Agent gọi `createScheduledPost` với đúng `args` (không sửa `info`), rồi `record --brand <id> --post POST-xx --id <id> --uuid <uuid> --planner-url <plannerUrl> --publication <publicationDate.dateTime> --tz <publicationDate.timezone> [--draft]` → catalog `metricool.<network>` `{ blog_id, id, uuid, planner_url, publication, timezone, draft, sent_at }`; không nháp thì `schedule.<network>` + trạng thái `scheduled`. Trường tuỳ chọn của chuẩn, `check-post.mjs` kiểm.
- Chặn: blogId Fortera `<blog_id_1>` và mọi blogId gắn với skill khác trong `config/metricool-brands.json`; mạng ngoài facebook/instagram (dùng CSV); `language_policy.mode: separate-posts`; giờ đã qua; link không https hoặc WebP.

## 1. Tài khoản (đọc trực tiếp từ app.metricool.com)

| Mục | Giá trị |
|---|---|
| Người dùng | userId `<user_id>`, email đăng nhập `<owner_email>`, tạo 2026-10-12 |
| Gói | **Free** (`planId FREE`, `apiEnabled:false`, `advancedOrHigher:false`, không trial) |
| Giới hạn gói | 1 brand; 20 bài/tháng/brand; lịch sử analytics 31 ngày (có watermark); AI: 3 caption/tháng/brand, 5 credit; competitors 5/mạng; không tải report; không link in bio Instagram |
| Brand duy nhất | blogId `<blog_id_1>` = **Fortera Apparel** (không phải DreamyVows hay GRENHEIM) |
| Mạng đã nối | Facebook Page "Fortera Apparel" (`1196995913503312`); Instagram `apparelfortera` (qua Facebook login); YouTube "Fortera Apparel" (`UC08MHi4j7fD5TnFupQ2MOwA`). TikTok, LinkedIn, Pinterest, Threads, GBP: chưa nối |
| Múi giờ brand | `America/New_York` |
| Đang dùng | Đã đăng 12/20 bài tháng 11. Lịch 2 bài/ngày (09:00 và 18:30), mỗi bài đăng cả FB và IG, `autoPublish:true`, `draft:false`, 1 ảnh từ `cdn.shopify.com`, có `mediaAltText`, `firstCommentText` rỗng. Với nhịp này sẽ hết 20 bài khoảng 2026-11-10 |
| API | Settings > API ghi "API access — Advanced & Custom plans" + nút Upgrade. Không có token. Không dùng được REST API |
| Tích hợp | Settings > Integrations có: **Claude**, ChatGPT, Make, Zapier, Adobe Express (Connect); Canva cần gói trả phí. Chưa nối cái nào |

Menu thấy được: Analytics (Summary, Facebook, Instagram, YouTube, TikTok, LinkedIn; mỗi mạng có tab Page overview, Posts, **Competitors**), Reporting, **Hashtag Tracker**, Inbox, Planning (Calendar, List, Posts library, **Autolists**, Deleted posts, **Flows** mới), **SmartLinks**, Ads. Calendar có nút **Best times** (hiện % theo từng giờ mỗi ngày) và menu Import CSV.

Bảng giá trong app (USD, trả theo năm, chưa thuế):
- Starter từ 20/tháng (5 brand) hoặc 36 (10 brand): bài không giới hạn, 100 competitors, LinkedIn, report, Canva và Google Drive. **Không API, không duyệt bài.**
- Advanced 53/tháng (15 brand; 636/năm), 85 (25), 159 (50): thêm team, role, **hệ thống duyệt bài**, **API** (Looker Studio, Zapier, Make).
- Custom: liên hệ.
- Add-on: Advanced Analytics, Flows (gói trả phí, 2.500 lần chạy/tháng), X.

**Quan trọng:** tài khoản này là của Fortera Apparel và đã dùng hết 1 brand của gói Free. Muốn thêm DreamyVows hoặc GRENHEIM thì phải nâng gói (Starter trở lên) hoặc dùng tài khoản Metricool khác.

## 2. Tính năng liên quan (tài liệu chính thức)

### MCP (đường cho agent)
- Dùng mọi gói, kể cả Free; giới hạn gói vẫn áp dụng. Nguồn: https://help.metricool.com/mcp-limits-and-plan-requirements-h72jg, https://help.metricool.com/faqs-about-the-metricool-mcp-1i3w0
- Làm được: xem brand (`get_brands`), xem lịch, tạo và sửa bài hẹn giờ (`update_schedule_post`), sửa hàng loạt, giờ tốt nhất (`get_best_time_to_post`), caption riêng cho từng mạng, giờ riêng cho từng mạng, bài lặp lại, analytics (cả Meta/Google/TikTok Ads).
- "Create posts for review / send them for review": có nhắc, nhưng duyệt bài là tính năng gói Advanced, nên trên Free chưa chắc dùng được.
- **Ảnh/video phải là link**: URL công khai, hoặc file Google Drive/Dropbox. Chỉ ChatGPT mới đính kèm file trực tiếp. Nguồn: https://help.metricool.com/more-scheduling-options-with-metricools-mcp-ylkdd
- Không làm được qua MCP: Inbox, bình luận, SmartLinks, autolists, file Canva/Drive trong Metricool, quản lý quảng cáo.
- Claude Code cần Claude Pro hoặc Max.

### CSV bulk (đường không cần API)
- Calendar > ⋯ > Import CSV > tải template. Không thêm, xoá hay đổi thứ tự cột. Lưu UTF-8. Nên tối đa khoảng 50 bài mỗi file. Dùng được trên Free (vẫn tính vào 20 bài/tháng).
- Cột chính: `Text`, `Date` (YYYY-MM-DD), `Time` (00:00:00), `Draft` (TRUE = nhập dạng nháp), cột TRUE/FALSE cho từng mạng (`Facebook`, `Instagram`, `TikTok`, `YouTube`, `Threads`, `Pinterest`, `LinkedIn`, `GBP`, `Bluesky`, `Twitter/X`), `Picture Url 1..10`, `Alt text picture 1..10`, `First Comment Text`, `Instagram Post Type` (POST, REEL, TRIAL_REEL, STORY), `Instagram Show Reel On Feed`, `Document title`, `Brand name`.
- Ô boolean muốn FALSE thì để trống. Ảnh phải là link công khai trỏ thẳng tới file; nên dùng MP4.
- Nguồn: https://help.metricool.com/how-to-schedule-posts-in-batch-with-a-csv-file-in-metricool-3zwxj, https://metricool.com/import-csv-for-scheduling/

### REST API (chỉ Advanced/Custom)
- `POST /api/v2/scheduler/posts?blogId=&userId=`, header `X-Mc-Auth`. Body giống hệt payload đang có trong tài khoản: `publicationDate{dateTime,timezone}`, `text`, `firstCommentText`, `providers[{network}]`, `media[]` (URL), `mediaAltText[]`, `autoPublish`, `draft`, `saveExternalMediaFiles`, `facebookData{type}`, `instagramData{type,autoPublish}`.
- Giờ tốt nhất: `GET /api/v2/scheduler/besttimes/{network}?start=&end=&timezone=&blogId=&userId=` (app dùng chính endpoint này; mạng: facebook, instagram, linkedin, youtube, tiktok, twitter). Best time của IG phụ thuộc dữ liệu Meta.
- Không thấy rate limit công khai cho API đọc; giới hạn đăng theo từng mạng (24 giờ): https://help.metricool.com/daily-posting-limits-on-social-media-sh58j
- Nguồn: https://app.metricool.com/resources/apidocs/index.html, https://help.metricool.com/plans-add-ons-and-api-access-explained-xux1u

### Khác
- Best time: https://help.metricool.com/best-time-to-post-on-social-media-in-metricool-w7ll9
- Competitors: Free 5 tài khoản mỗi mạng (FB, IG, Bluesky, Twitch), thêm rồi không đổi được; Starter 100. Nguồn: https://help.metricool.com/main-differences-between-free-and-paid-plans-bl0v9
- Duyệt bài (approval): gói Advanced. Nguồn: https://metricool.com/approval-system-social-media/, https://help.metricool.com/metricool-for-agencies-everything-you-need-to-know-fkod6
- Giá: https://metricool.com/pricing/

## 3. Áp vào quy trình của mình

| Tính năng Metricool | Dùng thế nào |
|---|---|
| Nháp (`draft`) | Bước 8: bài `approved` gửi lên dạng nháp, người duyệt bấm hẹn giờ trong Metricool. Duyệt chính vẫn ở app của mình (Free không có approval) |
| Best times | Không bắt buộc: `cadence.slots` trống thì tool tự chọn giờ (mục "Giờ đăng tự động" bên dưới); muốn ghi đè thì điền `cadence.slots` (có thể theo best times đọc qua MCP) |
| Competitors | Thêm 5 trang đối thủ FB làm nguồn nghiên cứu (chọn kỹ vì Free không đổi được) |
| CSV import | Đường dự phòng: tool xuất CSV đúng template, người dùng tự import |
| MCP | Đường chính cho agent (Claude Code), không cần gói trả phí |
| REST API | Chỉ khi lên Advanced; `src/metricool.mjs` có thể gọi thẳng |
| Hashtag Tracker, SmartLinks, Inbox | Không cần cho giai đoạn này |

### Đầu vào social.json/tool cần có
- `metricool.user_id` (<user_id> nếu dùng tài khoản này) và `metricool.blog_id` riêng cho từng thương hiệu (hiện **chưa có** brand DreamyVows/GRENHEIM).
- `metricool.timezone` = múi giờ brand trong Metricool (Dreamy Vows, Grenheim: Indian/Christmas, UTC+7). Không có thì tool lấy múi giờ brand trong `config/metricool-brands.json` (theo `skill_id`). `cadence.timezone` là múi giờ khách xem (America/Los_Angeles); hai múi giờ khác nhau được, xem mục "Múi giờ: lên lịch theo khách, ghi theo Metricool".
- Danh sách mạng bật (`providers[].network`: facebook, instagram, ...) khớp với mạng đã nối trong brand.
- Mỗi bài: `text` (hoặc text riêng từng mạng), ngày giờ, `media` là **URL công khai** (Shopify CDN như Fortera đang làm, hoặc GitHub raw/R2), `alt text`, `first comment` (tuỳ chọn), loại bài IG (POST/REEL/STORY), cờ `draft`.
- Với CSV: thêm định dạng ngày giờ đã chọn khi import, và `Brand name` nếu một file chứa nhiều brand.
- Không cần ID trang Facebook trong payload, Metricool lấy từ brand.

### Giờ đăng tự động (cadence.slots trống)

`metricool-csv.mjs export` chọn giờ cho bài chưa có `schedule` và không có `--date/--time`. `cadence.slots` có giờ thì dùng giờ đó (ghi đè); trống thì rải `cadence.posts_per_week` (1-7, mặc định 3) vào các ngày tốt nhất của mạng đầu tiên trong kênh bật, giờ theo **múi giờ khách xem** (`cadence.timezone`), rồi quy đổi sang múi giờ Metricool khi ghi Date/Time (mục dưới). Mỗi ngày tối đa một bài của thương hiệu; không trùng ngày+giờ đã có trong catalog; bài thêm khi `posts_per_week` lớn hơn số ngày tốt đi theo thứ tự mon, fri, wed, thu, tue, sat, sun. Bảng (`AUTO_TIMES` trong `scripts/metricool-csv.mjs`, giờ thử theo thứ tự):

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

Đây là giờ mặc định chung; khi có số liệu best times của brand thì điền `cadence.slots` để ghi đè.

### Múi giờ: lên lịch theo khách, ghi theo Metricool

Metricool đọc cột Date/Time của CSV theo **múi giờ của brand trong Metricool** (Dreamy Vows, Grenheim: Indian/Christmas, UTC+7), còn khách xem ở Mỹ (`cadence.timezone` America/Los_Angeles). Nếu ghi thẳng "10:00" thì bài lên 10:00 UTC+7, tức tối hôm trước ở LA.

- Mọi giờ đăng được **lên lịch theo `cadence.timezone`**: `cadence.slots`, giờ tự động, `schedule` trong catalog và `--date/--time`.
- `metricool-csv.mjs export` **quy đổi** từng ngày giờ sang múi giờ Metricool (`metricool.timezone`, không có thì `config/metricool-brands.json`) trước khi ghi Date/Time, dùng Intl nên đúng giờ mùa hè (DST) và lùi/tiến ngày. Giờ lặp khi Mỹ lùi đồng hồ (vd 01:30 ngày 2026-11-01) lấy lần đầu; giờ không tồn tại khi tiến đồng hồ dời tới sau khoảng nhảy.
- Kết quả export ghi cả hai cho từng bài: `planned` (giờ khách), `metricool` (giờ ghi vào CSV) và `time_note`, vd "2026-11-10 10:00 America/Los_Angeles = 01:00 ngày hôm sau (2026-11-11) Indian/Christmas trong Metricool". `validate` trả `times` tương tự (đổi ngược từ CSV) và xét "đã qua / hôm nay" theo ngày của khách.
- Hai múi giờ khác nhau chỉ là thông tin ("Giờ đăng được quy đổi tự động sang múi giờ Metricool"), không còn là lỗi. Gọn hơn (không bắt buộc): đặt múi giờ brand trong Metricool = múi giờ khách, khi đó không cần quy đổi.
- Cảnh báo thật: `social.json metricool.timezone` khác múi giờ brand trong `config/metricool-brands.json` (sai cấu hình), hoặc không biết múi giờ Metricool (khi đó tool không quy đổi).

### Đường rẻ nhất chạy được
1. **Free + MCP + draft** chạy được với 1 brand, 20 bài/tháng (3 bài/tuần ≈ 13 bài/tháng là đủ). Nhưng **tài khoản này đã bị Fortera dùng hết** slot brand và gần hết 20 bài/tháng, nên phải dùng một tài khoản Free riêng cho mỗi thương hiệu (cần xem điều khoản), hoặc
2. **Starter 20 USD/tháng (5 brand, bài không giới hạn)**: gộp Fortera, DreamyVows, GRENHEIM vào một tài khoản, đăng qua MCP và CSV. Không API, không approval.
3. Advanced 53 USD/tháng chỉ cần khi muốn REST API trực tiếp, Zapier/Make hoặc approval nhiều người.

Khuyến nghị: dùng MCP làm đường cho agent, gửi bài dạng nháp; CSV là đường dự phòng. Chưa cần API.

## 4. Câu hỏi còn mở
1. Tài khoản Fortera Apparel có phải tài khoản dự định dùng không? DreamyVows/GRENHEIM sẽ nằm trong tài khoản này (nâng Starter) hay mỗi thương hiệu một tài khoản Free?
2. Trên Free, MCP có tạo được bài "for review" không, hay chỉ draft? Cần thử 1 bài nháp sau khi nối connector Claude.
3. MCP nhận link ảnh nào ổn định: Shopify Files CDN của từng store, GitHub raw hay R2?
4. `lang: ["vn","en"]` trong social.json: trang FB Mỹ đăng một caption tiếng Anh hay gộp hai thứ tiếng?
5. ~~Múi giờ~~: đã xử lý, giờ lên lịch theo `cadence.timezone` và tự quy đổi sang múi giờ brand Metricool khi xuất CSV.
6. Rate limit của MCP/API: chưa có số công khai.

## 5. CSV test 2026-11-09

Thử 1 lần, được người dùng duyệt, trên brand Fortera Apparel (blogId <blog_id_1>). Tạo 1 bài **nháp**, kiểm tra, rồi xoá. Không đăng, không hẹn giờ thật, không đổi cài đặt, không đụng bài khác.

**Kết quả: chạy được.** Import 1 dòng → Metricool tạo bài `draft:true` đúng ngày 2026-11-11 10:00 (America/New_York), chỉ Facebook, có ảnh và alt text. Đã xoá (id 421284819). Danh sách bài tuần 8–14/11 trước và sau giống hệt (8 bài).

### Template thật
- File: `docs/metricool-csv-template.csv` (tên gốc `Mtr_calendar_template.csv`). Link tải: `GET /api/v2/scheduler/posts/template?blogId=&userId=&userToken=<token phiên>`.
- **99 cột**, thứ tự: `Text, Date, Time, Draft, Facebook, Twitter/X, LinkedIn, GBP, Instagram, Pinterest, TikTok, Youtube, Threads, Bluesky, Picture Url 1..10, Alt text picture 1..10, Document title, Shortener, Video Thumbnail Url, Video Cover Frame, Twitter/X ... (7 cột), Pinterest ... (6 cột), Instagram Post Type, Instagram Show Reel On Feed, Instagram Trial Reel Share Automatically, Youtube ... (9 cột), GBP Post Type, Facebook Post Type, Facebook Title, First Comment Text, TikTok ... (18 cột), LinkedIn ... (9 cột), Threads Reply Control, Threads Is Spoiler, Threads Post Type, Brand name`.
- Khác tài liệu: cột là `Youtube` (không phải `YouTube`), có thêm `Shortener`, `Facebook Post Type` (POST/REEL/STORY), `Facebook Title`, `Threads Post Type`... Boolean trong template viết thường `true`/`false`.
- File mẫu đã dùng: `docs/examples/metricool-test-draft.csv`.

### Các bước và thời gian
1. Calendar → nút ⋮ (cạnh bộ lọc) → Import CSV → Download template.
2. Chọn file CSV → màn Preview (chọn Date format `2026-11-08` và Time format `21:05:00`, mặc định đã đúng YYYY-MM-DD / HH:mm:ss) → bấm vào bài để xem preview FB.
3. "Import 1 posts" → Result "1 post imported" → Accept.
Khoảng 5 thao tác, vài giây mỗi bước; cả test (gồm kiểm tra, xoá) khoảng 4 phút.

### Phát hiện
- **Import chạy ở trình duyệt**: app đọc CSV rồi gọi `POST /api/v2/scheduler/posts` (mỗi dòng một request) với body giống hệt API: `draft:true`, `autoPublish:true`, `providers:[{network:"facebook"}]`, `media`, `mediaAltText`, `publicationDate{dateTime,timezone}`, `facebookData{type:"POST"}`, `targetBrandId`. Không gửi `saveExternalMediaFiles` (trả về `false`).
- **Ảnh**: URL `cdn.shopify.com` được nhận, preview hiện ảnh ngay. Không có lỗi kiểm tra nào.
- **Draft**: Preview không hiện chữ "Draft", nhưng request và lịch đều đúng: thẻ lịch ghi "Draft", trang Edit post ghi trạng thái "Draft", nút chính là "Save as draft". Provider vẫn là `PENDING` nhưng `draft:true` nên không tự đăng.
- **Hạn mức**: `monthPublishedPostsByBrand` là 16 trước và sau (banner "16 out of your 20"). Nháp không tính; chỉ tính khi bài đăng thật.
- **Brand name** `Fortera Apparel` khớp; preview hiện đúng brand.
- **Xoá**: nút thùng rác trong Edit post → Confirm → `DELETE /api/v2/scheduler/posts/{id}?isRecoverable=true`. Bài vào tab "Deleted posts" (khôi phục được), không mất hẳn.
- Playwright: nút Download template là thẻ `<a href>`; sự kiện download không bắt được ở chế độ extension, phải `fetch(href)` để lấy nội dung. Upload: `input[type=file]` có sẵn trong dialog, `setInputFiles` chạy thẳng (file nằm dưới `C:\Users\Admin`).

### Mức tự động hoá
- Tool xuất CSV đúng 99 cột: dễ, làm hoàn toàn tự động.
- Bước import cần trình duyệt đã đăng nhập (Playwright gắn Chrome của người dùng): mở calendar → ⋮ → Import CSV → upload → Import → Accept. Agent hẹn giờ làm được nhưng phụ thuộc phiên Chrome đang mở, giao diện có thể đổi, và một trình duyệt chỉ một agent dùng.
- Vì import chỉ là `POST /api/v2/scheduler/posts` từ phiên web, về kỹ thuật có thể gọi thẳng bằng token phiên, nhưng đó là API nội bộ (gói Free không có API chính thức) → không nên dựa vào. Đường chính vẫn là MCP; CSV + Playwright là dự phòng, hoặc người dùng tự import file do tool xuất ra.

## 6. Multi-brand CSV schedule test 2026-11-09

Người dùng duyệt: hẹn giờ **thật** (Draft false) cho thứ Sáu 2026-11-13 để kiểm tra; người dùng tự xem và xoá trước giờ đăng. Theo yêu cầu đổi giữa chừng: **không dùng Fortera Apparel** (tài khoản đang chạy), chỉ Grenheim + Dreamy Vows; ảnh chỉ dùng link GitHub (`raw.githubusercontent.com/hoangpham2263/social-autopilot-sources/...`).

**Kết quả: 1 file CSV nhập được cho nhiều brand.** Import từ calendar Grenheim, mỗi dòng vào đúng brand theo cột `Brand name`.

### Brand trong tài khoản (đọc từ `/api/admin/simpleProfiles`)
| Brand | blogId | Timezone | Mạng đã kết nối |
|---|---|---|---|
| Fortera Apparel | <blog_id_1> | America/New_York | Facebook, Instagram, YouTube |
| Dreamy Vows | <blog_id_2> | Indian/Christmas (UTC+7) | Facebook |
| Grenheim | <blog_id_3> | Indian/Christmas (UTC+7) | Facebook |

### Bài đã hẹn (KHÔNG xoá, chờ người dùng kiểm tra)
| Brand | Post id | Mạng | Trạng thái | Giờ đăng |
|---|---|---|---|---|
| Grenheim | 421308154 | Facebook (POST) | draft:false, provider PENDING (lịch ghi "Pending", nút "Schedule") | 2026-11-13 11:00 Indian/Christmas = 11:00 giờ VN = 04:00 UTC |
| Dreamy Vows | 421308155 | Facebook (POST) | như trên | 2026-11-13 11:00 Indian/Christmas = 11:00 giờ VN = 04:00 UTC |

Nội dung: Grenheim = caption POST-06 (coffee-table-gathering, đổi "chair" thành "stool") + ảnh `grenheim/2026/11/post-06.png`; Dreamy Vows = POST-01 (birthday-dinner-neon-sign) + ảnh `dreamyvows/2026/11/post-01.png`. File: `docs/examples/metricool-multibrand-test.csv`. Ảnh chụp: `docs/examples/metricool-multibrand-test/`.

Xoá: mở calendar brand → bấm thẻ bài ngày 13/11 → nút thùng rác → Confirm (vào tab Deleted posts, khôi phục được).

### Phát hiện
- **Nhiều brand trong 1 CSV: chạy.** Preview hiện tên brand dưới mỗi dòng; request `POST /api/v2/scheduler/posts` gửi `targetBrandId` theo từng dòng (<blog_id_3>, <blog_id_2>) dù đang mở calendar Grenheim. Calendar mỗi brand chỉ hiện bài của brand đó. Fortera không bị đụng (Thứ Sáu trống).
- **Timezone**: request ghi `timezone: Indian/Christmas` cho cả hai dòng. Hai brand cùng timezone nên chưa phân biệt được Metricool dùng timezone của brand đích hay của calendar đang mở. Nếu trộn brand khác timezone (vd Fortera New_York) cần kiểm tra lại; an toàn nhất là import từ calendar của brand có cùng timezone.
- **Ảnh raw.githubusercontent.com: được nhận.** Không lỗi ở preview, preview hiện ảnh, thẻ lịch và trang Edit post hiện ảnh + nhãn ALT. Metricool **không** copy về static.metricool.com: `media` vẫn là URL GitHub, `saveExternalMediaFiles:false`; ảnh được tải từ GitHub lúc đăng → file trên GitHub phải còn đến giờ đăng.
- **Kiểm tra ở preview (luật học được)**:
  - URL ảnh chứa `.webp` (kể cả CDN Shopify trả JPEG qua `?format=jpg`) → lỗi "Unsupported .webp format. It may cause publishing to fail." Metricool xét chuỗi `.webp` trong URL, không xét content-type. Ảnh sản phẩm Grenheim trên Shopify đều là .webp → không dùng được trực tiếp.
  - Có lỗi bất kỳ → banner "Some posts have errors. They will be imported as draft. If the post date is invalid, it will be scheduled today at current time." Dòng lỗi có icon đỏ (bấm vào để xem lý do). **Không bấm Import khi còn lỗi**: ngày sai sẽ bị đặt thành "hôm nay giờ hiện tại" (có thể đăng ngay).
  - Ngày `YYYY-MM-DD` và giờ `HH:mm:ss` khớp mặc định của dropdown Date/Time format; `Draft false`, `Facebook true` viết thường đều được nhận.
  - `Brand name` khớp đúng nhãn brand (`Grenheim`, `Dreamy Vows`).
- Bản đầu có dòng Fortera + ảnh Shopify .webp: dừng ở preview, đóng dialog, **không import**.
- Playwright: tab chạy ở trạng thái `visibilityState: hidden` nên animation menu Vuetify đứng (`pointer-events:none`), click thường không ăn và click force xuyên xuống ô lịch (mở "Create new post", đã Cancel, không lưu). Cách làm: thay `requestAnimationFrame` bằng `setTimeout`, set `pointer-events:auto` cho `.v-overlay__content`, rồi `page.mouse.click` theo toạ độ. Trang calendar đôi khi kẹt "Loading, please wait..." → `bringToFront()` + reload.

## 7. Media test (carousel, video) 2026-11-09

Brand Grenheim (blogId <blog_id_3>), chỉ Facebook, mọi dòng `Draft true`, ngày 2026-11-20 10:00:00. File: `docs/examples/metricool-media-test.csv` (99 cột template). Ảnh chụp: `docs/examples/metricool-media-test/`.

**Trạng thái: dừng ở Preview, CHƯA import.** Bước bấm "Import 4 posts" bị hệ thống quyền của Claude Code chặn (auto mode coi là ghi vào app bên ngoài khi chưa được người dùng duyệt). Đã đóng dialog, không tạo bài nào. Muốn đi tiếp: người dùng tự import file này, hoặc cho phép bước Import cho agent. Phần "cách hiện trong lịch / Edit post / body request" vì vậy chưa có.

### Media đã host (raw.githubusercontent.com/hoangpham2263/social-autopilot-sources/main/grenheim/2026/11/)
| File | Nguồn | Size | Content-Type GitHub trả |
|---|---|---|---|
| test-carousel-1..3.png | published POST-dining-table-vases image-01..03 | 2.6 / 2.7 / 3.0 MB | image/png |
| test-carousel-4..7.png | published POST-corner-bathroom-shelf image-01..04 | 2.1–2.7 MB | image/png |
| test-carousel-8..10.png | published POST-mushroom-table-cozy-corner image-01..03 | 2.1–2.5 MB | image/png |
| test-video-1.mp4 | published VID-round-dining-table/video.mp4 (remux, xoá metadata, faststart) | 22.4 MB, 34.5 s, 768x1168, H.264 High + AAC 44.1k | **application/octet-stream** |
| test-video-1-reel.mp4 | bản 9:16 720x1280 (nền blur, re-encode CRF 20) | 14.3 MB, 34.5 s | **application/octet-stream** |
| test-video-1-thumb.png | published VID-round-dining-table/cover.png | 2.4 MB | image/png |

PNG đã chạy strip-png-metadata: không có chunk metadata nào (sạch sẵn). jsDelivr (`cdn.jsdelivr.net/gh/...`) trả 403 cho mp4 22 MB (giới hạn kích thước file) → không dùng được làm host video lớn.

### Kết quả Preview
| Dòng | Nội dung | Facebook Post Type | Preview |
|---|---|---|---|
| A | Carousel 3 ảnh + alt | POST | OK, 3 thumbnail, preview FB dạng lưới ảnh |
| B | Carousel 10 ảnh (tối đa của template) + alt | POST | OK, 10 thumbnail, preview FB dạng lưới |
| C | Video mp4 768x1168 ở `Picture Url 1` + `Video Thumbnail Url` | POST | OK, thumbnail có nút play, preview FB hiện video |
| D (lần 1) | Cùng video 768x1168 | REEL | **Lỗi**: "Reel → Invalid aspect ratio for video, ratio must be between 9:16 and 9:16. These videos don't meet this requirement: #1 (0.657)." |
| D (lần 2) | Video 9:16 720x1280 (`test-video-1-reel.mp4`) | REEL | OK, preview dạng Reel (player dọc) |

Lần 2: không có banner lỗi, nút "Import 4 posts".

### Luật học được
- **Video đặt ở `Picture Url 1`** (template không có cột Video Url): Metricool nhận diện là video theo đuôi `.mp4`, đọc được file (đo được tỉ lệ 0.657) dù GitHub raw trả `application/octet-stream` → content-type **không** chặn ở preview. Chưa biết lúc đăng thật Facebook có chấp nhận không (cần import + đăng thử mới biết).
- **Facebook REEL bắt buộc đúng 9:16** (kiểm tra ở preview). Video không đúng 9:16 → dùng `Facebook Post Type` = POST (video thường) hoặc làm bản 9:16.
- **Carousel tối đa 10 ảnh** = 10 cột Picture Url; 10 ảnh PNG ~2.5 MB mỗi ảnh không bị cảnh báo.
- Instagram/TikTok/YouTube để false vì Grenheim chỉ kết nối Facebook.
- Playwright: lần này tab ở trạng thái `visible` sau `bringToFront()`, menu ⋮ (toạ độ ~1313,197) click thường được, không cần hack animation. Ảnh chụp màn hình chỉ lưu được dưới `C:\Users\Admin` (rồi copy sang docs).

## Video hosting (09/11/2026)
- raw.githubusercontent.com trả `application/octet-stream` cho `.mp4`; jsDelivr trả 403 cho mp4 22 MB. Đã bật GitHub Pages cho `social-autopilot-sources` (main, root, có `.nojekyll`): `https://hoangpham.is-a.dev/social-autopilot-sources/<path>` trả `video/mp4` cho mp4, `image/png` cho ảnh, `Accept-Ranges: bytes` và 206 cho Range.
- `host-image.mjs` dùng `imageHost.pagesBase` cho mọi link (video bắt buộc Pages, ảnh dùng raw làm dự phòng khi Pages chưa build xong) và ghi `video_url` (+ `video_thumbnail_url`) cho bài video. Mp4 vẫn đặt ở `Picture Url 1` của CSV như trước.
