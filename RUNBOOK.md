# RUNBOOK: social-autopilot (2 chế độ)

Scripts + RUNBOOK là nguồn duy nhất của quy trình. Prompt (tab **Prompt** của app, `docs/scheduled-prompt.md`) chỉ ngắn 5-10 dòng: chế độ, thương hiệu, tuỳ chọn và câu "follow RUNBOOK.md Mode N"; mọi bước nằm ở đây. Agent nào cũng chạy được (Claude Code, Codex; ChatGPT chỉ phần gửi Metricool): mọi bước là lệnh `node scripts/...` chạy trong thư mục tool (`<tool folder>`), in **một JSON** (`ok: true|false`); đọc JSON, không đoán. Chạy lại không sinh trùng. App chỉ để xem, duyệt và quản lý; việc do agent làm.

Hai chế độ:
1. **Research only**: crawl các trang tham khảo của thương hiệu vào kho `workspace/store/<brand>/`, bỏ trùng. Không làm ý/bài, không gửi Metricool.
2. **Create & publish**: đồng bộ brand Metricool → gửi các bài **đã duyệt** mà chưa gửi thành bài **hẹn giờ thật** (không bao giờ nháp) đúng giờ slot của brand → làm bài mới → kiểm tra tự động → bài ở trạng thái **To review** và **dừng**. Người dùng duyệt trong app (Approve = ghi vào skill của thương hiệu + host ảnh); lượt sau hẹn giờ các bài đó.

Trạng thái người dùng thấy: **To review** (chờ duyệt) / **Queued** (đã duyệt, chờ gửi hoặc đã hẹn giờ trên Metricool) / **Posted** (đã đăng); bài lỗi có dấu đỏ.

## Rules for every run

- Prompt ghi sẵn đường dẫn: `TOOL:` (thư mục tool) và mỗi thương hiệu một dòng `SKILL: <id> → <thư mục skill>`; agent không tự chọn skill, chỉ làm với các skill đó và đọc `SKILL.md`, `project/project.md`, `project/social.json` của từng skill ở bước Setup.
- Mỗi lượt (cả hai chế độ, mọi agent) theo đúng các bước đánh số của chế độ đó, không bỏ bước; **bước gần cuối luôn là ghi nhật ký** (`scripts/runlog.mjs`, 1.5 / 2.9), **bước cuối là báo cáo** với các mục cố định (1.6 / 2.10).

- Thương hiệu: chỉ các thương hiệu usable (`node scripts/brands.mjs`), **lần lượt từng thương hiệu**, không song song. "all usable brands" = mọi thương hiệu usable.
- Skill không bao giờ được chép vào tool. Mỗi brand Metricool trỏ tới một thư mục skill (`skill_path` trong `workspace/metricool-brands.json`); tool đọc/ghi thẳng trong thư mục đó. Mọi dữ kiện riêng của thương hiệu đọc từ skill (`SKILL.md`, `project/project.md`, `project/social.json`). Không hard-code thương hiệu, không trộn nguồn hay kho giữa thương hiệu.
- Brand chỉ được làm và gửi bài khi đã trỏ tới một skill dùng được; brand chưa trỏ skill, hoặc `removed: true` (đã mất khỏi tài khoản) trong `workspace/metricool-brands.json`, thì **không bao giờ**. Không dùng blogId khác `args.blogId` của payload; không `createScheduledPostForReview`.
- Tuỳ chọn của lượt (dòng `Options:` của prompt) ưu tiên hơn mặc định: Research → `--source a,b`, `--since YYYY-MM-DD`, `--max-posts N`, `--backfill` hoặc `--full` cho `research.mjs start`; Create → `--count N` cho `ideas.mjs init` (trống = đủ bài cho `planning.ahead_days` ngày tới); Publish approved → `--limit N` (tối đa N bài đã duyệt mỗi brand, bài duyệt sớm nhất trước) cho `metricool-mcp.mjs payload`; chỉ Publish approved → `--window morning|midday|afternoon|evening` (chỉ giờ trong khung đó của ngày, theo múi giờ Metricool của brand; tốt nhất trước, không có dữ liệu thì giữa khung) và `--start today` (cả hôm nay, cách bây giờ ít nhất 1 giờ) cho `payload`. Create & publish không có hai tuỳ chọn này: bài đã duyệt luôn hẹn ở giờ tốt nhất tự động, từ ngày mai.
- Trước khi làm bài cho thương hiệu: đọc `SKILL.md` và `project/project.md` của skill.
- **Không bao giờ gắn nhãn AI** lên bài (caption, text, alt). **Không logo trên sản phẩm** (logo chỉ là watermark nhỏ ở góc, khi thương hiệu bật).
- Không đăng thẳng lên mạng xã hội; mọi bài đi qua Metricool dạng hẹn giờ. Agent **không bao giờ tự duyệt** bài (`finalize.mjs approve` chỉ do người dùng, qua app).
- Không dùng ảnh hay câu chữ của đối thủ; không nhắc tên shop nguồn; không đăng nhập hộ, không lưu cookie.
- Lệnh trả `ok:false`: ghi lý do vào báo cáo, đi tiếp; không lách luật. Hết lượt Codex (tạo ảnh) thì dừng tạo ảnh và báo.
- Báo cáo bằng tiếng Việt (mục 1.6 / 2.10), nhắc người dùng mở app (tab Library / Posts).

