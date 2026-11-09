# social-autopilot: thiết kế (v0.2, hai chế độ)

Ngày: 2026-11-07, sửa 2026-11-09 (kho nghiên cứu riêng từng thương hiệu; hai chế độ; bỏ bước duyệt; Metricool qua MCP cho mọi agent; app chỉ để xem/quản lý). Repo GitHub riêng tư. Các quyết định dưới đây của người dùng thắng mọi chỗ khác.

## 1. Hai chế độ + app

| Phần | Ai chạy | Gồm |
|---|---|---|
| **Chế độ 1: Chỉ nghiên cứu** | Agent có trình duyệt đã đăng nhập Facebook (Claude Code + Playwright MCP, hoặc Codex có MCP trình duyệt), chạy riêng, vd mỗi tuần | `research.mjs start` (stop rule, `known.json`) → agent crawl theo `docs/research.md` → `ingest` vào kho (bỏ trùng) → `result` từng nguồn → `report`. Không ý/bài |
| **Chế độ 2: Làm bài & đưa lên** | Claude Code hoặc Codex khi người dùng bảo (ChatGPT chỉ gửi nốt Metricool từ JSON payload); không mở Facebook | gửi nốt bài chưa gửi + đối chiếu Metricool → `ideas.mjs init` (bài kho `new`) → `draft.mjs` (ảnh Codex, caption) → `check` → `finalize.mjs run` (kiểm lại, ghi vào skill by `auto`, host ảnh) → `metricool-mcp.mjs payload` → `createScheduledPost` → `record` → `queue.mjs` |
| **App** (chỉ xem/quản lý) | Người dùng | `start-app.cmd` / `start-app.command` → `src/server.mjs` + `ui/index.html`: Tổng quan, Kho, Bài đã tạo, Prompt, Cài đặt. Không chạy bước quy trình nào |

- Nguồn duy nhất của quy trình: `RUNBOOK.md` + `scripts/*.mjs` (mỗi lệnh in một JSON, chạy lại không trùng). Prompt dán sẵn (2 chế độ × Claude Code / Codex / ChatGPT): `docs/scheduled-prompt.md`, app tab Prompt đọc thẳng file này.
- Không phụ thuộc agent: luật chung ở `AGENTS.md` (Codex đọc trực tiếp, Claude Code qua `CLAUDE.md`); chỉ công cụ ngoài khác nhau.
- Hai agent hoặc agent và app có thể chồng nhau: mọi đọc-sửa-ghi file chung có khoá (`<file>.lock`) và ghi nguyên tử.

## 2. Thương hiệu
- Chỉ dò trong `skillsRoot` (mặc định `C:/hoangpq/vaniecom-workspace/skills/`). Một thương hiệu = thư mục skill chuẩn có `SKILL.md`, `project/project.md`, `project/social.json`; chạy khi `enabled: true` **và** `scripts/check-skill.mjs --tool-ready` của skill đạt. Skill **không bao giờ được chép** vào tool: mỗi brand Metricool **trỏ tới** một thư mục skill (`skill_path` trong `workspace/metricool-brands.json`, đường dẫn là chuẩn; mục cũ chỉ có `skill_id` = `skillsRoot/<id>-skills`), tool đọc/ghi thẳng trong thư mục đó. Thêm cửa hàng = Tổng quan → **Chọn skill** (Tìm trong `C:hoangpqaniecom-workspace` sâu 2 tầng, mỗi thư mục kèm trạng thái Dùng được/Còn thiếu) hoặc `node scripts/skills.mjs link --brand "<tên Metricool>" --path <thư mục skill>`. **Ngắt kết nối** (`skills.mjs unlink`) chỉ bỏ liên kết, không đụng thư mục; từ đó không gửi gì của brand đó lên Metricool. Thư mục đã trỏ mà bị đổi tên/di chuyển: thẻ báo "Không tìm thấy thư mục skill", dùng Đổi skill.
- Dữ kiện thương hiệu chỉ nằm trong skill (tên trường theo `project-skill-standard/README.md`, mục "Khai báo social"): `research.sources[]`, `research.fb_account`, `channels[]`, `language_policy` (`review_langs`: chỉ để đọc, không đăng), `product_images` (`sources`, `ai_scenes_allowed`, `watermark`, `reference_redraw`), `caption_rules`, `cadence`, `metricool`. Không còn khối `approval`.
- Sửa `social.json` trong app (Cài đặt) hoặc `scripts/social.mjs`: chặn token/mật khẩu, chạy check-skill sau khi ghi, file mới sinh lỗi thì trả lại file cũ.

