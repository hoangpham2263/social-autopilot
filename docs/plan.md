# social-autopilot: kế hoạch

Ngày: 2026-11-07. Trạng thái: KẾ HOẠCH. Chưa xây, chưa di chuyển thư mục, chưa commit.
Tool độc lập, cùng khuôn với Product Review và Product Video. Nằm ở `C:\hoangpq\social-autopilot`, repo riêng `hoangpham2263/social-autopilot`.

Việc của tool, làm cho từng thương hiệu:
1. Xem các trang tham khảo hoặc đối thủ.
2. Rút ra loại sản phẩm, mẫu thiết kế, góc chụp và kiểu bài.
3. Làm phiên bản riêng của thương hiệu: ảnh riêng, caption theo giọng thương hiệu.
4. Người duyệt duyệt bài.
5. Lưu bài đã duyệt vào `workspace/posts/` và `catalog.json` của thương hiệu.
6. **Giai đoạn sau:** lên lịch qua Metricool (mục 10). Hiện chưa có tài khoản, nên chưa làm.

DreamyVows (neon) chạy thử trước, GRENHEIM (đồ gỗ) theo sau, cùng một quy trình.

---

## 0. Nguyên tắc

1. **Một quy trình cho mọi thương hiệu.**
   - Các bước, scripts, prompt, định dạng file và bước duyệt giống hệt nhau.
   - Chỉ có hai thứ khác, và cả hai nằm trong thư mục skill của thương hiệu:
     1. `project/social.json`, theo khuôn của chuẩn.
     2. Hồ sơ và tài sản: `project/project.md`, `project/sources/`, bài trong `workspace/`.
   - Không có nhánh code hay bước riêng cho thương hiệu nào.
2. **Thêm thương hiệu = đặt thư mục skill chuẩn vào `vaniecom-workspace/skills/`.** Không cần làm gì thêm (mục 3).
3. **Một khuôn tool.** Dùng lại nguyên vỏ chung của Product Review và Product Video. Chỉ thêm `src/`, `ui/`, `data/` và `AGENTS.md` riêng (mục 2).
4. **Trang tham khảo chỉ là nguồn cảm hứng.** Không đăng lại ảnh, caption, thiết kế hay logo của họ. Mỗi bài là thiết kế và câu chữ của chính thương hiệu.
5. **Duyệt trước khi lưu thành bài.** Bài chỉ vào `workspace/posts/` của thương hiệu khi người duyệt (khai trong `social.json`) đã duyệt ảnh và caption. Bản nháp và lượt chạy nằm trong `workspace/` của tool.
6. **Một Chrome, một agent.** Các thương hiệu chạy nối tiếp.
7. **Thử 1 bài trước** cho mỗi thương hiệu mới. Chờ duyệt rồi mới chạy loạt.

---

## 1. Tên, repo, cổng

- **Tên:** `social-autopilot` (đã chốt). Tên hiển thị: "Social Autopilot".
- **Repo:** `hoangpham2263/social-autopilot`. Release `social-autopilot.zip` qua tag `vX.Y.Z`. Trang tải `docs/index.html` trên GitHub Pages, giống hai tool kia.
- **Cổng bridge: 8795.** Hiện các tool dùng: Tools Hub 8765, Product Review 8775, Product Video 8785. 8795 chưa tool nào dùng (đã grep `C:\hoangpq`).
- **Cổng máy chủ app:** dùng đúng cơ chế của khuôn: `47000 + sha1(thư mục) % 1000`, biến môi trường riêng `SA_PORT`. Cổng thật ghi ở `workspace/server-address.json`.
- **Kho dùng chung (`-sources`, `-results`):** chưa cần.
  - Ảnh tham khảo của đối thủ không được đưa lên repo nào.
  - Bài cuối nằm trong repo vaniecom-workspace (skill thương hiệu).
  - Nếu sau này cần kho ảnh không khí (stock, đúng bản quyền) dùng chung nhiều máy, mới tạo `social-autopilot-sources` theo mẫu `product-video-sources`.

---

## 2. Khuôn tool chung: so sánh Product Review và Product Video

### 2.1 Phần chung

Nguồn gốc là `tools-hub/hub/`. Phần này được chép vào `core/` của từng tool khi tool tách khỏi Tools Hub.