### Công cụ theo agent
- **Claude Code**: `node scripts/crawl-fb.mjs` (Playwright trong tool, gắn vào Chrome đã đăng nhập Facebook qua CDP) cho Mode 1, Playwright MCP chỉ là dự phòng; connector claude.ai "Metricool" cho Mode 2; Codex CLI để tạo ảnh.
- **Codex** (CLI/app, đọc `AGENTS.md`): Mode 1 chạy `node scripts/crawl-fb.mjs` như Claude Code (không cần MCP trình duyệt). Chỉ khi phải crawl tay (dự phòng) mới cần MCP trình duyệt trong `~/.codex/config.toml` (`[mcp_servers.playwright]`, `command = "npx"`, `args = ["-y", "@playwright/mcp@latest", "--extension"]`). Mode 2 cần MCP Metricool:
  ```
  codex mcp add metricool --url https://ai.metricool.com/mcp
  codex mcp login metricool
  ```
  Không có MCP Metricool: bỏ 2.0-2.2, vẫn làm bài tới 2.7, ghi trong báo cáo "chưa đồng bộ/gửi Metricool: Codex chưa có MCP Metricool" kèm hai lệnh trên.
- **ChatGPT** (web/desktop, không chạy được lệnh trên máy): không làm được Mode 1 và phần làm bài. Chỉ gửi bài đã duyệt khi người dùng dán JSON của `node scripts/metricool-mcp.mjs payload --brand <id>`: với từng `items[]` gọi `createScheduledPost` với ĐÚNG `args.blogId`, `args.date`, `args.info` (chuỗi JSON giữ nguyên; ảnh đã ở `info.media`), ghi `id`, `uuid`, `plannerUrl`, `publicationDate.dateTime`, `publicationDate.timezone`. Bỏ qua `blocked`, `skipped`. Trả lời tiếng Việt: bài đã gửi (POST-xx, giờ, plannerUrl), lệnh `item.record` đã điền giá trị thật cho từng bài (người dùng chạy trên máy), bài lỗi và lý do.

## Bước chung. Thương hiệu và nguồn

```
node scripts/brands.mjs          # usable = thương hiệu chạy được; problems/skipped = lý do bỏ qua
node scripts/sources.mjs         # mỗi thương hiệu: các research.sources đang bật trong social.json của nó
```

Thương hiệu usable = brand Metricool đã trỏ tới một thư mục skill hợp lệ (`SKILL.md`, `project/project.md`, `project/social.json`), `social.json` có `enabled: true` và `scripts/check-skill.mjs --tool-ready` của chính skill đạt (exit 0).

