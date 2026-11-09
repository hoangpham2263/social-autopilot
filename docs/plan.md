# social-autopilot: thiết kế (bản cuối, v0.1)

Ngày: 2026-11-07, sửa 2026-11-09 (app trở lại làm giao diện chính, kiểu giao diện cũ; thêm bước host ảnh; dọn mã không dùng). Trạng thái: **đã xây bản đầu (demo)**, repo GitHub riêng tư.
Tool độc lập ở `C:/hoangpq/social-autopilot`. File này thay bản kế hoạch trước; các quyết định dưới đây của người dùng thắng mọi chỗ khác.

Việc của tool, cho từng thương hiệu: xem trang tham khảo → rút ý → làm ảnh và caption riêng của thương hiệu → người duyệt duyệt → lưu bài đã duyệt vào `workspace/posts/` và `catalog.json` của thương hiệu. **Metricool**: chưa đăng; chỉ xuất CSV cho người nhập (mục 8).

## 1. Script headless + app

| Phần | Ai dùng | Gồm |
|---|---|---|
| **Headless (nguồn duy nhất)** | Agent theo lịch: Claude Code scheduled task/routine, Codex/ChatGPT automation; agent trong chat | `RUNBOOK.md` + `scripts/*.mjs` (mỗi lệnh in một JSON, chạy lại không trùng) + `docs/scheduled-prompt.md` |
| **App (cách chạy duy nhất)** | Người dùng | `start-app.cmd` (Windows, cửa sổ WebView2) / `start-app.command` (macOS) → `src/server.mjs` (127.0.0.1) + `ui/index.html`; vỏ `core/` (launch, Cấu hình, webview2, Cập nhật). Gọi đúng hàm của `scripts/`: duyệt/bỏ, sửa social.json, đưa ảnh lên, cài đặt; đọc dữ liệu mới mỗi lần mở trang |

- App khôi phục từ commit 0db4530 (người dùng chọn 09/11/2026: chạy như app như trước) và nối với mọi thứ thêm sau (scene-swap, làm sạch metadata, host ảnh); giao diện giữ kiểu cũ (`core/assets/tool.css`). Quản lý cũng làm được qua chat với agent hoặc script.
- 09/11/2026 người dùng chốt một cách chạy: bỏ dashboard tĩnh (`dashboard.html`, `open-dashboard.cmd`); app chạy trên Windows và macOS. Vòng chạy không dựng trang nào; app hiện dữ liệu sống.
- Agent theo lịch và lệnh chạy tay có thể chồng nhau: mọi đọc-sửa-ghi file chung có khoá (`<file>.lock`) và ghi nguyên tử.

## 2. Thương hiệu
- Chỉ dò trong `skillsRoot` (mặc định `C:/hoangpq/vaniecom-workspace/skills/`). Một thương hiệu = thư mục skill chuẩn có `SKILL.md`, `project/project.md`, `project/social.json`.
- Chạy trong lịch khi `enabled: true` **và** `scripts/check-skill.mjs --tool-ready` của skill đạt. Tool in đúng những gì skill báo còn thiếu.
- Dữ kiện thương hiệu chỉ nằm trong `skills\<brand>\project\social.json` (giọng, website, hashtag trong `project.md` cạnh nó); repo tool không chứa dữ kiện thương hiệu nào. Tên trường theo `project-skill-standard/README.md` (mục "Khai báo social"):
  - `research.sources[]`, `research.max_per_day`, `research.fb_account`;
  - `channels[]`, `language_policy`;
  - `product_images`: `sources`, `ai_scenes_allowed`, `watermark`, `reference_redraw`;
  - `caption_rules.project_md_sections`, `cadence`, `approval`.

  Giọng, website, hashtag lấy từ `project.md`. Tool không giữ dữ kiện thương hiệu nào và không có code riêng cho thương hiệu nào.
- Sửa `social.json` qua chat với agent hoặc `scripts/social.mjs`. Quy tắc lưu:
  - chặn token và mật khẩu;
  - chạy check-skill sau khi ghi;
  - nếu file mới sinh lỗi mới thì trả lại file cũ.