## 3. Kho nghiên cứu (`workspace/store/<brand>/`)
- `items.json`: mỗi bài một mục `S0001`: `source_id`, `post_url`, `alt_urls`, `post_ids`, `captured`, `posted_date`, `caption` (đã lọc U+034F/ký tự ẩn), `images[]`, `image_sha1[]`, `image_phash[]`, `caption_hash`, `status: new|used|rejected`, `used_by` (ý/bản nháp). `progress.json`: từng nguồn lần crawl cuối, kết quả, `reached_end`, bị chặn. `duplicates.json`: bài trùng không lưu (khớp bài nào, luật nào). `ideas.json`: ý của thương hiệu (`I001`...).
- Lượt crawl theo ngày `workspace/runs/<brand>/<date>/` chỉ là nhật ký. Dữ liệu cũ (refs.json theo ngày) chuyển vào kho bằng `store.mjs migrate` (bỏ trùng; bài đã thành bản nháp thì `used`).
- Bỏ trùng trên cả kho của thương hiệu: link/mã bài Facebook (cả `alt_urls`), SHA-1 ảnh, ảnh gần giống (dHash 256 bit, `scripts/phash.mjs`, không gói ngoài: PNG tự giải mã, JPEG qua System.Drawing/sips, WebP qua ffmpeg nếu có), caption giống hệt hoặc ≥ 90% (caption ≥ 40 ký tự). Ngưỡng ở `settings.research.dedupe`.
- Tăng dần: lần sau mỗi nguồn dừng khi gặp 3 bài liên tiếp đã có (trừ `--full`); `--since`, `--max-posts` khi người dùng chọn. Không giới hạn mặc định; vẫn nghỉ ngẫu nhiên và dừng ở checkpoint.
- Người dùng xem kho ở tab Kho, "Bỏ" bài không muốn dùng (`rejected`, không bao giờ thành ý); "Khôi phục" đưa về `new`.

## 3b. Kiểm tra tự động thay cho duyệt
Trạng thái bản nháp: `needs_prompt` → `generating` → `needs_caption` / `image_failed` → `ready` (`draft.mjs check`) → `approved` (`finalize.mjs run`) | `check_failed` | `rejected` (người dùng Bỏ trước khi ghi). Kiểm: ảnh sạch metadata (điểm ảnh không đổi), đủ caption từng ngôn ngữ, dòng Website + hashtag cố định, không Markdown/ký tự ẩn, không chép caption tham khảo, không nhãn AI, NO LOGO, watermark nếu bật, scene-swap đã xác nhận sạch logo; sau khi ghi: `check-post.mjs` của skill (payload Metricool chặn bài check-post lỗi). Bài lỗi dừng riêng.

## 4. Luật ảnh

**Mặc định `brand-image`**
- Ảnh sản phẩm là ảnh của chính thương hiệu (thư mục skill hoặc `product_images.sources`).
- Ảnh không khí không được là ảnh tham khảo.
- Dựng cảnh AI bật mặc định (chỉ `ai_scenes_allowed: false` mới tắt); không bao giờ gắn nhãn AI lên bài.

**Không logo trên sản phẩm**
- Prompt (`prompts/scene-edit.txt`, `scene-swap.txt`) có lệnh NO LOGO; `check` cảnh báo khi prompt thiếu lệnh này.
- Logo chỉ được thêm sau, là watermark nhỏ ở góc, bằng ffmpeg, khi `product_images.watermark.enabled` (mặc định tắt).