Trỏ skill (người dùng làm ở tab **Overview**: Choose skill / Change skill / Disconnect; hoặc lệnh):
```
node scripts/skills.mjs list-sources [--from <folder>]          # thư mục skill trong <folder> (mặc định skillsRoot), sâu 2 tầng, kèm trạng thái
node scripts/skills.mjs validate --path <skills folder>/<id>-skills
node scripts/skills.mjs link   --brand "<tên brand Metricool>" --path <skills folder>/<id>-skills
node scripts/skills.mjs unlink --brand "<tên brand Metricool>"  # chỉ bỏ liên kết, không đụng thư mục
```
Thư mục đã trỏ bị đổi tên/di chuyển: thẻ ở Overview báo không tìm thấy, dùng Change skill.

## Mode 1. Research only

**Crawl hết nhanh bằng script, rồi lọc một lượt.** Agent không bấm từng bài: `scripts/crawl-fb.mjs` lái Chrome đã đăng nhập Facebook (Playwright, qua CDP) theo luật cố định, tải ảnh, ghi `raw.json` và ingest; agent chỉ can thiệp khi một nguồn **blocked** hoặc **error**, rồi lọc bài trong kho một lượt (1.3). Chi tiết: `docs/research.md`. Một Chrome = một lượt crawl.

### Chrome cho crawl (một lần trên máy)
- `npm install` một lần trong thư mục tool (thư viện `playwright-core`; không tải trình duyệt).
- Chrome mới không cho điều khiển profile mặc định, nên dùng **một profile riêng** cho crawl, đăng nhập Facebook tài khoản phụ (`research.fb_account`) trong profile đó **một lần, bằng tay**. Cookie nằm trong profile Chrome đó (ngoài repo), tool không bao giờ lưu cookie.
- Mở Chrome có cổng điều khiển (chỉ nghe ở 127.0.0.1), để mở trong lúc crawl:
  - Windows: `"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\social-autopilot-chrome"`
  - macOS: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/Library/Application Support/social-autopilot-chrome"`
  - Kiểm tra: mở `http://127.0.0.1:9222/json/version` thấy JSON là được.
- Settings (`workspace/settings.json`, mặc định ở `config/settings.json`): `research.browser.cdp` (mặc định `http://127.0.0.1:9222`). Hoặc `research.browser.user_data_dir` = thư mục profile riêng (ngoài thư mục tool): tool tự mở Chrome với profile đó (Chrome của profile đó phải đang tắt). Khác: `fallback_tabs` (`posts`, `photos`, `reels`), `stall_posts` (5), `max_scroll_steps` (300).

1.1. Mở lượt crawl cho một thương hiệu:
```
node scripts/research.mjs start --brand <id> [--source a,b] [--since YYYY-MM-DD] [--max-posts N] [--full | --backfill]
```
- Mặc định: lần đầu lấy **hết** bài (cuộn tới hết trang); lần sau chỉ lấy bài mới ở đầu trang (dừng sau 3 bài liên tiếp đã có trong kho).
- `--since`: giới hạn khi người dùng chọn. `--max-posts N`: **tối đa N bài mới cho cả thương hiệu** (không phải mỗi nguồn), chia đều **xoay vòng** cho các nguồn: mỗi vòng mỗi nguồn còn bài được một phần đều của số còn lại; nguồn cạn để phần dư cho nguồn khác. Nguồn chưa được mở vì hết phần ghi `skipped` ("Skipped (quota)", không phải "Dried up"). Brand = tất cả: mỗi thương hiệu được N.
- `--backfill`: lấy dần các bài **cũ hơn** bài cũ nhất đã có (`oldest_seen`); nguồn đã `reached_end` thì bỏ qua (`run.skipped`). `--full`: cuộn hết dù đã có (chậm).
- Mở lại cùng ngày: `raw.json`, `raw/`, `ingest.json` cũ của từng nguồn được chuyển vào `<source>/archive/<giờ>/` (JSON `archived`), không bao giờ bị ingest lại.
- Tiến độ từng nguồn: `workspace/store/<brand>/progress.json` (`newest_seen`, `oldest_seen` theo ngày đăng, không có ngày thì theo thứ tự trên trang; bài lấy bằng backfill không bao giờ là `newest_seen`).