## 3. Quy trình (giống nhau mọi thương hiệu, chi tiết trong RUNBOOK.md)
0. **Mở vòng:** `approve.mjs sync`, `brands.mjs`, `sources.mjs`.
1. **Nghiên cứu.**
   - `research.mjs start`, có giới hạn trong code: `max_per_day` của thương hiệu, số nguồn mỗi lượt, số bài mỗi nguồn, số bài mỗi ngày cho mọi thương hiệu cộng lại.
   - Agent đọc Facebook bằng Playwright theo `docs/research.md`.
   - `research.mjs ingest` lọc U+034F và ký tự ẩn, bỏ trùng, ghi vào `workspace/runs/<brand>/<date>/<source-id>/`.
2. **Ý tưởng:** `ideas.mjs` tạo ý trừu tượng, chặn chép chữ, số điện thoại, link, tên shop.
3. **Bản nháp**, theo thứ tự:
   1. `draft.mjs new`;
   2. agent điền mô tả sản phẩm vào prompt;
   3. `draft.mjs image` (Codex CLI);
   4. tự làm sạch metadata (remove-watermark-skill);
   5. `watermark`, chỉ khi thương hiệu bật;
   6. `confirm-clean`, chỉ với scene-swap;
   7. viết caption theo skill của thương hiệu;
   8. `draft.mjs check` → `awaiting_approval`.
4. **Duyệt:** nút Duyệt/Bỏ trong app hoặc chat (`approve.mjs approve|reject`), cùng hàm. Người duyệt phải khớp `approval.owner`; bỏ thì phải ghi lý do.
5. **Ghi vào thương hiệu:** `writeback.mjs` tạo `workspace/posts/POST-<slug>/` và một mục `approved` trong `catalog.json` (`inspiration`, `image_mode`, `ai_disclosure`, `approval`), rồi chạy `check-post.mjs` của skill.
5b. **Host ảnh:** `host-image.mjs publish` (tự chạy sau write-back): ảnh bài đã duyệt lên repo công khai `social-autopilot-sources` (`<brand>/<yyyy>/<mm>/<post-id>.<ext>`), push, chờ HTTP 200, ghi `media_url` vào catalog. Xem mục 4, "Host ảnh".
6. **Báo cáo:** `queue.mjs` liệt kê bản chờ duyệt (ảnh, caption, link tham khảo; scene-swap kèm ảnh gốc của shop), bài đã ghi, lỗi.
7. **Kết thúc:** nhắc người dùng mở app để duyệt; app hiện bài đã duyệt với link ảnh hoặc "chưa có link".
8. **Metricool:** chưa đăng tự động; `metricool-csv.mjs` xuất CSV từ bài đã duyệt có `media_url` (xem mục 8).

## 4. Luật ảnh

**Mặc định `brand-image`**
- Ảnh sản phẩm là ảnh của chính thương hiệu (thư mục skill hoặc `product_images.sources`).
- Ảnh không khí không được là ảnh tham khảo.
- Chỉ dựng cảnh AI khi `ai_scenes_allowed: true`.

**Không logo trên sản phẩm**
- Prompt (`prompts/scene-edit.txt`, `scene-swap.txt`) có lệnh NO LOGO; `check` cảnh báo khi prompt thiếu lệnh này.
- Logo chỉ được thêm sau, là watermark nhỏ ở góc, bằng ffmpeg, khi `product_images.watermark.enabled` (mặc định tắt).

**Scene-swap** (opt-in `product_images.reference_redraw.enabled`; người dùng đã chấp nhận rủi ro bản quyền và bị báo cáo)
- Ảnh tham khảo của chính thương hiệu đó làm ảnh sản phẩm; chỉ đổi cảnh, xoá mọi logo, watermark, nhãn size, số điện thoại của shop.
- Bắt buộc `--brand-can-produce` khi `only_if_brand_can_produce`.
- Bắt buộc `confirm-clean` sau khi xem ảnh, khi `require_logo_removal`.
- Caption không được nhắc tên shop.
- Người duyệt xem ảnh gốc và ảnh mới cạnh nhau.
- Catalog ghi `image_mode: scene-swap`, `source_shop`, `ai_disclosure: true`.