| Phần | Ở đâu | Hai tool khác nhau thế nào |
|---|---|---|
| Khởi chạy | `start-app.cmd` (giống hệt), `start-app.command` (khác 6 dòng), `core/launch.ps1` (cửa sổ WinForms + WebView2, `core/webview2/`) | Tên tool, đường dẫn máy chủ (`src/mac/server.mjs` hay `src/server.mjs`), tên biến cổng (`PR_PORT`/`GV_PORT`), tên service |
| Máy chủ app | `src/.../server.mjs` (Node, phục vụ UI và `/api/*`), `core/server-health.ps1`, `core/platform.mjs`, `core/browser.mjs` | Chỉ khác tên và đường dẫn |
| Bridge + extension Chrome | `core/bridge/{server,ensure}.mjs`, `core/extension/` (background.js, sites/) | Cổng (8775/8785), tên extension, danh sách site |
| Gọi AI | `core/ai/ai.ps1` + `common.ps1` (giống hệt) + `providers/` | `ai.ps1` khác 2 dòng |
| Cấu hình | `core/setup/` (`config.ps1` giống hệt; `page.html`/`page.js` khác danh sách AI cần đăng nhập) | Danh sách AI: Review dùng Codex/Google/Antigravity, Video dùng Grok |
| Giao diện | `core/assets/tool.css` (giống hệt); `core/assets/hub.js` (nút Cập nhật/Cấu hình/Tải lại) | `hub.js` chỉ có ở Product Video |
| Cập nhật | `core/update.ps1` (tải Release mới nhất, giữ `workspace/`, `core/bridge/node_modules`, gộp bài học `AGENTS.md`) | Tên repo và tên file zip |
| Phát hành | `.github/workflows/release.yml`, `docs/index.html` | Tên zip |
| Quy ước | `AGENTS.md` (mục Cấu trúc, Workflow, bài học; commit chỉ đứng tên người dùng), `CLAUDE.md` chứa `@AGENTS.md`, `readme.md` ngắn, `icon.svg`/`icon.png`, `tests/` | Nội dung riêng mỗi tool |
| Dữ liệu máy | `workspace/` (Git bỏ qua): `config/`, `logs/`, `output/`, `temp/`, `server-address.json`, `giao-dien.json` | Thư mục con riêng mỗi tool |

### 2.2 Cách giữ đồng bộ hiện nay

**Chưa có khuôn chính thức.** `core/` được chép tay từ `tools-hub/hub` rồi sửa tên, cổng và repo. Không có script đồng bộ, không có repo khuôn. Hiện đã lệch nhau:
- `hub.js` chỉ có ở Product Video;
- `page.js` khác 46 dòng;
- `ensure.mjs` và `server.mjs` khác 12 dòng mỗi file.
Hầu hết chỗ khác chỉ là tham số, nhưng đang nằm cứng trong code.

### 2.3 Đề xuất khuôn tối thiểu (làm trước hoặc cùng lúc với social-autopilot)

1. Tạo repo `hoangpham2263/tool-shell`, chứa `core/` (lấy bản Product Video vì mới hơn, có `hub.js`), `start-app.*`, `.github/workflows/release.yml`, `docs/index.html` mẫu, `AGENTS.md` mẫu (khung mục), `.gitignore` mẫu.
2. Mọi chỗ khác nhau chuyển thành **một file tham số** `tool.json` ở gốc mỗi tool:
   ```json
   { "id": "social-autopilot", "name": "Social Autopilot", "repo": "hoangpham2263/social-autopilot",
     "asset": "social-autopilot.zip", "server": "src/server.mjs", "portEnv": "SA_PORT",
     "bridgePort": 8795, "ai": ["codex"], "extensionSites": ["facebook"] }
   ```
   `launch.ps1`, `update.ps1`, `bridge/server.mjs`, `setup/page.js` đọc từ `tool.json` thay vì ghi cứng.
3. Thêm `bin/sync-shell.mjs <tool-dir> [--dry]`, giống `update-skill.mjs` của project-skill-standard:
   - chỉ ghi đè `core/` và các file vỏ;
   - không đụng `src/`, `ui/`, `data/`, `workspace/`, `AGENTS.md`, `tool.json`;
   - lưu bản cũ vào `workspace/archive/shell-sync-<ngày>/`.
4. Thứ tự áp dụng:
   - social-autopilot sinh từ khuôn;
   - Product Video và Product Review chuyển sang `tool.json` + `sync-shell` ở lần sửa kế tiếp, có `--dry`, test và duyệt;
   - không sửa hai tool đang chạy trong lần xây social-autopilot.

Nếu chưa muốn tạo `tool-shell`: chép `core/` của Product Video vào social-autopilot, chỉ đổi tham số như trên, và ghi lại nguồn và ngày chép trong AGENTS.md. **social-autopilot không sửa logic vỏ**, chỉ thêm phần riêng.

### 2.4 Cấu trúc social-autopilot (vỏ + phần riêng)