1.2. Crawl bằng script (mọi source của lượt, đúng thứ tự):
```
node scripts/crawl-fb.mjs --brand <id> [--source a,b] [--cdp http://127.0.0.1:9222] [--redo]
```
- Mỗi source: mở trang, cuộn; mỗi bước cuộn **một** `page.evaluate` mở "Xem thêm", đọc mọi bài mới (link + mã, caption, ngày, link ảnh, loại media), rồi nghỉ ngẫu nhiên `research.delay_seconds` (mỗi bước cuộn, không phải mỗi bài). Bài đã có trong `known.json` không tải. Sau mỗi vòng: tải ảnh vào `<source>/raw/`, ghi `<source>/raw.json` dạng `{ "page": {...}, "posts": [...] }`, chạy `research.mjs ingest` (bỏ trùng), cuối cùng `research.mjs result` cho từng source. Dòng tiến độ in ra stderr và `workspace/runs/<brand>/<date>/crawl-fb.log`.
- Trang ngừng tải sau 1-3 bài: script chờ vòng tải, cuộn lên/xuống, bấm End; vẫn đứng thì thử tab `/posts`, rồi lưới `/photos_by` và `/reels` (mở từng ô mới một lần để lấy caption/ngày/ảnh lớn). Tab đã dùng ghi trong JSON (`tabs`).
- JSON trả `sources.<sid>`: `state`, `note`, `collected`, `added`, `duplicates`, `tabs`; `blocked[]`, `errors[]`.
- **Agent chỉ can thiệp khi:**
  - `blocked` (checkpoint, captcha, yêu cầu đăng nhập, "tạm thời bị chặn"): script đã dừng ngay, không mở nguồn nào nữa. Không thử lại trong ngày, không đăng nhập hộ; báo người dùng.
  - `error` (note bắt đầu `error:`): `error: selectors` = trang có bài nhưng không đọc được bài nào (Facebook đổi giao diện): sửa danh sách trong `scripts/fb-extract.mjs` (`SELECTORS`), hoặc crawl tay nguồn đó theo `docs/research.md` phần **Dự phòng** rồi `research.mjs ingest` + `result`. Lỗi khác: ghi vào nhật ký.
  - Không nối được Chrome: báo người dùng mở Chrome theo mục "Chrome cho crawl".

1.3. Lọc một lượt (agent tự quyết, không mở trình duyệt):
```
node scripts/store.mjs classify --brand <id> [--limit 40]
node scripts/store.mjs verdict  --brand <id> --file <verdicts.json>
```
- `classify` in một lô gọn các bài `new` chưa lọc: `id`, `source`, đoạn đầu caption (`(no caption)` khi bài chỉ có ảnh), `media`, `thumb` (đường dẫn ảnh), kèm `what_to_take` của từng nguồn, đường dẫn `project.md` (phạm vi sản phẩm) và `rules_of_thumb`.
- Agent xem chữ + ảnh thumb (đọc file ảnh), đối chiếu `what_to_take` và phạm vi sản phẩm trong `project.md`, ghi `[{ "id": "S0001", "fit": true|false, "reason": "..." }]` (lý do ngắn, bắt buộc khi `fit:false`), rồi `verdict`. Lặp tới khi `total_unjudged` = 0.
- `fit:false` → bài thành **Dropped** (`rejected`), ghi chú `filter: <lý do>`; `fit:true` → giữ (Unused). Người dùng vẫn Restore được ở tab Library (bài đó không bị lọc lại).
- Luật nhanh: bỏ bài tuyển dụng; bỏ cuộc thi, minigame, giveaway; bỏ bài chỉ có chữ (hoặc ảnh chỉ là chữ, không thấy sản phẩm); bỏ bài chia sẻ lại mà không có ảnh sản phẩm; bỏ sản phẩm ngoài ngành hàng của thương hiệu. Giữ: ảnh sản phẩm thật đúng ngành hàng, có bối cảnh/góc chụp/khung caption học được.

1.4. Số liệu báo cáo:
```
node scripts/research.mjs report --brand <id>
```
Mỗi nguồn: bài mới, `kept` / `filtered`, `low_keep` (≥ 5 bài đã lọc và giữ < 30%), trạng thái, còn bài cũ không.