**Metadata**
- `C:/hoangpq/remove-watermark-skill` (`strip-png-metadata.mjs`, provider `chatgpt` cho ảnh Codex) chạy sau Codex, sau watermark và trước writeback.
- Giữ `image-generated.png` (ảnh gốc); `image.png` là bản sạch; report nằm bên cạnh.
- `check` không đạt khi điểm ảnh bị đổi hoặc còn metadata.
- Theo quy tắc của skill đó: chỉ bỏ metadata, không thêm EXIF giả, chỉ chạy trên máy, không tuyên bố đã qua được nhận diện AI. Không gắn nhãn AI lên bài; `ai_disclosure` trong catalog chỉ để lưu vết.
- `clean-image.mjs` của skill thương hiệu chỉ chạy khi `--check` chưa báo SẠCH.

**Host ảnh** (người dùng chốt 09/11/2026)
- Repo công khai `C:/hoangpq/social-autopilot-sources` (https://github.com/hoangpham2263/social-autopilot-sources, nhánh main; README ghi luật). Settings `imageHost`: `type: "github-repo"`, `path`, `rawBase`.
- Chỉ ảnh của bài đã được người duyệt (catalog `approved`/`scheduled`/`published`); không bao giờ bản nháp hay ảnh tham khảo của đối thủ. Metadata đã bỏ (kiểm lại trước khi đẩy).
- `host-image.mjs publish`: chép, commit "<brand> <post-id>", push, chờ link raw trả 200 đúng nội dung (thử lại), ghi `media_url` (trường tuỳ chọn trong chuẩn, `check-post` kiểm là link https). Lỗi host không huỷ duyệt.
- `host-image.mjs remove`: xoá file (commit + push) và bỏ `media_url`, **chỉ sau khi bài đã đăng** (Metricool không chép ảnh ngoài, bài vẫn trỏ về link raw).

## 5. Cấu trúc
```text
social-autopilot/
├── README.md, AGENTS.md, CLAUDE.md, RUNBOOK.md, package.json
├── start-app.cmd, start-app.command        mở app (nhấp đúp; Windows / macOS)
├── icon.svg                                biểu tượng app
├── src/server.mjs, ui/index.html           app: máy chủ cục bộ + trang
├── core/                                   vỏ app: launch, setup (Node.js, Codex), webview2, update
├── .github/workflows/release.yml           tag v* → ZIP release cho nút Cập nhật
├── config/metricool-brands.json            các brand trong tài khoản Metricool (ghi tay), gắn với skill
├── config/settings.json                    chung: skillsRoot, giới hạn, codex, ffmpeg, remove_watermark, luật duyệt
├── scripts/                                brands, sources, social, research, ideas, draft (+draft-lib), image-clean,
│                                           queue, approve, writeback, host-image, metricool-csv, preview, lib
├── prompts/                                scene-edit.txt, scene-swap.txt, caption-brief.md, idea-abstract.md
├── docs/                                   plan.md, research.md, scheduled-prompt.md, metricool*.md/csv, examples/
├── tests/                                  cycle, host-image, server, server-security, metricool-csv tests, fake-codex.mjs
└── workspace/ (git bỏ qua)                 settings.json, research-log.json, runs/, drafts/, logs/
Dữ kiện thương hiệu: chỉ ở C:/hoangpq/vaniecom-workspace/skills/<brand>/project/social.json (+ project.md).
```

## 6. Còn lại
- Publish qua Metricool (mục 8), làm sau; app có thể thêm lịch đăng khi đó.
- Bật từng thương hiệu: điền `approval.owner`, `ai_scenes_allowed`, `cadence.slots`, nguồn tham khảo (GRENHEIM), rồi đặt `enabled: true`.
- Watermark cần ffmpeg trên máy; lúc xây, ffmpeg chưa có trên PATH.
- `research.max_per_day` > 1 chưa có tác dụng, vì mỗi ngày chỉ có một thư mục lượt.

## 7. Rủi ro

| Rủi ro | Mức | Cách giảm |
|---|---|---|
| Điều khoản Meta cấm thu thập dữ liệu tự động khi chưa được phép, kể cả khi đã đăng nhập (https://developers.facebook.com/docs/development/terms-and-policies/automated-data-collection/, https://about.fb.com/news/2021/04/how-we-combat-scraping/) | Cao | Giới hạn trong code (bài/ngày cho mọi thương hiệu, lượt/ngày theo thương hiệu). Nhịp như người, dừng khi gặp checkpoint, dùng tài khoản phụ, chế độ `semi-auto`. |
| Bản quyền ảnh, caption, thiết kế; scene-swap tăng rủi ro bị báo cáo | Cao | Ảnh đối thủ chỉ nằm trong `workspace/` (Git bỏ qua). Scene-swap tắt mặc định, bật theo từng thương hiệu, bắt xác nhận đã xoá logo, người duyệt xem ảnh gốc cạnh ảnh mới. |
| Ảnh AI bị hiểu là ảnh khách thật | Trung bình | Không gắn nhãn AI lên bài (người dùng chốt 09/11/2026); chỉ ghi `ai_disclosure` trong catalog để lưu vết nội bộ. |
| Agent theo lịch và lệnh chạy tay ghi cùng lúc | Trung bình | Khoá file và ghi nguyên tử. |
| Hạn mức Codex | Thấp | Trạng thái `image_failed` ghi lý do; vòng sau chạy tiếp. |

## 8. Metricool (đường CSV đã thử; đăng tự động chưa làm)

Trạng thái và kết quả thử thật: `docs/metricool.md`; ánh xạ cột: `docs/metricool-mapping.md`; mẫu: `docs/metricool-csv-template.csv`. Đang dùng: `scripts/metricool-csv.mjs export|validate` (người tự nhập CSV vào Metricool). Dưới đây là các đường tự động hoá chưa làm.

**MCP chính thức** `https://ai.metricool.com/mcp`
- Cài: `claude mcp add --transport http metricool https://ai.metricool.com/mcp`, đăng nhập OAuth.
- Dùng được mọi gói, kể cả Free (1 brand, 20 bài/tháng).
- Làm được: xem brand, xem lịch, xem giờ tốt nhất, tạo và sửa bài hẹn giờ, tạo bài chờ duyệt.
- Chưa xác minh đính kèm ảnh qua MCP.
- Nguồn: https://metricool.com/metricool-mcp/, https://help.metricool.com/mcp-limits-and-plan-requirements-h72jg, https://help.metricool.com/faqs-about-the-metricool-mcp-1i3w0

**REST API** (chỉ gói Advanced/Custom; Zapier/Make cũng vậy)
- Lệnh gọi: `POST https://app.metricool.com/api/v2/scheduler/posts?blogId=&userId=`, header `X-Mc-Auth`.
- Body: `publicationDate{dateTime,timezone}`, `text`, `providers[{network}]`, `autoPublish`, `draft`, `media[URL công khai]`, `saveExternalMediaFiles`.
- Không gọi được từ trình duyệt (CORS). Tài liệu công khai không có endpoint tải ảnh hay rate limit.
- Nguồn: https://help.metricool.com/plans-add-ons-and-api-access-explained-xux1u, https://help.metricool.com/wli-scheduler-endpoint-example-on-a-custom-backend-proxy-frko7, https://app.metricool.com/resources/apidocs/index.html

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

**Khi làm**
- Thêm bước đăng tự động (script; app hiện lịch đăng).
- Điền khối `metricool` trong `social.json`.
- Chỉ đăng bài `approved`; mặc định tạo nháp.
- Catalog thêm `schedule.<network>` và trạng thái `scheduled`; `check-post` đã nhận các trường này.
- Ảnh: dùng `media_url` của catalog (host-image.mjs đã làm), Metricool không chép ảnh ngoài, nên chỉ `host-image.mjs remove` sau khi bài đã đăng.