```text
C:\hoangpq\social-autopilot\               repo hoangpham2263/social-autopilot
├── start-app.cmd / start-app.command      VỎ (không đổi)
├── core/                                  VỎ: launch, update, bridge (8795), extension, ai, setup, assets, webview2
├── tool.json                              tham số vỏ (mục 2.3)
├── AGENTS.md  (+ CLAUDE.md = @AGENTS.md)  cấu trúc, workflow, bài học (Update gộp bài học như hai tool kia)
├── readme.md, icon.svg/png, .gitignore (/workspace/, /core/bridge/node_modules/)
├── .github/workflows/release.yml, docs/index.html (trang tải) + docs/plan.md (file này)
├── src/                                   RIÊNG
│   ├── server.mjs                         máy chủ app (theo khuôn), /api/brands, /api/run, /api/review
│   ├── brands.mjs                         dò thương hiệu trong skillsRoot (mục 3)
│   ├── research.ps1|mjs                   đọc trang FB qua extension của tool (site script core/extension/sites/facebook.js)
│   ├── research-clean.mjs                 lọc U+034F/zero-width, refs.csv, hash, bỏ trùng
│   ├── ideas.mjs                          ý trừu tượng từ ref, lưu lựa chọn
│   ├── generate.ps1                       ảnh: Codex qua core/ai (Invoke-HubAI), theo mục C của skill thương hiệu
│   ├── captions.ps1                       caption: Codex theo mục A của skill thương hiệu
│   ├── deliver.mjs                        bài đã duyệt → <skill>/workspace/posts + catalog, chạy check-post của skill
│   └── (giai đoạn sau) metricool.mjs
├── ui/index.html                          RIÊNG: các trang Thương hiệu · Nghiên cứu · Ý tưởng · Duyệt bài · (sau) Lịch đăng
├── data/                                  RIÊNG: prompts (idea-abstract, scene-edit, caption-brief), khuôn refs.csv/ideas.json
├── tests/                                 RIÊNG: node --test (brands, research-clean, deliver với skill giả)
└── workspace/                             CHỈ Ở MÁY (Git bỏ qua)
    ├── config/settings.json               skillsRoot, trần nghiên cứu, (sau) Metricool
    ├── runs/<brand>/research-<ngày>/      refs/ (ảnh tham khảo), raw.json, refs.csv, ideas.json, log.md
    ├── runs/<brand>/gen-<id>-<ngày>/      prompt, ảnh gốc AI, caption nháp, log Codex
    ├── review/<brand>/<id>/               bản chờ duyệt (ảnh sạch + caption) để trang Duyệt bài hiển thị
    ├── logs/, temp/, server-address.json, giao-dien.json
```

**Đọc Facebook:** theo khuôn, việc trên web chạy trong Chrome chính đã đăng nhập, qua extension và bridge của tool, không cần Playwright MCP. Thêm `core/extension/sites/facebook.js` (danh sách site của tool):
- tìm bài qua `[data-ad-rendering-role="story_message"]`;
- caption đầy đủ: mở ảnh, bấm "xem bài viết";
- ảnh: lấy `scontent` lớn nhất;
- nhịp như người, dừng khi gặp checkpoint.
Bản thử bằng Playwright MCP vẫn dùng được khi chạy tay.

---

## 3. Thương hiệu: thư mục `skills/` và cách dò