1.5. Ghi nhật ký lượt chạy (bước gần cuối của mọi lượt):
```
node scripts/runlog.mjs add --mode research --agent "<Claude Code|Codex>" [--started <giờ bắt đầu ISO>] [--file <ghi chú.json>]
```
Tool tự lấy số liệu (từng nguồn: bài mới, **kept / filtered**, trạng thái New posts / Dried up / Skipped (quota) / Blocked / Error, cờ keep rate thấp) và ghi `workspace/logs/runs/<thời điểm>-research.json`; tab **Log** hiện "N kept · M filtered". Agent chỉ thêm ghi chú/lỗi bằng file JSON `{ "notes": "...", "errors": ["..."], "brands": { "<id>": { "notes": "...", "errors": ["..."] } } }`.

1.6. Báo cáo cho người dùng, tiếng Việt, **luôn đúng các mục sau** (giống tab Log):
- **Kết quả chung:** +N bài mới · N giữ · M lọc bỏ, số nguồn cạn (Dried up), số nguồn bị chặn.
- **Theo thương hiệu:** từng nguồn: bài mới · giữ / lọc bỏ · trạng thái (New posts / Dried up / Skipped (quota) / Blocked / Error).
- **Cần làm:** nguồn bị chặn (lý do), nguồn lỗi (vd `error: selectors`), nguồn keep rate thấp (xem lại `what_to_take` hoặc thay nguồn), nguồn cạn nhiều lượt liền (gợi ý thêm nguồn mới), còn bài cũ thì nhắc `--backfill`.
- **Kho:** tổng (Unused / Used / Dropped); xem ở tab **Library** (bài bị lọc nằm ở Dropped, có lý do).

Không làm ý, không tạo bài, không gửi Metricool trong chế độ này. Không bao giờ like, bình luận, theo dõi, chia sẻ hay nhắn tin.

## Mode 2. Create & publish

Không mở Facebook. Cần `node`, Codex CLI (tạo ảnh) và MCP Metricool của agent.

2.0. Đồng bộ brand Metricool và giờ đăng tốt nhất (bước đầu của mọi lượt Mode 2):
- Gọi tool MCP `getBrandSettings`, lưu nguyên câu trả lời JSON vào một file (vd `workspace/tmp/brand-settings.json`), rồi:
  ```
  node scripts/metricool-mcp.mjs sync-brands --from workspace/tmp/brand-settings.json
  ```
- Ghi `workspace/metricool-brands.json` (dạng: `config/metricool-brands.example.json`): tên, blogId, múi giờ, mạng đã nối của từng brand. **Giữ** liên kết skill (`skill_id`, `skill_path`) theo blogId; brand không còn trong tài khoản thành `removed: true`. Báo người dùng brand mới (`added`, cần Choose skill ở Overview) và brand đã mất (`removed`).
- Với từng thương hiệu usable: gọi tool MCP `getBestTimeToPostByNetwork` cho brand Metricool của nó (mạng `facebook`), lưu JSON vào file rồi:
  ```
  node scripts/metricool-mcp.mjs sync-times --brand <id> --from workspace/tmp/best-times-<id>.json
  ```
  Giờ đăng lấy từ đây; Metricool chưa có dữ liệu thì tool dùng bảng nghiên cứu `config/best-times.json` (docs/metricool.md mục 3). Không đặt giờ tay.

