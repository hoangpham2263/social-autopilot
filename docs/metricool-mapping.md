# Metricool: ánh xạ dữ liệu bài đăng

Ngày 2026-11-07. Lấy từ tài khoản Fortera Apparel (blogId <blog_id_1>, userId <user_id>), **chỉ đọc (GET)**. Không đăng, không tạo nháp, không import, không nối MCP, không lấy token. Email người tạo đã được che. Tổng quan tài khoản xem `metricool.md`.

## 1. Metricool lưu bài như thế nào (dữ liệu thật)

App gọi các endpoint sau (tất cả GET, cùng tham số `userId=&blogId=`, xác thực bằng phiên đăng nhập):

| Màn hình | Endpoint |
|---|---|
| Calendar, List | `GET /api/v2/scheduler/posts?start=YYYY-MM-DDT00:00:00&end=YYYY-MM-DDT23:59:59&timezone=America%2FNew_York&extendedRange=true` (List mặc định 30 ngày) |
| Đếm hạn mức | `GET /api/v2/scheduler/counters` → `monthPublishedPostsByBrand`, `aiCopiesAttemptsUsedThisMonth`, ... |
| Best times | `GET /api/v2/scheduler/besttimes/{facebook\|instagram\|linkedin\|youtube\|tiktok\|twitter}?start=&end=&timezone=` → mảng `data` gồm ô theo `dayOfWeek` (1 = Chủ nhật) × giờ, kèm giá trị (app hiển thị %). Nên lấy tối đa 1 tuần mỗi lần |
| Khác | `scheduler/notifications-config`, `scheduler/calendars/assigned`, `scheduler/tasks/{userId}/counters`, `admin/profile` (brand: mạng đã nối, timezone), `profile/subscription` (gói) |
| Chi tiết 1 bài | Không thấy endpoint riêng. List trả đủ trường; API công khai có `GET/PUT/DELETE /api/v2/scheduler/posts/{id}` (Advanced) |

Tạo bài: `POST /api/v2/scheduler/posts` (API, chỉ gói Advanced) hoặc tool MCP `post_schedule_post`. Không gọi.

### Thống kê 43 bài trong 30 ngày qua
- Trạng thái: FB 21 `PUBLISHED`, **16 `ERROR`**, 4 `PENDING`; IG 19 `PUBLISHED`, 4 `PENDING`. Không có bài nháp.
- Lỗi FB tháng 10: `"Code: 400 - (#100) 0 does not resolve to a valid user ID"`. Lỗi nằm ở `providers[].detailedStatus`. Tool phải đọc trường này sau khi hẹn giờ.
- Mỗi bài 1 ảnh, `firstCommentText` luôn rỗng, `draft:false`, `autoPublish:true`.
- Ảnh từ `cdn.shopify.com/...` (tool ngoài đưa link), hoặc `static.metricool.com/common/...` (tải lên trong giao diện).

### Mẫu: bài đang chờ (FB+IG), rút gọn text
```json
{
  "id": 416269749,
  "publicationDate": { "dateTime": "2026-11-07T18:30:00", "timezone": "America/New_York" },
  "creationDate":    { "dateTime": "2026-11-04T04:36:00", "timezone": "America/New_York" },
  "text": "Is a polo business casual for women?\n\nIn most offices, yes. ... #BusinessCasual #WorkUniforms #CorporatePolo",
  "firstCommentText": "",
  "providers": [
    { "network": "facebook", "status": "PENDING", "detailedStatus": "Pending" },
    { "network": "instagram", "status": "PENDING", "detailedStatus": "Pending" }
  ],
  "media": ["https://cdn.shopify.com/s/files/1/0763/8112/6834/files/fb-womens-corporate-shirts-front-desk-dental-reception.jpg"],
  "mediaAltText": ["Dental clinic receptionist in a burgundy women's embroidered polo ..."],
  "autoPublish": true, "saveExternalMediaFiles": false, "shortener": false, "draft": false, "imageVariants": false,
  "twitterData": { "type": "POST" },
  "facebookData": { "type": "POST" },
  "instagramData": { "autoPublish": true, "type": "POST", "isAiGenerated": false },
  "hasNotReadNotes": false, "uuid": "607613902631749190",
  "creatorUserMail": "<redacted>", "creatorUserId": <user_id>, "brandTags": []
}
```
Bài chờ thứ hai (id 416269750, 2026-11-08 18:30) có cấu trúc giống hệt.

