# Metricool: ánh xạ dữ liệu bài đăng

Cách một bài trong catalog của skill thành tham số Metricool (MCP `createScheduledPost`, hoặc một dòng CSV dự phòng). Không ghi dữ liệu của tài khoản nào; id và giờ trong ví dụ là minh hoạ. Tổng quan: `docs/metricool.md`.

## 1. Metricool lưu bài như thế nào

Một bài trong Metricool (rút gọn, giá trị minh hoạ):
```json
{
  "id": 400000001,
  "uuid": "<uuid>",
  "publicationDate": { "dateTime": "2026-11-17T10:00:00", "timezone": "America/Los_Angeles" },
  "text": "...",
  "firstCommentText": "",
  "providers": [
    { "network": "facebook", "status": "PENDING", "detailedStatus": "Pending" }
  ],
  "media": ["https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<brand>/2026/11/POST-xx.png"],
  "mediaAltText": ["..."],
  "autoPublish": true, "draft": false, "shortener": false,
  "facebookData": { "type": "POST" },
  "instagramData": { "autoPublish": true, "type": "POST", "isAiGenerated": false }
}
```
- `providers[].status`: `PENDING`, `PUBLISHED`, `ERROR`; lý do lỗi ở `providers[].detailedStatus`. Tool đọc qua `getScheduledPosts` (`metricool-mcp.mjs status`).
- Sau khi đăng, Metricool thêm `providers[].id` và `publicUrl`: dữ liệu cho `mark-published.mjs` của skill (Posted).

## 2. Bảng ánh xạ

Nguồn: `social.json` = `<skill>/project/social.json`; `catalog` = `<skill>/workspace/catalog.json` → `posts[]`; `folder` = `<skill>/<post.folder>/`; `brands` = `workspace/metricool-brands.json` (do `sync-brands` ghi).

| Trường Metricool (MCP / CSV) | Bắt buộc | Kiểu, định dạng | Nguồn của tool |
|---|---|---|---|
| `blogId` / `Brand name` | Có | id / tên brand chính xác | `brands` (brand đã trỏ tới skill), hoặc `social.json.metricool.blog_id`. Brand `excluded`/`removed` bị chặn |
| `date` (MCP) | Có | ISO kèm offset | Giờ đã lập (`schedule`, `cadence.slots` hoặc giờ tự động) + offset của `cadence.timezone` |
| `publicationDate.dateTime` / `Date`+`Time` | Có | `YYYY-MM-DDTHH:mm:ss` / `YYYY-MM-DD` + `HH:mm:ss` | Như trên; CSV quy đổi sang múi giờ brand |
| `publicationDate.timezone` | Có | tên IANA | `cadence.timezone` (múi giờ khách) |
| `text` / `Text` | Có | UTF-8, giữ `\n` | `folder/content-<lang>.txt` của ngôn ngữ đăng (`channels[].lang`); không bao giờ `review_langs`, không nhãn AI |
| `providers[].network` / cột mạng | Có | `facebook`, `instagram` (MCP); cột TRUE (CSV) | `social.json.channels[]` bật; mạng phải đã nối trong brand |
| `media[]` / `Picture Url 1..10` | IG: có | link https công khai, không WebP, tối đa 10 | catalog `media_url` / `video_url` (link raw GitHub do `host-image.mjs` ghi khi Approve) |
| `mediaAltText[]` / `Alt text picture N` | Nên có | chuỗi, cùng thứ tự media | catalog alt của ảnh |
| `firstCommentText` | Không | chuỗi | Trống |
| `draft` / `Draft` | — | bool | Luôn `false` (bài hẹn giờ thật) |
| `autoPublish` | Có | bool | `true` |
| `facebookData.type` / `Facebook Post Type` | Không | `POST`, `REEL` | Suy ra từ media (REEL chỉ khi video 9:16) |
| `instagramData.type` / `Instagram Post Type` | Có nếu bật IG | `POST`, `REEL` | Suy ra từ media |
| `instagramData.isAiGenerated` | Không | bool | Luôn `false` (không nhãn AI) |
| `shortener` | Không | bool | `false` |
| Kết quả `id`, `uuid`, `plannerUrl`, `publicationDate` | (trả về) | | `record` ghi vào catalog `metricool.<network>` + `schedule.<network>` |

### Điều kiện trước khi gửi
- Catalog `approved` (người dùng đã Approve trong app), có `media_url`/`video_url`, `check-post.mjs` không lỗi, chưa có `metricool.<network>.id`.
- `social.json.enabled == true`, brand đã trỏ skill, không `excluded`.
- Giờ đăng sau hôm nay (theo múi giờ khách).

## 3. Ví dụ (minh hoạ, không gửi)

Ví dụ một thương hiệu đèn neon (vd DreamyVows), đăng tiếng Anh, chỉ Facebook. Item của `payload`:
```json
{
  "post": "POST-01",
  "tool": "createScheduledPost",
  "args": {
    "blogId": "<blogId>",
    "date": "2026-11-17T10:00:00-08:00",
    "info": "{\"autoPublish\":true,\"draft\":false,\"media\":[\"https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<brand>/2026/11/POST-01.png\"],\"mediaAltText\":[\"...\"],\"providers\":[{\"network\":\"facebook\"}],\"publicationDate\":{\"dateTime\":\"2026-11-17T10:00:00\",\"timezone\":\"America/Los_Angeles\"},\"text\":\"...\",\"facebookData\":{\"type\":\"POST\"}}"
  },
  "record": "node scripts/metricool-mcp.mjs record --brand <id> --post POST-01 --id <id> --uuid <uuid> --planner-url <plannerUrl> --publication <publicationDate.dateTime> --tz <publicationDate.timezone>"
}
```

Dòng CSV tương ứng (dự phòng; thứ tự cột theo `docs/metricool-csv-template.csv`, ô FALSE để trống, CSV không có cột timezone):
```csv
Text,Date,Time,Draft,Facebook,...,Picture Url 1,...,Alt text picture 1,...,Brand name
"...",2026-11-18,01:00:00,,true,...,<media_url>,...,<alt>,...,<tên brand Metricool>
```