2.1. Gửi bài đã duyệt mà chưa gửi (từng thương hiệu usable):
```
node scripts/metricool-mcp.mjs payload --brand <id> [--posts POST-xx,...]
```
- Mỗi `items[]` = một bài đã duyệt (catalog `approved`) có `media_url`/`video_url`, chưa có `metricool.<network>.id`, qua `check-post.mjs` của skill. Bài không qua kiểm (check-post lỗi, giờ đã qua, nhãn AI, ký tự ẩn, link không https hay WebP...) nằm trong `blocked` kèm lý do; bài khác vẫn đi.
- Luôn là **bài hẹn giờ thật** (`draft: false`, `autoPublish: true`) ở giờ tốt nhất: mỗi ngày `cadence.posts_per_day` bài theo giờ tốt nhất của Metricool, không có thì bảng nghiên cứu (`docs/metricool.md` mục 3), theo múi giờ khách `cadence.timezone`; `item.time_source` ghi nguồn chọn giờ; `info.publicationDate` mang múi giờ đó, Metricool tự quy đổi. Không có `--draft`/`--schedule`. Bài cũ từng gửi dạng nháp được gửi lại thành bài hẹn giờ (`record` ghi `replaced_draft`; xoá nháp cũ trong Metricool).
- Với từng item: gọi tool `createScheduledPost` với **đúng** `args.blogId`, `args.date`, `args.info` (chuỗi JSON, không sửa). Rồi ngay (lệnh có sẵn trong `item.record`):
  ```
  node scripts/metricool-mcp.mjs record --brand <id> --post POST-xx --id <id> --uuid <uuid> --planner-url <plannerUrl> --publication <publicationDate.dateTime> --tz <publicationDate.timezone>
  ```
  `record` ghi `metricool.<network>` + `schedule.<network>` vào catalog, trạng thái `scheduled` (Queued), rồi chạy `check-post.mjs`. Tool lỗi → không `record`, báo cáo; lượt sau `payload` đưa lại bài đó.

2.2. Đối chiếu bài đã gửi:
```
node scripts/metricool-mcp.mjs status --brand <id>
```
Có `query` thì gọi `getScheduledPosts` đúng tham số, khớp theo `id`: PENDING → để yên; **ERROR** → báo cáo (id, plannerUrl, lý do; app hiện dấu đỏ); **PUBLISHED** → `node <skills folder>/<id>-skills/scripts/mark-published.mjs <POST-xx> <yyyy-mm-dd> [link] --lang <ngôn ngữ đăng>` (Posted). Sau khi đã đăng mới được gỡ file host: `node scripts/host-image.mjs remove --brand <id> --post POST-xx`.

2.3. Ý từ kho (chỉ bài `new`; bài được đánh dấu `used`, `used_by` = mã ý, không dùng lại):
```
node scripts/ideas.mjs init --brand <id> [--count N] [--items S0001,S0002] [--source <sid>]
node scripts/ideas.mjs set  --brand <id> --id I001 --json "{\"product_type\":\"...\",\"scene\":\"...\",\"angle\":\"...\",\"props\":\"...\",\"caption_structure\":\"...\",\"hook\":\"...\",\"why\":\"...\"}"
node scripts/ideas.mjs pick --brand <id> --id I001
node scripts/ideas.mjs reject --brand <id> --id I001 --note "<lý do>" [--item rejected]
```
Mặc định `--count` = số bài còn thiếu để phủ `settings.planning.ahead_days` ngày tới (mặc định 7) với `cadence.posts_per_day` bài/ngày (trừ bài đã duyệt chưa đăng và bản nháp đang làm/chờ duyệt; đủ rồi thì không làm thêm), bài mới nhất trước, xen kẽ các nguồn. Điền ý theo `prompts/idea-abstract.md` (ý trừu tượng, không chép chữ/số điện thoại/link/tên shop: `set` chặn).

2.4. Bản nháp và ảnh:
```
node scripts/draft.mjs new --brand <id> --idea I001 --product "<ảnh sản phẩm của thương hiệu>" [--scene "<ảnh không khí>"]
node scripts/draft.mjs new --brand <id> --idea I001 --ref-image "workspace/store/<id>/images/S0001-1-....jpg" --brand-can-produce   # scene-swap, chỉ khi bật
node scripts/draft.mjs image --id <draft> [--force]
node scripts/draft.mjs watermark --id <draft>                    # chỉ khi product_images.watermark.enabled
node scripts/draft.mjs confirm-clean --id <draft> --by "<tên>"   # chỉ scene-swap, sau khi xem kỹ
```
- Ảnh sản phẩm (`brand-image`, mặc định): trong thư mục skill hoặc `product_images.sources`. Ảnh không khí không được là ảnh kho/đối thủ.
- Trước `image`: mở `prompt.txt`, thay `{{PRODUCT_DESCRIPTION}}` bằng mô tả đúng sản phẩm (chữ từng ký tự, dấu, font, màu, vật liệu, tỉ lệ); **không xoá dòng NO LOGO**.
- `image` chạy `codex exec --skip-git-repo-check -s workspace-write - -i <ảnh> < prompt.txt`, rồi tự làm sạch metadata (`settings.remove_watermark.script`): `image-generated.png` (gốc) → `image.png` (sạch) + `image-clean-report.json`. Xem ảnh: sai thì sửa prompt, `--force` (tối đa 2 lần). Sandbox chặn `codex exec` lồng nhau thì báo người dùng.
- Scene-swap (opt-in `product_images.reference_redraw.enabled`): ảnh kho của chính thương hiệu, chỉ đổi cảnh, xoá logo/watermark/nhãn size/số điện thoại của shop; bắt buộc `--brand-can-produce` và `confirm-clean`.

