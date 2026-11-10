# Social Autopilot

Tự làm bài Facebook cho nhiều thương hiệu và hẹn giờ đăng qua Metricool.
Agent (Claude Code hoặc Codex) làm việc; app chỉ để xem, duyệt và quản lý.

## Cách hoạt động

```
1. Research   →  script crawl hết bài các trang tham khảo vào Library (bỏ trùng)
                →  agent lọc một lượt (giữ / bỏ, có lý do)
2. Create     →  từ Library làm ảnh + caption mới  →  To review
3. Approve    →  bạn duyệt trong app  →  lưu vào skill + đưa ảnh lên
4. Publish    →  lượt chạy sau hẹn giờ trên Metricool  →  Queued  →  Posted
```

## Cài đặt (một lần)

1. Cài **Node.js 22+** và **Codex CLI** (đăng nhập ChatGPT).
2. Kết nối **Metricool MCP** cho agent:
   - Claude Code: thêm connector Metricool trong claude.ai.
   - Codex: `codex mcp add metricool --url https://ai.metricool.com/mcp` rồi `codex mcp login metricool`.
3. Research: chạy `npm install` một lần trong thư mục tool, rồi mở Chrome cho crawl bằng **`start-crawl-chrome.cmd`** (Windows) hoặc **`start-crawl-chrome.command`** (macOS), hoặc nút **Start crawl Chrome** ở Settings. Chrome mở với một profile riêng (`%LOCALAPPDATA%\social-autopilot-chrome` / `~/Library/Application Support/social-autopilot-chrome`) và cổng điều khiển 9222.

   Lần đầu đăng nhập Facebook (tài khoản phụ) trong cửa sổ đó bằng tay; cookie nằm trong profile Chrome, không vào repo. Kiểm tra: `node scripts/crawl-fb.mjs --check`. Chi tiết: `RUNBOOK.md` mục "Chrome cho crawl".
4. Mở app: nhấp đúp `start-app.cmd` (Windows) hoặc `start-app.command` (macOS).
   Thiếu gì thì app tự mở tab **Settings** để báo.

## Thêm một thương hiệu

1. Tạo brand trong Metricool và nối trang Facebook.
2. Có sẵn thư mục skill của brand (chuẩn `project-skill-standard`).
3. Chạy **Create & publish** một lần để tool tải danh sách brand từ Metricool.
4. Tab **Overview** → **Link skill** → chọn thư mục skill.
   Chấm xanh = sẵn sàng; chấm đỏ = còn thiếu (xem dòng Missing).

Tool không chép skill, chỉ trỏ tới thư mục skill. Brand chưa nối skill thì không bao giờ được làm hay gửi bài.

## Dùng hằng ngày

1. Tab **Prompt** → chọn **Mode** (Research only / Create & publish), Agent, Brand → **Copy prompt**.
2. Dán vào Claude Code hoặc Codex mở trong thư mục tool.
3. Tab **Posts** → **To review** → xem trước → **Approve** hoặc **Drop**.
4. Lần chạy Create & publish sau sẽ hẹn giờ các bài đã duyệt.

| Tab | Dùng để |
|---|---|
| Overview | Brand, skill, trạng thái, số bài |
| Library | Bài tham khảo đã crawl: Unused / Used / Dropped |
| Posts | Bài của mình: To review / Queued / Posted |
| Prompt | Lấy prompt để chạy |
| Settings | Tài khoản, yêu cầu, cài đặt tool |

**Crawl** (Research): *New posts* lấy bài mới (mặc định) · *Backfill older* lấy dần bài cũ · *Full rescan* đọc lại toàn bộ. Script `crawl-fb.mjs` crawl hết nhanh (agent không bấm từng bài), rồi agent lọc cả lô (`store.mjs classify` / `verdict`): bài bị lọc nằm ở Library → Dropped kèm lý do; tab Log hiện "N kept · M filtered".

## Quy tắc

- Luôn hẹn giờ thật, không làm nháp. Đăng mỗi ngày (`cadence.posts_per_day`, mặc định 1) ở giờ tốt nhất của Metricool cho brand; chưa có dữ liệu thì theo bảng nghiên cứu `config/best-times.json` (America/New_York). Không đặt giờ tay.
- Không logo trên sản phẩm, không nhãn AI.
- Ảnh được host ở repo công khai `social-autopilot-sources` (link raw GitHub); bản clone nằm trong tool ở `workspace/image-host` (tự clone từ `imageHost.remote_url` khi chưa có).
- Agent không bao giờ tự duyệt bài.

## Settings file

Tab **Settings** chỉ cho sửa **Plan ahead (days)** và **Auto-host images**. Các cài đặt chuẩn khác không hiện trên app; ai cần đổi thì sửa tay `workspace/settings.json` của máy (ghi đè lên mặc định `config/settings.json`, cùng khoá):

| Khoá | Ý nghĩa |
|---|---|
| `research.delay_seconds` | `[min, max]` giây nghỉ ngẫu nhiên giữa các thao tác khi crawl |
| `research.dedupe` | ngưỡng trùng: `image_distance` (/256), `caption_similarity` (0–1) |
| `research.browser` | Chrome cho crawl: `cdp`, `channel`, `fallback_tabs`, `stall_posts`, `max_scroll_steps` |
| `codex.command`, `codex.timeout_minutes` | lệnh chạy Codex, thời gian chờ tối đa |
| `ffmpeg.command` | lệnh ffmpeg (watermark, đọc WebP khi dedupe) |
| `skillsRoot` | thư mục chứa các skill thương hiệu |
| `remove_watermark.script` | script xoá metadata ảnh |
| `imageHost.path`, `imageHost.remote_url`, `imageHost.rawBase` | repo ảnh trong tool (mặc định `workspace/image-host`, repo git riêng, không lên git của tool), link git để tự clone khi máy chưa có, link công khai (https) của ảnh |

Sửa xong bấm Reload (hoặc mở lại app).

## Cấu trúc

```
start-app.cmd / .command   mở app
ui/, src/server.mjs        giao diện + máy chủ cục bộ
core/                      vỏ app (launch, setup, update)
scripts/                   các bước: research, store, ideas, draft, finalize, host-image, metricool-mcp…
prompts/                   mẫu prompt ảnh và caption
config/                    cài đặt mặc định + file mẫu
docs/                      tài liệu chi tiết
tests/                     npm test
workspace/                 dữ liệu riêng của máy (không lên git)
```

## Tài liệu

- `RUNBOOK.md` — từng bước của agent
- `AGENTS.md` — luật cho agent
- `docs/research.md` — crawl bằng script, lọc, crawl tay dự phòng
- `docs/metricool.md` — Metricool
- `docs/scheduled-prompt.md` — prompt mẫu