### Mẫu: bài đã đăng
```json
{
  "id": 410189344,
  "publicationDate": { "dateTime": "2026-11-03T09:00:00", "timezone": "America/New_York" },
  "text": "Are patterned golf shirts allowed on the course? ... #GolfPolo #GolfStyle #GolfTeam",
  "firstCommentText": "",
  "providers": [
    { "network": "facebook", "id": "122122992057292829", "status": "PUBLISHED",
      "publicUrl": "https://facebook.com/122121537627292829/posts/122122992057292829", "detailedStatus": "Published" },
    { "network": "instagram", "id": "https://www.instagram.com/p/DfSDRHoG-NS/", "status": "PUBLISHED",
      "publicUrl": "https://www.instagram.com/p/DfSDRHoG-NS/", "detailedStatus": "Published" }
  ],
  "media": ["https://cdn.shopify.com/s/files/1/0763/8112/6834/files/fb-patterned-golf-shirts-hero.jpg"],
  "mediaAltText": ["Golfers wearing patterned golf polos"],
  "autoPublish": true, "draft": false,
  "facebookData": { "type": "POST" },
  "instagramData": { "autoPublish": true, "type": "POST", "isAiGenerated": false }
}
```
Sau khi đăng, Metricool thêm `providers[].id` và `publicUrl`. Đây là dữ liệu cho bước "Đã đăng" (`mark-published.mjs`).