2.5. Caption theo `brief.md` (SKILL.md mục A + project.md): `content-<lang>.txt` cho ngôn ngữ đăng (`channels[].lang`, vd `content-en.txt`) và ngôn ngữ chỉ để đọc (`language_policy.review_langs`, vd `content-vn.txt`; không bao giờ đăng). Không nhắc tên shop nguồn, không nhãn AI.

2.6. Kiểm tra tự động:
```
node scripts/draft.mjs check --id <draft>        # qua hết → "ready" (To review); không qua → "needs_caption" + problems
```
Kiểm: ảnh sạch metadata (điểm ảnh không đổi), đủ caption từng ngôn ngữ, dòng Website và hashtag cố định, không Markdown/ký tự ẩn, không chép caption tham khảo, không nhãn AI, prompt có NO LOGO, watermark nếu bật, scene-swap đã `confirm-clean` và caption không có tên shop. Sửa rồi chạy lại tới khi `ready`.

2.7. **Dừng ở To review.** Agent không duyệt, không ghi vào skill, không host ảnh, không gửi bài mới này. Người dùng xem trong app (tab **Posts** → Preview): **Approve** chạy `node scripts/finalize.mjs approve --id <draft>` (kiểm lại lần nữa, ghi `workspace/posts/POST-<slug>/` + mục `approved` trong `catalog.json` của skill, chạy `check-post.mjs`, host ảnh → `media_url`); không qua → `check_failed` + lý do. **Drop** = `node scripts/finalize.mjs cancel --id <draft> [--note ".."]`. Host lỗi không huỷ bài: chạy lại `node scripts/host-image.mjs publish --brand <id> --post POST-xx` (có trong `image_host.next`). Lượt Create & publish sau gửi bài đã duyệt ở bước 2.1.

2.8. Số liệu báo cáo:
```
node scripts/queue.mjs
```

2.9. Ghi nhật ký lượt chạy (bước gần cuối của mọi lượt):
```
node scripts/runlog.mjs add --mode create --agent "<Claude Code|Codex>" [--started <giờ bắt đầu ISO>] [--file <ghi chú.json>]
```
Tool tự lấy số liệu (bài đã hẹn giờ ở lượt này, bài mới chờ duyệt, bài lỗi) và ghi `workspace/logs/runs/<thời điểm>-create.json`; người dùng xem ở tab **Log**. Agent chỉ thêm ghi chú/lỗi bằng file JSON `{ "notes": "...", "errors": ["..."], "brands": { "<id>": { "notes": "...", "errors": ["..."] } } }`.

2.10. Báo cáo cho người dùng, tiếng Việt, **luôn đúng các mục sau** (giống tab Log):
- **Kết quả chung:** N bài đã hẹn giờ · N bài chờ duyệt · N lỗi.
- **Đã hẹn giờ:** POST-xx · giờ đăng (múi giờ brand) · plannerUrl.
- **Chờ duyệt (To review):** từng bài: caption EN nguyên văn, bản VN ghi rõ "chỉ để đọc, không đăng". Nhắc mở tab **Posts** để Approve/Drop.
- **Lỗi:** bài lỗi Metricool, bài bị chặn, bài không qua kiểm tra, kèm lý do.
- **Khác:** brand Metricool mới/mất (2.0), bài đã đăng, kho còn bao nhiêu bài Unused.

