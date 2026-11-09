# Social Autopilot

Tự làm bài Facebook cho nhiều thương hiệu và hẹn giờ đăng qua Metricool.
Agent (Claude Code hoặc Codex) làm việc; app chỉ để xem, duyệt và quản lý.

## Cách hoạt động

```
1. Research   →  crawl bài của các trang tham khảo vào Library (bỏ trùng)
2. Create     →  từ Library làm ảnh + caption mới  →  To review
3. Approve    →  bạn duyệt trong app  →  lưu vào skill + đưa ảnh lên
4. Publish    →  lượt chạy sau hẹn giờ trên Metricool  →  Queued  →  Posted
```

## Cài đặt (một lần)

1. Cài **Node.js 22+** và **Codex CLI** (đăng nhập ChatGPT).
2. Kết nối **Metricool MCP** cho agent:
   - Claude Code: thêm connector Metricool trong claude.ai.
   - Codex: `codex mcp add metricool --url https://ai.metricool.com/mcp` rồi `codex mcp login metricool`.
3. Cài **Playwright MCP** và đăng nhập Facebook trên Chrome (chỉ cần cho Research).
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

**Crawl** (Research): *New posts* lấy bài mới (mặc định) · *Backfill older* lấy dần bài cũ · *Full rescan* đọc lại toàn bộ.

## Quy tắc

- Luôn hẹn giờ thật, không làm nháp. Giờ đăng theo `cadence` của skill (mặc định America/New_York).
- Không logo trên sản phẩm, không nhãn AI.
- Ảnh được host ở repo công khai `social-autopilot-sources` (link raw GitHub).
- Agent không bao giờ tự duyệt bài.

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
- `docs/research.md` — cách crawl
- `docs/metricool.md` — Metricool
- `docs/scheduled-prompt.md` — prompt mẫu