**Scene-swap** (opt-in `product_images.reference_redraw.enabled`; người dùng đã chấp nhận rủi ro bản quyền và bị báo cáo)
- Ảnh tham khảo của chính thương hiệu đó làm ảnh sản phẩm; chỉ đổi cảnh, xoá mọi logo, watermark, nhãn size, số điện thoại của shop.
- Bắt buộc `--brand-can-produce` khi `only_if_brand_can_produce`.
- Bắt buộc `confirm-clean` sau khi xem ảnh, khi `require_logo_removal`.
- Caption không được nhắc tên shop.
- App (Bài đã tạo) hiện ảnh gốc của shop cạnh ảnh mới.
- Catalog ghi `image_mode: scene-swap`, `source_shop`, `ai_disclosure: true`.

**Metadata**
- `C:/hoangpq/remove-watermark-skill` (`strip-png-metadata.mjs`, provider `chatgpt` cho ảnh Codex) chạy sau Codex, sau watermark và trước writeback.
- Giữ `image-generated.png` (ảnh gốc); `image.png` là bản sạch; report nằm bên cạnh.
- `check` không đạt khi điểm ảnh bị đổi hoặc còn metadata.
- Theo quy tắc của skill đó: chỉ bỏ metadata, không thêm EXIF giả, chỉ chạy trên máy, không tuyên bố đã qua được nhận diện AI. Không gắn nhãn AI lên bài; `ai_disclosure` trong catalog chỉ để lưu vết.
- `clean-image.mjs` của skill thương hiệu chỉ chạy khi `--check` chưa báo SẠCH.