## Mode 3. Publish approved

Chỉ gửi lên Metricool các bài người dùng đã **Approve** mà chưa gửi. Không làm ý, không tạo bài, không mở trình duyệt. Dùng lại đúng các bước của Mode 2, không lặp lại ở đây:
- Setup (như mọi lượt), rồi **2.0** (đồng bộ brand và giờ đăng tốt nhất), **2.1** (hẹn giờ thật mọi bài đã duyệt chưa gửi), **2.2** (đối chiếu), **2.8** (số liệu: `node scripts/queue.mjs`).

3.1. Ghi nhật ký lượt chạy: như 2.9 nhưng `--mode publish`:
```
node scripts/runlog.mjs add --mode publish --agent "<Claude Code|Codex>"
```

3.2. Báo cáo cho người dùng, tiếng Việt, **luôn đúng các mục**: **Kết quả chung** (N bài đã hẹn giờ · N lỗi), **Đã hẹn giờ** (POST-xx · giờ đăng · plannerUrl), **Lỗi** (bài lỗi Metricool hoặc bị chặn, kèm lý do), **Khác** (brand Metricool mới/mất, bài đã đăng). Nhắc: bài chờ duyệt (To review) vẫn nằm ở tab **Posts**.

## Phụ lục: ảnh/video host

`host-image.mjs` (gọi tự động khi Approve) chép ảnh sạch của bài đã duyệt vào clone của repo **công khai** `social-autopilot-sources` (`settings.imageHost.path`, mặc định `../social-autopilot-sources`), đường dẫn `<brand>/<yyyy>/<mm>/<post-id>.<ext>`, commit "<brand> <post-id>", push, chờ HTTP 200, ghi `media_url` dạng link raw GitHub:
```
https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<brand>/<yyyy>/<mm>/<post-id>.png
```
(`imageHost.rawBase` = `https://raw.githubusercontent.com/<owner>/social-autopilot-sources/main`). Không dùng tên miền riêng/cá nhân. Không bao giờ host bản nháp hay ảnh đối thủ. Raw trả `.mp4` dạng `application/octet-stream`; qua MCP Metricool video nên vẫn được vì Metricool chép media về kho của nó, nhưng **chưa test**. Chỉ gỡ file sau khi bài đã đăng (`host-image.mjs remove`).

## Phụ lục: CSV cho Metricool (chỉ dự phòng khi MCP không dùng được; người dùng tự import)

```
node scripts/metricool-csv.mjs export --brand <id> [--posts POST-01,POST-02] [--lang en] [--date YYYY-MM-DD --time HH:MM] --out <file.csv>
node scripts/metricool-csv.mjs validate <file.csv> [--brand <id>] [--allow-today] [--check-urls]
```
Chỉ bài đã duyệt có `media_url`/`video_url`; đúng 99 cột theo `docs/metricool-csv-template.csv`; chỉ ngôn ngữ đăng; nhãn AI và link WebP bị từ chối; brand `removed` bị chặn; bài đã gửi qua MCP bị bỏ qua. Giờ quy đổi sang múi giờ brand Metricool (CSV không có cột timezone).

## Phụ lục: lệnh khác

```
node scripts/store.mjs list|show|reject|restore|classify|verdict|known --brand <id> [...]   # kho (tab Library dùng cùng hàm)
node scripts/store.mjs migrate [--brand <id>]                             # dữ liệu cũ workspace/runs/*/refs.json → kho
node scripts/prompts.mjs list | show --mode "<mode>" --agent "<agent>" [--brand <id>]
node scripts/social.mjs show|set --brand <id> ...                          # social.json an toàn (chặn token, chạy check-skill)
node scripts/research.mjs clean --in <file> [--out <file>]                 # lọc U+034F / zero-width / NBSP
node scripts/image-clean.mjs --id <draft>                                  # làm sạch metadata lại
node scripts/writeback.mjs --id <draft>                                    # chạy lại ghi vào skill khi Approve lỗi giữa chừng
```
