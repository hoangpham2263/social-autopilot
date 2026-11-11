# Social Autopilot

Tự làm bài Facebook cho nhiều thương hiệu và hẹn giờ đăng qua Metricool.
Agent (Claude Code hoặc Codex) làm việc; app chỉ để xem, duyệt và quản lý.

## Cách hoạt động

```
1. Research   →  script crawl hết bài các trang tham khảo vào Library (bỏ trùng)
                →  agent lọc một lượt (giữ / bỏ, có lý do)
2. Create     →  từ Library làm ảnh + caption mới  →  To review
3. Approve    →  bạn duyệt trong app  →  lưu vào sổ bài của tool + đưa ảnh lên
4. Publish    →  Approved  →  lượt sau hẹn giờ trên Metricool  →  Scheduled  →  Posted
```

## Cài đặt (một lần)

1. Cài **Node.js 22+** và **Codex CLI** (đăng nhập ChatGPT).
2. Kết nối **Metricool MCP** cho agent:
   - Claude Code: thêm connector Metricool trong claude.ai.
   - Codex: `codex mcp add metricool --url https://ai.metricool.com/mcp` rồi `codex mcp login metricool`.
3. **Playwright MCP** gắn vào Chrome đã đăng nhập của bạn (`--extension`): Research chạy qua Chrome đó, không cần Chrome riêng hay `npm install`.
4. Mở app: nhấp đúp `start-app.cmd` (Windows) hoặc `start-app.command` (macOS).
   Thiếu gì thì app tự mở tab **Settings** để báo.

## Thêm một thương hiệu

1. Tạo brand trong Metricool và nối trang Facebook.
2. Có sẵn thư mục skill của brand (chuẩn `project-skill-standard`).
3. Chạy **Create & publish** một lần để tool tải danh sách brand từ Metricool.
4. Tab **Overview** → **Link skill** → chọn thư mục skill.
   Chấm xanh = sẵn sàng; chấm đỏ = còn thiếu (xem dòng Missing).

Tool không chép skill, chỉ trỏ tới thư mục skill và **chỉ đọc** nó (không bao giờ ghi vào skill). Bài đã duyệt nằm trong sổ bài của tool `workspace/posts/<brand>/`. Brand chưa nối skill thì không bao giờ được làm hay gửi bài.

## Dùng hằng ngày

1. Tab **Prompt** → chọn **Mode** (Research only / Create & publish / Publish approved), Agent, Brand → **Copy prompt**.
2. Dán vào Claude Code hoặc Codex mở trong thư mục tool. Khung **Run progress** dưới nút Copy hiện bước đang chạy, số ảnh/bài, thời gian và dòng cuối của lượt (tự cập nhật 3 giây một lần).
3. Tab **Posts** → **To review** → xem trước → **Approve** hoặc **Drop**.
4. Lần chạy Create & publish hoặc Publish approved sau hẹn giờ các bài **Approved** (chờ gửi) trên Metricool: chúng thành **Scheduled** (có id Metricool, không bao giờ gửi lại). Dưới nút Publish approved có dòng "Already on Metricool: N (never sent again)".

| Tab | Dùng để |
|---|---|
| Overview | Brand, skill, trạng thái, số bài |
| Library | Bài tham khảo đã crawl: Available (còn dùng được, thẻ ghi "new" hoặc "used N×") / Removed (không dùng nữa, kèm lý do); một bài có thể gợi ý nhiều bài (mỗi lần góc mới); Preview: **Make a post from this** (sang Prompt: Create & publish, 1 bài, `--items`, tuỳ chọn Scene-swap), Remove (lý do tuỳ chọn), Restore |
| Posts | Bài của mình: To review · Approved (chờ gửi) · Scheduled (trên Metricool) · Posted; bài album xem trước đủ mọi ảnh, ảnh bìa trước |
| Prompt | Lấy prompt để chạy |
| Settings | Tài khoản, yêu cầu, cài đặt tool |