### CSV template
Không tải file template. Nút tải nằm trong hộp thoại Import CSV, và hộp thoại này không mở được ở chế độ chỉ đọc (trang calendar còn hay kẹt "Loading"). Các cột dưới đây lấy theo tài liệu (https://help.metricool.com/how-to-schedule-posts-in-batch-with-a-csv-file-in-metricool-3zwxj); **thứ tự cột phải lấy từ template thật** trước khi tool xuất CSV:
`Text, Date, Time, Draft, Facebook, Twitter, LinkedIn, GBP, Instagram, Pinterest, TikTok, YouTube, Threads, Bluesky, Picture Url 1..10, Alt text picture 1..10, Document title, First Comment Text, Instagram Post Type, Instagram Show Reel On Feed, Brand name`, cùng các cột nâng cao cho từng mạng.

## 2. Bảng ánh xạ

Nguồn: `social.json` = `<skill>/project/social.json`; `catalog` = `<skill>/workspace/catalog.json` → `posts[]`; `folder` = `<skill>/<post.folder>/`; `settings` = `social-autopilot/workspace/config/settings.json`.

| Trường Metricool (API / CSV) | Bắt buộc | Kiểu, định dạng | Nguồn của mình | Tình trạng |
|---|---|---|---|---|
| `blogId` (query) / `Brand name` | Có | int / tên brand chính xác, phân biệt hoa thường | `social.json.metricool.blog_id` | **Thiếu**: `metricool:{}`, chưa có brand DreamyVows/GRENHEIM trong Metricool |
| `userId` (query) | Có | int | `settings.metricool.user_id` (mỗi tài khoản một số) | Thiếu. Fortera là <user_id> |
| `X-Mc-Auth` header | Có (API) | token | settings, chỉ ở máy, không đưa vào Git | Gói Free không có. MCP dùng OAuth |
| `publicationDate.dateTime` / `Date`+`Time` | Có | `YYYY-MM-DDTHH:mm:ss` không có offset / `YYYY-MM-DD` + `HH:mm:ss` | Khung giờ trống tiếp theo trong `social.json.cadence.slots`, hoặc giờ tự động khi `slots` trống (`docs/metricool.md`, "Giờ đăng tự động") | Có (tự động). Catalog `schedule` tuỳ chọn |
| `publicationDate.timezone` | Có | tên IANA | `social.json.metricool.timezone`, nếu trống thì `cadence.timezone` | Có `America/Los_Angeles`; brand Fortera dùng New York. Thống nhất theo từng brand |
| `text` | Có | UTF-8, giữ `\n`, emoji được | `folder/content-<lang>.txt`, ngôn ngữ theo `channels[].lang` + `language_policy` | Có. Chưa chốt chỉ EN hay VN+EN |
| text riêng từng mạng | Không | API: mỗi mạng một bài, hoặc caption riêng qua MCP; CSV: mỗi dòng một mạng | `captions` theo mạng (tương lai) | Hiện chỉ có FB |
| `providers[].network` / cột `Facebook`, `Instagram`... | Có | `facebook`, `instagram`, `tiktok`, `youtube`, `linkedin`, `pinterest`, `threads`, `bluesky`, `twitter`, `gmb` / `TRUE` hoặc để trống | `social.json.channels[] where enabled` → `network` | Có FB. Mạng phải được nối trong brand Metricool. Không gửi ID trang, Metricool tự lấy |
| `media[]` / `Picture Url 1..10` | IG: có; FB: không | **URL công khai trỏ thẳng file** (jpg/png/mp4), tối đa 10 | `folder/<post.image>` → tải lên host công khai → URL | **Thiếu**: chỉ có file máy (`image.png`). Cần bước upload (Shopify Files / GitHub raw / R2) và lưu `catalog.image_url` |
| `saveExternalMediaFiles` | Không | bool | Hằng `true` (Metricool lưu bản sao, link ngoài có hỏng cũng không sao) | Fortera để false |
| `mediaAltText[]` / `Alt text picture N` | Không (nên có) | chuỗi, cùng thứ tự với media | catalog `image_alt` (mới) hoặc sinh từ prompt ảnh | **Thiếu** |
| `firstCommentText` / `First Comment Text` | Không | chuỗi | `social.json` (vd link sản phẩm) hoặc `catalog.product.url` | Chưa có quy tắc |
| `draft` / `Draft` | Không | bool / `TRUE` hoặc trống | Hằng `true` theo `metricool.default_mode="draft"` | Mặc định nháp |
| `autoPublish` | Có (API) | bool | `true`. IG cũng có `instagramData.autoPublish` | — |
| `facebookData.type` | Không | `POST` (`REEL`, `STORY` tuỳ mạng) | Suy ra từ loại media | Ảnh → `POST` |
| `instagramData.type` / `Instagram Post Type` | Có nếu bật IG | `POST`, `REEL`, `TRIAL_REEL`, `STORY` | Suy ra từ loại media | Chưa bật IG |
| `instagramData.isAiGenerated` | Không | bool | `catalog.ai_disclosure.ai_scene` | Có dữ liệu. `social.json.product_images.ai_disclosure_label` chưa chốt |
| `shortener` | Không | bool | Hằng `false` | — |
| `Document title` | Chỉ PDF LinkedIn | tối đa 58 ký tự | — | Không dùng |
| Kết quả: `id`, `providers[].status`, `detailedStatus`, `publicUrl` | (trả về) | `PENDING`, `PUBLISHED`, `ERROR` | Ghi vào `catalog.schedule{metricool_id, status, public_urls, error}` | **Thiếu**: catalog chưa có khối `schedule` |

### Điều kiện trước khi gửi
- `catalog.status == "approved"`, ảnh và caption mỗi ngôn ngữ đã duyệt.
- `social.json.enabled == true`.

## 3. Ví dụ POST-01 (DreamyVows)

> **CHỈ LÀ VÍ DỤ, KHÔNG GỬI.** POST-01 đang `awaiting_review`, `social.json` đang `enabled:false`, chưa có blog_id, chưa có URL ảnh công khai, chưa có giờ đăng. Giờ `2026-11-10 10:00` là giả định. Text dùng `content-en.txt` theo đề xuất "chỉ EN cho thị trường Mỹ" (chưa chốt).

Nguồn: `C:\hoangpq\vaniecom-workspace\skills\dreamyvows-skills\workspace\posts\POST-birthday-dinner-neon-sign\` (`content-en.txt`, `image.png`) và catalog `POST-01`.

### (a) JSON body, CHỈ LÀ VÍ DỤ, KHÔNG GỬI
`POST https://app.metricool.com/api/v2/scheduler/posts?blogId=<BLOG_ID_DREAMYVOWS>&userId=<USER_ID>` (header `X-Mc-Auth: <token>`; cần gói Advanced. Qua MCP thì đưa cùng các giá trị cho `post_schedule_post`.)
```json
{
  "publicationDate": { "dateTime": "2026-11-10T10:00:00", "timezone": "America/Los_Angeles" },
  "text": "The cake just landed in the middle of the table, three candles still burning, and everyone pulls their chairs a little closer.\n\nA small birthday dinner at your favorite spot doesn't need much: a few friends, one cake, and on the wall behind them, Happy Birthday glowing in pink with the guest of honor's name right underneath.\n\nThe \"Your Name\" line in the photo is where the real name goes. On our website, you type the name, pick the font, colors and size, and see the price update as you choose. Before our workshop builds it, we email you a digital proof to approve.\n\nPink letters on a warm cream wall stand out without feeling harsh. Every sign comes with a dimmer and a remote, so once everyone is seated, you can turn it down and let the dinner feel cozy.\n\nDreamyVows - Your words, made into light.\n\n🌐 Website: https://dreamyvows.com/\n\nIf there's a birthday coming up that you want to plan for someone, try typing their name on our website, or send us a message and we'll help you pick a lettering style that fits the party.\n\n#DreamyVows #BirthdayNeon #CustomNeonSign #BirthdayDinner",
  "firstCommentText": "",
  "providers": [ { "network": "facebook" } ],
  "media": [ "<PUBLIC_IMAGE_URL — chưa có, vd https://cdn.shopify.com/s/files/.../post-01-birthday-dinner-neon.png>" ],
  "mediaAltText": [ "<ALT_TEXT — chưa có>" ],
  "autoPublish": true,
  "saveExternalMediaFiles": true,
  "shortener": false,
  "draft": true,
  "facebookData": { "type": "POST" }
}
```

### (b) Dòng CSV, CHỈ LÀ VÍ DỤ, KHÔNG IMPORT
Thứ tự cột là minh hoạ, phải theo template thật. Ô boolean muốn FALSE thì để trống. Lưu UTF-8. Khi import chọn định dạng ngày `YYYY-MM-DD` và giờ `HH:mm:ss`. Múi giờ lấy theo brand trong Metricool, CSV không có cột timezone.
```csv
Text,Date,Time,Draft,Facebook,Instagram,Picture Url 1,Alt text picture 1,First Comment Text,Instagram Post Type,Brand name
"The cake just landed in the middle of the table, three candles still burning, and everyone pulls their chairs a little closer.

A small birthday dinner at your favorite spot doesn't need much: a few friends, one cake, and on the wall behind them, Happy Birthday glowing in pink with the guest of honor's name right underneath.

The ""Your Name"" line in the photo is where the real name goes. On our website, you type the name, pick the font, colors and size, and see the price update as you choose. Before our workshop builds it, we email you a digital proof to approve.

Pink letters on a warm cream wall stand out without feeling harsh. Every sign comes with a dimmer and a remote, so once everyone is seated, you can turn it down and let the dinner feel cozy.

DreamyVows - Your words, made into light.

🌐 Website: https://dreamyvows.com/

If there's a birthday coming up that you want to plan for someone, try typing their name on our website, or send us a message and we'll help you pick a lettering style that fits the party.

#DreamyVows #BirthdayNeon #CustomNeonSign #BirthdayDinner",2026-11-10,10:00:00,TRUE,TRUE,,<PUBLIC_IMAGE_URL>,<ALT_TEXT>,,,DreamyVows
```

## 4. Còn thiếu ở phía mình
1. **URL ảnh công khai**: chưa có bước upload và chưa có trường `image_url` trong catalog. Metricool không nhận file máy.
2. **blog_id / user_id cho từng brand**: DreamyVows và GRENHEIM chưa có brand trong Metricool. Gói Free của tài khoản hiện có đã dùng hết 1 brand cho Fortera.
3. **Giờ đăng**: `cadence.slots` trống thì tool tự chọn giờ theo mạng (`docs/metricool.md`); có thể ghi đè bằng slots từ best times.
4. **Alt text**: chưa có trường.
5. **Quy tắc first comment**: chưa có.
6. **Ngôn ngữ**: `one-post-bilingual` hay chỉ EN, chưa chốt.
7. **Timezone**: social.json để LA; brand Metricool có timezone riêng, phải khớp nhau.
8. **Nhãn AI**: `ai_disclosure_label` chưa chốt (IG có cờ `isAiGenerated`).
9. **Trạng thái sau khi gửi**: catalog cần lưu `metricool_id`, `status`, `detailedStatus` (bắt lỗi như 16 bài FB `ERROR` của Fortera) và `publicUrl`.
10. **CSV template thật**: cần người dùng tự tải trong Calendar > ⋯ > Import CSV để chốt thứ tự cột.