**Host ảnh** (người dùng chốt 09/11/2026)
- Repo công khai `C:/hoangpq/social-autopilot-sources` (https://github.com/hoangpham2263/social-autopilot-sources, nhánh main; README ghi luật). Settings `imageHost`: `type: "github-repo"`, `path`, `rawBase`.
- Chỉ ảnh của bài đã ghi vào thương hiệu (catalog `approved`/`scheduled`/`published`); không bao giờ bản nháp hay ảnh tham khảo của đối thủ. Metadata đã bỏ (kiểm lại trước khi đẩy).
- `host-image.mjs publish`: chép, commit "<brand> <post-id>", push, chờ link raw trả 200 đúng nội dung (thử lại), ghi `media_url` (trường tuỳ chọn trong chuẩn, `check-post` kiểm là link https). Lỗi host không huỷ bài đã ghi.
- `host-image.mjs remove`: xoá file (commit + push) và bỏ `media_url`, **chỉ sau khi bài đã đăng** (Metricool không chép ảnh ngoài, bài vẫn trỏ về link raw).


## 5. Cấu trúc
```text
social-autopilot/
├── README.md, AGENTS.md, CLAUDE.md, RUNBOOK.md, package.json
├── start-app.cmd, start-app.command        mở app (Windows / macOS)
├── icon.svg, src/server.mjs, ui/index.html app: máy chủ cục bộ + trang (chỉ xem/quản lý)
├── core/                                   vỏ app: launch, setup (Node.js, Codex), webview2, update
├── .github/workflows/release.yml           tag v* → ZIP release cho nút Cập nhật
├── config/settings.json                    skillsRoot, research (delay_seconds, dedupe), metricool.default_mode, codex, ffmpeg, remove_watermark, imageHost
├── config/metricool-brands.json            các brand trong tài khoản Metricool, gắn với skill
├── scripts/                                chế độ 1: research, store, phash · chế độ 2: ideas, draft (+draft-lib), image-clean, finalize,
│                                           writeback, host-image, metricool-mcp, metricool-csv (dự phòng), queue · brands, sources, social, prompts, preview, lib
├── prompts/                                scene-edit.txt, scene-swap.txt, caption-brief.md, idea-abstract.md
├── docs/                                   plan.md, research.md, scheduled-prompt.md, metricool.md, metricool-mapping.md, metricool-csv-template.csv
├── tests/                                  cycle, host-image, server, server-security, metricool-csv, metricool-mcp, qa-bugs, fake-codex.mjs
└── workspace/ (git bỏ qua)                 settings.json, store/<brand>/, runs/<brand>/<date>/, drafts/, logs/
```

## 6. Còn lại
- DreamyVows và GRENHEIM: chỉ đăng tiếng Anh, tiếng Việt chỉ để đọc (`review_langs: ["vn"]`); giờ đăng tự động khi `cadence.slots` trống.
- Watermark và ảnh WebP (bỏ trùng) cần ffmpeg trên máy.
- Codex dùng Metricool cần `codex mcp add metricool --url https://ai.metricool.com/mcp` + `codex mcp login metricool`.

## 7. Rủi ro

| Rủi ro | Mức | Cách giảm |
|---|---|---|
| Điều khoản Meta cấm thu thập dữ liệu tự động khi chưa được phép (https://developers.facebook.com/docs/development/terms-and-policies/automated-data-collection/) | Cao | Người dùng chấp nhận (09/11/2026). Chế độ nghiên cứu chạy riêng, thưa (vd mỗi tuần), tăng dần (dừng ở bài đã có), nhịp như người, dừng ở checkpoint, tài khoản phụ. |
| Bản quyền ảnh, caption; scene-swap tăng rủi ro bị báo cáo | Cao | Ảnh đối thủ chỉ trong `workspace/`. Ý trừu tượng, chặn chép chữ. Scene-swap tắt mặc định, bắt xác nhận đã xoá logo. |
| Không còn người duyệt trước khi gửi | Trung bình | Kiểm tra tự động (mục 3b) + check-post; Metricool mặc định **nháp** (`metricool.default_mode`), không bài nào tự đăng cho tới khi người dùng đổi sang `schedule` hoặc tự hẹn giờ trong Metricool. App cho "Bỏ" trước khi ghi. |
| Ảnh AI bị hiểu là ảnh khách thật | Trung bình | Không gắn nhãn AI lên bài (người dùng chốt); `ai_disclosure` trong catalog để lưu vết nội bộ. |
| Hạn mức Codex | Thấp | `image_failed` ghi lý do; lượt sau làm tiếp. |

## 8. Metricool

Đường chính: MCP chính thức `https://ai.metricool.com/mcp` (gói Starter, không REST API), qua tool MCP của agent: connector claude.ai "Metricool" (Claude Code), connector Metricool của ChatGPT (từ JSON payload), hoặc `codex mcp add metricool --url https://ai.metricool.com/mcp` (Codex). `scripts/metricool-mcp.mjs payload|record|status`: tham số `createScheduledPost` chính xác, mặc định nháp, bài đã gửi không gửi lại, đối chiếu bằng `getScheduledPosts`. Fortera Apparel (blogId `<blog_id_1>`) bị chặn cứng. Chi tiết, kết quả thử thật và ánh xạ cột: `docs/metricool.md`, `docs/metricool-mapping.md`.

Dự phòng: `scripts/metricool-csv.mjs export|validate` (người tự nhập CSV), mẫu `docs/metricool-csv-template.csv`.

**Giá** (2026-11-07, https://metricool.com/pricing/)

| Gói | Giá | Brand | API |
|---|---|---|---|
| Free | $0 | 1 | không |
| Starter | khoảng $20–25/tháng | 5 | không |
| Advanced | khoảng $53–67/tháng | 15 | có |

**Không tự đăng được** (https://help.metricool.com/en/article/schedule-and-post-on-instagram-1xovmji/, https://help.metricool.com/pt/api-limitations-per-social-network-n7zlr)
- IG: tài khoản cá nhân; Story có link/sticker; Reel có nhạc ngoài thư viện; carousel có video trên 60 giây.
- FB: đăng vào Group.
- TikTok: xuống dòng, Story.