- **Chỗ duy nhất:** `C:\hoangpq\vaniecom-workspace\skills\<slug>-skills\`, gồm `dreamyvows-skills`, `grenheim-skills` và các thương hiệu sau này. Phần di chuyển ở mục 9.
- **Cài đặt:** `workspace/config/settings.json` → `"skillsRoot": "C:\\hoangpq\\vaniecom-workspace\\skills"` (mặc định, đổi được trên trang Cấu hình của tool).
- **`src/brands.mjs`:**
  1. Đọc mọi thư mục `skillsRoot/*-skills/`.
  2. Nhận là thương hiệu khi có `SKILL.md`, `project/project.md`, `project/social.json`.
  3. Chạy `node scripts/check-skill.mjs` của chính skill đó. Không ĐẠT thì bỏ qua và hiện lý do trên trang Thương hiệu.
  4. Chỉ đưa vào hàng chạy những thương hiệu có `enabled: true`.
- **Định danh** = tên thư mục bỏ `-skills`. Dùng cho `workspace/runs/<brand>/`.
- **Thêm thương hiệu:** `node project-skill-standard/bin/new-skill.mjs "<Brand>" skills/<slug>-skills` (lệnh sẽ tạo luôn `social.json`), điền như mọi skill, bật `enabled`. Hết.

### Tool đọc gì trong skill

| Cần | Ở đâu |
|---|---|
| Giọng, tagline, hashtag, CTA | project.md mục 2, 3, 8 |
| Khách, sản phẩm, điều kiện bán, điều cấm nói | project.md mục 4, 5, 6, 11 |
| Quy tắc ảnh riêng, bài mẫu giọng | project.md mục 10 |
| Logo, ảnh thật | `project/sources/assets/` |
| Quy trình viết, ảnh, kiểm tra | `SKILL.md` mục A, C, E và `references/` (lõi giống nhau mọi thương hiệu) |
| Bài đã có, trạng thái | `workspace/catalog.json`, `posts/`, `published/` |
| Trang tham khảo, kênh + ngôn ngữ, nhịp, người duyệt, nguồn ảnh gốc, (sau) Metricool | `project/social.json` |

---

## 4. Bổ sung tối thiểu cho project-skill-standard

1. `core/templates/social.json` (khuôn mục 5).
2. `bin/new-skill.mjs` và `core/scripts/new-project.mjs` tạo `project/social.json` với `enabled: false`.
3. `core/scripts/check-skill.mjs`:
   - thiếu `social.json` → cảnh báo;
   - có file thì kiểm khuôn, sai là lỗi;
   - không có trường giống token;
   - `enabled: true` thì bắt buộc `approval.owner` và ít nhất 1 kênh bật.
4. project.md mục 7 và 8: một dòng trỏ tới `social.json`. Không thêm mục 14, vì sẽ làm mọi project.md hiện có KHÔNG ĐẠT.
5. `check-post.mjs`:
   - nhận `inspiration`, `ai_disclosure`, `published.<network>`;
   - chặn ảnh bài trỏ vào ngoài skill (ví dụ `runs/` của tool).
   - (Giai đoạn sau) thêm `schedule` và trạng thái `scheduled`.
6. SKILL.body.md: thêm một câu "Bài do social-autopilot giao vào `posts/` đã qua duyệt; skill vẫn không tự đăng".
7. Đường dẫn mới `skills/<slug>-skills` trong README, creator/SKILL.md, gợi ý của new-skill (mục 9).

---

## 5. Khuôn `project/social.json` (mỗi thương hiệu tự điền)

Không lặp dữ kiện đã có trong project.md. Không chứa token.

```json
{
  "version": 1,
  "brand": "{{BRAND}}",
  "enabled": false,
  "reference_pages": [ { "id": "", "url": "", "platform": "facebook", "market": "VN|US", "why": "", "max_posts_per_run": 5 } ],
  "research": { "mode": "semi-auto|auto-lowvolume", "max_runs_per_week": 1, "max_pages_per_run": 4, "fb_account": "chính|phụ" },
  "product_image_sources": [ { "kind": "", "where": "", "note": "" } ],
  "networks": [ { "network": "facebook", "handle": "", "lang": ["vn", "en"], "lang_mode": "one-post-bilingual|separate-posts|single", "enabled": true } ],
  "cadence": { "posts_per_week": 3 },
  "approval": { "owner": "", "channel": "app|chat", "require": ["image", "caption_each_lang"] },
  "metricool": { "blog_id": "", "timezone": "America/Los_Angeles", "default_mode": "draft" }
}
```

Khối `metricool` để trống cho tới giai đoạn sau.

- **DreamyVows** (từ project.md, ngày 2026-11-06):
  - Trang tham khảo: XuongNgheVN (neon decor quán), Hineon.net.neon (neon để bàn, tranh mica UV), Duo.decorVN (neon quote, neon tên thương hiệu), PhongNeonLed (neon cưới). Nên thêm trang neon ở Mỹ.
  - Ảnh gốc: mockup chụp từ builder dreamyvows.com, lưu vào `project/sources/inputs/<id>/`. Chưa có ảnh thật.
  - Kênh: FB `dreamyvows.neon`, ngôn ngữ chờ chốt (đề xuất EN).
- **GRENHEIM** (từ project.md, ngày 2026-11-06):
  - Trang tham khảo: chờ người dùng. Gợi ý: xưởng gỗ nguyên khối hoặc live-edge ở Mỹ; xưởng gỗ VN cùng danh mục.
  - Ảnh gốc: ảnh store, `grenheim/grenheim-import`, Product Review, Product Video.
  - Kênh: FB `grenheim`, VN+EN.
  - Nghiên cứu chủ yếu để chọn cảnh, góc, chủ đề.

---

## 6. Quy trình (giống nhau mọi thương hiệu)

```text
Trang Thương hiệu (brands.mjs) → với từng thương hiệu enabled, lần lượt:
 1 Nghiên cứu → 2 Chọn ý → 3 Ảnh → 4 Caption → 5 Kiểm tra → 6 Duyệt → 7 Giao bài vào skill
 (giai đoạn sau) 8 Metricool → 9 Đã đăng
```

1. **Nghiên cứu.**
   - Extension tool đọc các trang trong `reference_pages`, tôn trọng giới hạn của thương hiệu và trần chung.
   - Kết quả: `research-clean.mjs` ghi `refs.csv`.
   - Chế độ `semi-auto`: người dùng mở trang, tool chỉ đọc trang đang mở.
2. **Chọn ý.**
   - Prompt `idea-abstract` biến ref thành ý: loại sản phẩm, cảnh, góc, hướng caption. Bỏ chữ, logo và tên shop.
   - Ghép với project.md mục 4, 5, 10. Người dùng chọn trên trang Ý tưởng.
3. **Ảnh.** Theo mục C của skill.
   - Ảnh gốc sản phẩm phải là của thương hiệu, nằm trong `project/sources/`.
   - Codex qua `core/ai`, `-i` ảnh gốc thương hiệu, `-i` ảnh không khí (không dùng ảnh đối thủ có sản phẩm).
   - Bài học từ bản thử: giữ sản phẩm y hệt; cảnh mới nhưng hợp cách dùng thật; 1-2 đạo cụ; xoá logo và watermark; kiểm tra từng chữ và dấu; Codex có hạn mức ảnh.
   - Xuất bằng `clean-image.mjs` của skill vào `workspace/review/`.
4. **Caption.** Theo mục A của skill, đủ ngôn ngữ trong `networks[].lang`.
5. **Kiểm tra.** Output-check của skill (song ngữ, anti-LLM, ảnh SẠCH).
6. **Duyệt.** Trang Duyệt bài hiện ảnh, caption và kênh. `approval.owner` bấm Duyệt, Sửa (ghi lý do) hoặc Bỏ. Có thể duyệt qua chat nếu `channel: chat`.
7. **Giao bài.** `deliver.mjs`:
   - chép ảnh và caption đã duyệt vào `<skill>/workspace/posts/<TYPE>-<slug>/`;
   - thêm mục vào `catalog.json` với `approved`, `inspiration`, `ai_disclosure`;
   - cập nhật `context.md`;
   - chạy `check-post.mjs <ID>` của skill. Lỗi thì hoàn tác và báo.
8. **(Sau) Metricool:** nháp, rồi hẹn giờ.
9. **(Sau) Đã đăng:** `mark-published.mjs` của skill.

**Hội tụ hai thương hiệu:**
- **GRENHEIM:**
  1. Tạo `social.json`.
  2. Đưa catalog (khoảng 45 trường tự đặt) về các trường chuẩn: migrate `--dry`, giữ trường cũ trong `history`.
  3. Xác nhận POST-06 (nằm trong `published/` nhưng catalog chưa xác nhận).
- **DreamyVows:**
  1. Tạo `social.json`.
  2. Có ảnh gốc của thương hiệu (mockup builder).
  3. Chuyển bản thử `C:\hoangpq\neon-competitors\` vào `social-autopilot/workspace/runs/dreamyvows/research-20261107/`. Ảnh trong `bg-test` dựng lại bảng của đối thủ, **không giao thành bài**.

---

## 7. Rủi ro

| Rủi ro | Mức | Cách giảm |
|---|---|---|
| Điều khoản Meta cấm thu thập dữ liệu tự động khi chưa được phép, kể cả khi đã đăng nhập (https://developers.facebook.com/docs/development/terms-and-policies/automated-data-collection/, https://about.fb.com/news/2021/04/how-we-combat-scraping/) | Cao | Trần chung (≤ 1 lần nghiên cứu mỗi ngày, ≤ 30 bài mỗi lần), cộng giới hạn của từng thương hiệu. Nhịp người, dừng khi gặp checkpoint, dùng tài khoản phụ. Chế độ `semi-auto`. Thêm Meta Ad Library. |
| Bản quyền ảnh, caption, thiết kế | Cao | Ảnh đối thủ chỉ trong `workspace/` của tool (Git bỏ qua). `check-post` chặn ảnh trỏ ra ngoài skill. |
| Ảnh AI bị hiểu là ảnh khách thật | Trung bình | `ai_disclosure`; caption nói "mẫu thiết kế". |
| Di chuyển skill làm hỏng phiên đang chạy hoặc mất dữ liệu local | Trung bình | Mục 9: dừng các phiên trước, `git mv`, kiểm `check-ignore` và `check-skill`. |
| Vỏ tool lệch giữa ba tool | Trung bình | Khuôn `tool-shell` + `sync-shell --dry` (mục 2.3). |
| Migrate catalog GRENHEIM làm mất thông tin | Trung bình | `--dry`, archive, giữ trường cũ trong `history`. |
| Hạn mức Codex | Thấp | Ghi trạng thái lượt chạy để chạy tiếp. |

---

## 8. Mốc đầu tiên (không cần Metricool)

**Mốc 1. DreamyVows, 1 bài, làm tay, chưa xây tool.**
1. Viết tay `project/social.json` cho dreamyvows-skills.
2. Dùng ref có sẵn `03-hineon-neon-hpbd-de-ban.jpg` để rút ra ý "neon Happy Birthday để bàn".
3. Làm mockup trên builder DreamyVows, lưu vào `inputs/`. Codex dựng cảnh mới.
4. Viết caption VN/EN theo mục A, kiểm tra theo mục E. **Gửi người dùng duyệt.**
5. **Kết thúc:** bài đã duyệt nằm trong `workspace/posts/POST-<slug>/`, catalog có `approved` và `inspiration`, `check-post` ĐẠT.

**Mốc 2. Dọn nền.** Di chuyển skill vào `skills/` (mục 9). Bổ sung chuẩn (mục 4). Tạo vỏ social-autopilot từ khuôn (mục 2).

**Mốc 3. Tool chạy được.** Làm lại đúng mốc 1 bằng app: Thương hiệu → Nghiên cứu (semi-auto) → Ý tưởng → Duyệt → Giao bài. Sau đó 1 bài GRENHEIM với cùng quy trình. Kết thúc ở bài đã duyệt trong `posts/` và catalog.

Metricool chỉ bắt đầu sau mốc 3, khi có tài khoản (mục 10).

---

## 9. Di chuyển skill vào `vaniecom-workspace/skills/` (kế hoạch, CHƯA làm)

### 9.1 Đích

```text
vaniecom-workspace/
├── project-skill-standard/                 giữ nguyên
├── skills/
│   ├── dreamyvows-skills/                  ← từ dreamyvows/dreamyvows-skills
│   └── grenheim-skills/                    ← từ grenheim/grenheim-skills
├── dreamyvows/                             sau khi chuyển: trống → xoá thư mục
└── grenheim/                               GIỮ: grenheim-import/ (local, Git bỏ qua), grenheim-aplus/ (đã commit), product-review/ (nếu có, Git bỏ qua)
```

Chỉ hai thư mục `*-skills` di chuyển. `grenheim-import` và `grenheim-aplus` ở lại `grenheim/`, vì không phải skill và memory đang trỏ tới chúng.

### 9.2 Chỗ đang ghi đường dẫn cũ (đã tìm ngày 2026-11-07)

**Trong repo vaniecom-workspace:**
- `.gitignore` dòng 5-7: `*/*-skills/workspace/local/`. Pattern này **vẫn khớp** `skills/<x>-skills/workspace/local/` (`*` = `skills`), nhưng đổi cho rõ thành `skills/*-skills/workspace/local/`. Giữ dòng cũ một thời gian cho bản sao chưa chuyển. Giữ `grenheim/grenheim-import/`, `grenheim/product-review/`.
- `README.md` dòng 8-9 (cây thư mục), dòng 19 (`new-skill ... <du-an>/<du-an>-skills`), dòng 20 (`update-skill grenheim/grenheim-skills dreamyvows/dreamyvows-skills`).
- `project-skill-standard/README.md`: phần "Lưu lên GitHub", ví dụ đích, cây `<du-an>-skills/`.
- `project-skill-standard/creator/SKILL.md` dòng 12, 18: "Đặt skill mới cạnh các dự án khác, vd `<vaniecom-workspace>/<brand>/<brand>-skills`" → `skills/<brand>-skills`.
- `project-skill-standard/bin/new-skill.mjs`: chỉ kiểm tên `<slug>-skills`, không ghi cứng thư mục cha. Sửa câu gợi ý/ví dụ sang `skills/<slug>-skills`. Có thể cảnh báo khi đích không nằm trong `skills/`.
- `core/scripts/new-project.mjs`: tương tự (tên, không có đường dẫn).
- `bin/update-skill.mjs`, `bin/pull-core.mjs`, `core/scripts/check-skill.mjs`, `sync-core.mjs`: nhận đường dẫn qua tham số, không ghi cứng. Không cần sửa code; chỉ đổi ví dụ trong README.
- `skills/*/SKILL.md` và `agents/openai.yaml`: chỉ chứa **tên** skill (`dreamyvows-skills`, `grenheim-skills`), không chứa đường dẫn. Không sửa. Tên vẫn trùng tên thư mục, nên `check-skill` vẫn ĐẠT.

**Tool khác:**
- `C:\hoangpq\product-video\AGENTS.md`, `src/video.ps1`, `data/brand/brand.json`: chỉ nhắc **tên** "grenheim-skills (quy trình G)", không có đường dẫn. Không sửa.
- `product-review`, `tools-hub`: không thấy tham chiếu.

**Skill đã cài:**
- `C:\Users\Admin\.codex\skills\grenheim-skills` là symlink → `/c/hoangpq/grenheim-skills`. **Đích này không còn tồn tại**, tức link đã gãy từ trước. Trỏ lại tới `C:\hoangpq\vaniecom-workspace\skills\grenheim-skills`, hoặc xoá nếu không dùng trong Codex.
- `C:\Users\Admin\.codex\skills\grenheim\`: thư mục rỗng. Xoá hoặc để yên tuỳ người dùng.
- Chưa có dreamyvows-skills trong `.codex/skills`. `~/.claude/skills` không có skill nào.

**Memory** (`C:\Users\Admin\.claude\projects\C--Users-Admin\memory\`):
- `project-content-skills-standard.md`: "Content skills live in `C:/hoangpq/vaniecom-workspace/<project>/<project>-skills/`" và rule gitignore `*/*-skills/workspace/local/` → sửa sang `skills/<project>-skills/`.
- `project-grenheim-our-story-video.md` dòng 13: "How to resume: grenheim-skills/workspace/runs/vid-brand-story-20261105". Đường dẫn tương đối, và đã cũ: runs giờ nằm ở `workspace/local/runs/`. Sửa thành `vaniecom-workspace/skills/grenheim-skills/workspace/local/runs/vid-brand-story-20261105`, và kiểm thư mục có thật trước khi sửa.
- `project-grenheim-review-run-state.md` dòng 11: "grenheim-import (next to grenheim-skills)" → sửa câu vì grenheim-import ở lại `grenheim/`, không còn cạnh skill.
- `MEMORY.md` dòng 17: chỉ có tên, không sửa (mô tả theo file memory).

### 9.3 Các bước (một commit)

1. **Phối hợp:**
   - Báo và **dừng mọi phiên Claude/Codex đang làm trong dreamyvows-skills và grenheim-skills**.
   - Đóng VS Code/Explorer đang mở các thư mục đó (Windows khoá thư mục khi có tiến trình bên trong).
   - Chờ các phiên ghi xong `context.md` và catalog.
   - Kiểm không còn tiến trình Codex hay Node chạy trong hai thư mục.
2. **Kiểm sạch:**
   - `git -C C:\hoangpq\vaniecom-workspace status`: thay đổi của phiên khác phải được commit riêng trước (hoặc người dùng quyết).
   - `git pull` để cùng nhánh với remote.
3. **Chụp trạng thái local:** ghi số file và dung lượng `workspace/local/` của từng skill, để so sau khi chuyển. Dữ liệu này không có trong Git, nên phải đi theo thư mục.
4. **Di chuyển:**
   ```sh
   cd C:/hoangpq/vaniecom-workspace
   mkdir skills
   git mv dreamyvows/dreamyvows-skills skills/dreamyvows-skills
   git mv grenheim/grenheim-skills skills/grenheim-skills
   ```
   `git mv` chuyển cả thư mục trên đĩa, gồm file bị bỏ qua như `workspace/local/`. Kiểm lại ở bước 6. Nếu file bị bỏ qua bị sót lại ở chỗ cũ, chuyển tay bằng `mv` phần còn lại.
   Sau đó `rmdir dreamyvows` nếu đã trống.
5. **Sửa tham chiếu** ở 9.2 trong repo: `.gitignore`, `README.md`, `project-skill-standard/README.md`, `creator/SKILL.md`, gợi ý trong `new-skill.mjs`.
6. **Kiểm:**
   ```sh
   git check-ignore -v skills/dreamyvows-skills/workspace/local/runs/x
   git check-ignore -v skills/grenheim-skills/workspace/local/archive/x
   git check-ignore -v grenheim/grenheim-import/x
   git status --short          # chỉ thấy rename (R) và các file vừa sửa; KHÔNG có file trong workspace/local/
   node skills/dreamyvows-skills/scripts/check-skill.mjs
   node skills/grenheim-skills/scripts/check-skill.mjs --compare skills/dreamyvows-skills
   node skills/grenheim-skills/scripts/check-post.mjs --all
   node skills/dreamyvows-skills/scripts/check-post.mjs --all
   ```
   So số file `workspace/local/` với bước 3.
7. **Một commit, rồi push:** `git add -A`, `git commit -m "Move brand skill sets into skills/"`, `git push`. Commit chỉ đứng tên người dùng. Lịch sử từng file xem bằng `git log --follow`.
8. **Ngoài repo:**
   - sửa 3 file memory ở 9.2;
   - trỏ lại hoặc xoá symlink `.codex/skills/grenheim-skills`;
   - báo các phiên khác đường dẫn mới rồi cho chạy lại.

---

## 10. Giai đoạn sau: Metricool (đã tìm hiểu, chưa làm vì chưa có tài khoản)

- **MCP chính thức** `https://ai.metricool.com/mcp`, cài bằng `claude mcp add --transport http metricool https://ai.metricool.com/mcp`, đăng nhập OAuth.
  - Dùng được mọi gói kể cả Free (1 brand, 20 bài/tháng). Làm được: xem brand, xem lịch, xem giờ tốt nhất, tạo và sửa bài hẹn giờ, tạo bài chờ duyệt.
  - Chưa xác minh đính kèm ảnh qua MCP.
  - Nguồn: https://metricool.com/metricool-mcp/, https://help.metricool.com/mcp-limits-and-plan-requirements-h72jg, https://help.metricool.com/faqs-about-the-metricool-mcp-1i3w0
- **REST API** chỉ có ở gói Advanced/Custom (Zapier/Make cũng vậy).
  - Lệnh gọi: `POST https://app.metricool.com/api/v2/scheduler/posts?blogId=&userId=`, header `X-Mc-Auth`.
  - Body: `publicationDate{dateTime,timezone}`, `text`, `providers[{network}]`, `autoPublish`, `draft`, `media[URL công khai]`, `saveExternalMediaFiles`.
  - Không gọi được từ trình duyệt (CORS). Không có endpoint tải ảnh hay rate limit công khai.
  - Nguồn: https://help.metricool.com/plans-add-ons-and-api-access-explained-xux1u, https://help.metricool.com/wli-scheduler-endpoint-example-on-a-custom-backend-proxy-frko7, https://app.metricool.com/resources/apidocs/index.html
- **Giá** (2026-11-07, https://metricool.com/pricing/): Free $0 (1 brand); Starter khoảng $20–25/tháng (5 brand, không API); Advanced khoảng $53–67/tháng (15 brand, có API).
- **Không tự đăng được** (https://help.metricool.com/en/article/schedule-and-post-on-instagram-1xovmji/, https://help.metricool.com/pt/api-limitations-per-social-network-n7zlr):
  - IG cá nhân; IG Story có link/sticker; Reel có nhạc ngoài thư viện; carousel có video trên 60 giây;
  - FB Group; TikTok xuống dòng và Story.
- **Khi làm:**
  - thêm `src/metricool.mjs` và trang Lịch đăng;
  - điền khối `metricool` trong `social.json`;
  - bước 8: chỉ bài `approved`, mặc định tạo nháp;
  - catalog thêm `schedule` và trạng thái `scheduled` (mục 4.5).
- **Câu hỏi để sau:**
  - gói nào (Starter dùng MCP hay Advanced dùng API);
  - chỉ tạo nháp hay được hẹn giờ thẳng;
  - lấy URL ảnh ở đâu (Shopify Files);
  - nhịp và khung giờ đăng;
  - có lập IG/TikTok/Pinterest không.

---

## 11. Câu hỏi cần trả lời trước khi xây

**Chung:**
1. Tạo repo khuôn `tool-shell` và `sync-shell` cho cả ba tool, hay chép vỏ Product Video sang social-autopilot trước và để khuôn sau?
2. Đồng ý cổng bridge 8795 và repo `hoangpham2263/social-autopilot` (công khai như hai tool kia, hay riêng tư)?
3. Đọc Facebook qua extension và bridge của tool (theo khuôn), hay tiếp tục dùng Playwright MCP? Tài khoản FB chính hay phụ? Đồng ý trần chung ≤ 1 lần nghiên cứu mỗi ngày?
4. Đồng ý bổ sung chuẩn (`social.json`, check-skill, check-post) và migrate catalog?
5. Có chấp nhận ảnh dựng cảnh bằng AI kèm `ai_disclosure` không?
6. Di chuyển skill: khi nào dừng được các phiên đang chạy trong dreamyvows-skills và grenheim-skills? Symlink `.codex/skills/grenheim-skills` (đang gãy) trỏ lại hay xoá?
7. Duyệt trên trang Duyệt bài của app, qua chat, hay cả hai?

**DreamyVows:**
8. Kênh nào, mỗi kênh ngôn ngữ nào (đề xuất EN)?
9. Có thêm trang neon ở Mỹ không?
10. Tool tự chụp mockup trên builder, hay người dùng gửi?
11. Ai duyệt?

**GRENHEIM:**
12. Tham khảo những trang nào?
13. FB đăng một bài chứa cả VN+EN hay hai bài riêng?
14. Ai duyệt? Cho migrate catalog không? POST-06 đã đăng thật chưa?
