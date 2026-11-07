# Metricool: tài khoản hiện có và cách dùng cho social-autopilot

Ngày kiểm tra: 2026-11-07. Chỉ xem, không đổi gì trong tài khoản.

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
| Best times | Đọc qua MCP để điền `cadence.slots` (vd. 3 khung/tuần theo giờ cao nhất) |
| Competitors | Thêm 5 trang đối thủ FB làm nguồn nghiên cứu (chọn kỹ vì Free không đổi được) |
| CSV import | Đường dự phòng: tool xuất CSV đúng template, người dùng tự import |
| MCP | Đường chính cho agent (Claude Code), không cần gói trả phí |
| REST API | Chỉ khi lên Advanced; `src/metricool.mjs` có thể gọi thẳng |
| Hashtag Tracker, SmartLinks, Inbox | Không cần cho giai đoạn này |

### Đầu vào social.json/tool cần có
- `metricool.user_id` (<user_id> nếu dùng tài khoản này) và `metricool.blog_id` riêng cho từng thương hiệu (hiện **chưa có** brand DreamyVows/GRENHEIM).
- `metricool.timezone` khớp múi giờ brand trong Metricool (brand hiện có dùng America/New_York; social.json đang để America/Los_Angeles).
- Danh sách mạng bật (`providers[].network`: facebook, instagram, ...) khớp với mạng đã nối trong brand.
- Mỗi bài: `text` (hoặc text riêng từng mạng), ngày giờ, `media` là **URL công khai** (Shopify CDN như Fortera đang làm, hoặc GitHub raw/R2), `alt text`, `first comment` (tuỳ chọn), loại bài IG (POST/REEL/STORY), cờ `draft`.
- Với CSV: thêm định dạng ngày giờ đã chọn khi import, và `Brand name` nếu một file chứa nhiều brand.
- Không cần ID trang Facebook trong payload, Metricool lấy từ brand.

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
5. Múi giờ: thống nhất America/Los_Angeles (social.json) hay theo múi giờ brand Metricool?
6. Rate limit của MCP/API: chưa có số công khai.