**Crawl** (Research): *New posts* lấy bài mới (mặc định) · *Backfill older* lấy dần bài cũ · *Full rescan* đọc lại toàn bộ. Script `collect.mjs` lấy dữ liệu (fetch hoặc script in-page chạy qua Playwright MCP trong Chrome đã đăng nhập; Facebook chưa có script in-page nên lấy tay bằng Playwright MCP), rồi agent lọc cả lô (`store.mjs classify` / `verdict`): bài bị lọc nằm ở Library → Dropped kèm lý do; tab Log hiện "N kept · M filtered".

## Connecting Chrome
1. Install the **Playwright MCP Bridge** extension in the Chrome profile you want to use.
2. In the app, Prompt tab, choose that profile in the Chrome check line (it is the list of profiles found in your Chrome).
3. Click **Open Chrome (profile)**. The first time (and once per session), click **Connect** on the Playwright MCP Bridge page; if the agent says it is not connected it runs `node scripts/chrome-connect.mjs --url "<connect url>"` and waits for you to click Connect and say "connected".
4. Run the Chrome check (Copy check prompt).
The token (Settings > Playwright MCP) is optional: it only skips the Connect click. If no Playwright server exists in your `claude` CLI, that card can add one (`claude mcp add`, needs npx). Nothing is machine-specific: Chrome, its profiles and the `claude` CLI are discovered; override with `research.chrome_path`, `research.chrome_user_data_dir` and `claudeCli.command` in `workspace/settings.json` if needed.

## Playwright MCP token
The Chrome connection token (Playwright MCP Bridge extension) is entered in Settings > Playwright MCP (Chrome connection). The app sets it with the official `claude mcp` command after backing up `~/.claude.json` (`.sa-backup-<time>`, Restore button), keeps it only in `workspace/secrets/` (gitignored), and shows only the last 4 characters. Restart Claude Code after Apply.

## Quy tắc

- Luôn hẹn giờ thật, không làm nháp. Đăng mỗi ngày (`cadence.posts_per_day`, mặc định 1) ở giờ tốt nhất của Metricool cho brand; chưa có dữ liệu thì theo bảng nghiên cứu `config/best-times.json` (America/New_York). Không đặt giờ tay. Publish approved có Start: From today (mặc định trong app: giờ tốt nhất kế tiếp, chừa 15 phút; 1 bài/ngày chỉ giờ chính) / From tomorrow.
- Không logo trên sản phẩm, không nhãn AI.
- Ảnh được host ở repo công khai `social-autopilot-sources` (link raw GitHub); bản clone nằm trong tool ở `workspace/image-host` (tự clone từ `imageHost.remote_url` khi chưa có).
- Agent không bao giờ tự duyệt bài.

## Settings file

Tab **Settings** chỉ cho sửa **Plan ahead (days)** và **Auto-host images**. Các cài đặt chuẩn khác không hiện trên app; ai cần đổi thì sửa tay `workspace/settings.json` của máy (ghi đè lên mặc định `config/settings.json`, cùng khoá):

| Khoá | Ý nghĩa |
|---|---|
| `research.delay_seconds` | `[min, max]` giây nghỉ ngẫu nhiên (giữ cho tương thích) |
| `research.scroll_wait_seconds` | theo nền tảng, `[min, max]` giây Claude chờ giữa hai lần cuộn (Pinterest/Houzz/Etsy 2-4, Instagram/Facebook 5-10) |
| `research.dedupe` | ngưỡng trùng: `image_distance` (/256), `caption_similarity` (0–1) |
| `codex.command`, `codex.timeout_minutes` | lệnh chạy Codex, thời gian chờ tối đa |
| `codex.concurrency`, `codex.retry_wait_seconds` | số ảnh Codex làm cùng lúc trên cả máy (3), giây chờ trước khi thử lại khi Codex báo hết lượt (60) |
| `posts.images_per_post` | `[min, max]` số ảnh mỗi bài, chọn ngẫu nhiên (mặc định `[1, 3]`); thương hiệu đè trong `workspace/brands/<id>.json` `posts.images_per_post`. 1 ảnh = `image.png`; nhiều ảnh = `image-01.png` (bìa), `image-02.png`...; chữ trên ảnh luôn tiếng Anh |
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
- `docs/research.md` — một đường: Claude mở trang, cuộn, đọc bằng script trích xuất `collect.mjs` (adapter nền tảng), lọc
- `docs/metricool.md` — Metricool
- `docs/scheduled-prompt.md` — prompt mẫu
