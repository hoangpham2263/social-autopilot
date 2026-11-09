# RUNBOOK: social-autopilot (2 chế độ)

Scripts + RUNBOOK là nguồn duy nhất của quy trình. Agent nào cũng chạy được (Claude Code, Codex; ChatGPT chỉ phần gửi Metricool): mọi bước là lệnh `node scripts/...` chạy trong `C:\hoangpq\social-autopilot`, in **một JSON** (`ok: true|false`); đọc JSON, không đoán. Chạy lại không sinh trùng. Prompt dán sẵn cho từng chế độ × agent: `docs/scheduled-prompt.md` (tab **Prompt** của app). App chỉ để xem và quản lý (Tổng quan, Kho, Bài đã tạo, Prompt, Cài đặt); việc do agent làm.

Hai chế độ, **không có bước duyệt** (người dùng, 09/11/2026):
1. **Chỉ nghiên cứu**: chạy riêng (vd mỗi tuần), cần trình duyệt đã đăng nhập Facebook. Nguồn → **kho** của thương hiệu. Không làm ý/bài.
2. **Làm bài & đưa lên**: khi người dùng bảo, không mở Facebook. Gửi nốt bài cũ chưa gửi → đối chiếu → kho → ý → ảnh → caption → kiểm tra tự động → ghi vào thương hiệu → host ảnh → Metricool (mặc định nháp) → `record` → báo cáo.

Quy tắc cứng (cả hai chế độ):
- Thương hiệu chỉ đến từ `config/settings.json` → `skillsRoot` (mặc định `C:\hoangpq\vaniecom-workspace\skills\`). Ngoài ra, brand Metricool có thể trỏ tới thư mục skill ở nơi khác (`skill_path`). Skill **không bao giờ được chép** vào tool: mỗi brand Metricool **trỏ tới** một thư mục skill (`skill_path` trong `workspace/metricool-brands.json`, đường dẫn là chuẩn; mục cũ chỉ có `skill_id` = `skillsRoot/<id>-skills`), tool đọc/ghi thẳng trong thư mục đó. Thêm cửa hàng = Tổng quan → **Chọn skill** (Tìm trong `C:hoangpqaniecom-workspace` sâu 2 tầng, mỗi thư mục kèm trạng thái Dùng được/Còn thiếu) hoặc `node scripts/skills.mjs link --brand "<tên Metricool>" --path <thư mục skill>`. **Ngắt kết nối** (`skills.mjs unlink`) chỉ bỏ liên kết, không đụng thư mục; từ đó không gửi gì của brand đó lên Metricool. Thư mục đã trỏ mà bị đổi tên/di chuyển: thẻ báo "Không tìm thấy thư mục skill", dùng Đổi skill. Mọi thứ riêng của thương hiệu đọc từ thư mục skill của nó. Không hard-code thương hiệu, không trộn nguồn hay kho giữa thương hiệu. Các thương hiệu chạy **nối tiếp**.
- Không dùng ảnh hay câu chữ của đối thủ trong bài; ảnh đưa vào Codex là ảnh của chính thương hiệu (trừ scene-swap opt-in).
- Không bao giờ gắn nhãn AI lên bài; không đăng thẳng lên mạng xã hội; Metricool mặc định **nháp** (`settings.metricool.default_mode`).
- Gặp `ok: false`: ghi lại, chuyển sang bài/thương hiệu tiếp, không lách luật.

## Rules for every run (prompt ngắn ở tab Prompt trỏ về đây)

Prompt ở tab Prompt chỉ ghi chế độ, thương hiệu, tuỳ chọn (`Options:`) và agent; mọi bước nằm ở RUNBOOK này. Luật chung:
- Chỉ thương hiệu usable (`brands.mjs`), **lần lượt từng thương hiệu**, không song song. "all usable brands" = mọi thương hiệu usable.
- Tuỳ chọn của lượt (dòng `Options:`) ưu tiên hơn mặc định: Research → `--source a,b`, `--since YYYY-MM-DD`, `--max-posts N`, `--backfill` hoặc `--full` cho `research.mjs start`; Create → `--count N` cho `ideas.mjs init` (để trống = `cadence.posts_per_week`), `--draft`/`--schedule` cho `metricool-mcp.mjs payload` (để trống = `settings.metricool.default_mode`).
- Mỗi thương hiệu, trước khi làm bài: đọc `SKILL.md` và `project/project.md` của skill.
- Không đăng thẳng lên mạng xã hội; không nhãn AI; không tên shop nguồn; không đăng nhập hộ, không lưu cookie.
- Không bao giờ tạo/sửa bài cho Fortera Apparel (blogId `<blog_id_1>`) hay dùng blogId khác `args.blogId`; không `createScheduledPostForReview`.
- Lệnh trả `ok:false`: ghi lý do vào báo cáo, đi tiếp; không lách luật. Hết lượt Codex (tạo ảnh) thì dừng tạo ảnh và báo.
- Codex tạo ảnh bằng `codex exec` lồng nhau: sandbox chặn thì báo người dùng.
- Báo cáo bằng tiếng Việt (mục 1.5 / 2.7), nhắc người dùng xem tab Library / Posts của app.
- Codex không có MCP trình duyệt (Mode 1): dừng ngay, báo "thêm `[mcp_servers.playwright]` (`npx -y @playwright/mcp@latest --extension`) vào `~/.codex/config.toml`, hoặc chạy bằng Claude Code". Không có MCP Metricool (Mode 2): làm bài tới 2.5, ghi trong báo cáo "chưa gửi Metricool: Codex chưa có MCP Metricool (`codex mcp add metricool --url https://ai.metricool.com/mcp`; `codex mcp login metricool`)", bài gửi ở lượt sau.

### ChatGPT (web/desktop, không chạy được lệnh trên máy)

Không làm được Mode 1 và phần làm bài của Mode 2. Chỉ gửi nốt bài đã xong khi người dùng dán JSON của `node scripts/metricool-mcp.mjs payload --brand <id>` dưới prompt. Với từng phần tử `items`: gọi `createScheduledPost` với ĐÚNG `args.blogId`, `args.date`, `args.info` (chuỗi JSON giữ nguyên, không thêm hashtag/nhãn AI, không đổi draft; ảnh đã ở `info.media`, chỉ dùng `mediaFiles` khi người dùng tự đính kèm và bảo dùng), ghi `id`, `uuid`, `plannerUrl`, `publicationDate.dateTime`, `publicationDate.timezone`. Bỏ qua `blocked`, `skipped`. Trả lời tiếng Việt: bài đã gửi (POST-xx, nháp/hẹn giờ, giờ, plannerUrl) và lệnh `item.record` đã điền giá trị thật cho từng bài; bài lỗi ghi lý do.

## Bước chung. Thương hiệu và nguồn

```
node scripts/brands.mjs          # usable = thương hiệu chạy được; problems/skipped = lý do bỏ qua
node scripts/sources.mjs         # mỗi thương hiệu: các research.sources đang bật trong social.json của nó
```

## Chế độ 1. Chỉ nghiên cứu

Cần trình duyệt đã đăng nhập Facebook (Playwright MCP + extension trong Chrome; Claude Code hoặc Codex có MCP trình duyệt). Cách duyệt trang: `docs/research.md`.

1.1. Mở lượt crawl cho một thương hiệu:
```
node scripts/research.mjs start --brand <id> [--source a,b] [--since YYYY-MM-DD] [--max-posts N] [--full | --backfill]
```
Mặc định: lấy **hết** bài (cuộn tới hết trang); lần sau chỉ lấy bài mới ở đầu trang (dừng sau 3 bài liên tiếp đã có trong kho). `--since` / `--max-posts` khi người dùng chọn khoảng; `--full` cuộn hết dù đã có (chậm). Lần đầu có thể giới hạn bằng `--max-posts`/`--since`; các bài cũ hơn lấy dần bằng `--backfill`: cuộn nhanh qua bài đã có (không mở), bắt đầu lấy khi đã qua `oldest_seen` (bài cũ nhất của nguồn trong kho), tới hết trang / `--since` / `--max-posts`; nguồn đã `reached_end` thì bỏ qua (`run.skipped`). Tiến độ từng nguồn: `workspace/store/<brand>/progress.json` (`newest_seen`, `oldest_seen`, `reached_end`, `last_run`). Mỗi source trong `run.sources` có `stop_rule` (khi nào dừng) và `known_file` (`known.json`: link bài của nguồn này + mọi link/mã bài Facebook đã có trong kho của thương hiệu: `brand_post_urls`, `brand_post_ids`).

1.2. Với từng source, theo `docs/research.md`: cuộn trang theo `stop_rule`; bài có link/mã trong `known.json` thì bỏ qua **trước khi tải**; mở bài mới lấy caption đầy đủ, ngày đăng, link bài (+ `alt_urls`), tải ảnh lớn nhất vào `<source>/raw/`, ghi `<source>/raw.json`. Nghỉ ngẫu nhiên `delay_seconds` giữa mọi thao tác.

1.3. Đưa vào kho:
```
node scripts/research.mjs ingest --brand <id> --source <sid>
```
Làm sạch caption (U+034F, ký tự ẩn), chỉ nhận ảnh jpg/png/webp thật trong thư mục source, **bỏ trùng** với cả kho của thương hiệu (mọi nguồn): cùng link/mã bài Facebook, cùng ảnh (SHA-1 hoặc ảnh gần giống, dHash), cùng caption (giống hệt hoặc ≥ 90%). Bài trùng không vào kho, được ghi vào `workspace/store/<brand>/duplicates.json` (khớp bài nào, luật nào); JSON in `duplicates` ("x bài trùng bỏ qua").

1.4. Ghi cách source kết thúc:
```
node scripts/research.mjs result --brand <id> --source <sid> --state end|known|since|limit|partial [--note "..."]
```
Lượt `--backfill` không dùng `known`. `end` ghi `reached_end` (đã lấy tới bài cũ nhất).
Gặp checkpoint, captcha, yêu cầu đăng nhập, "tạm thời bị chặn": dừng ngay, `--state blocked --note "<lý do>"`, không mở thêm source nào.

1.5. Báo cáo:
```
node scripts/research.mjs report --brand <id>
```
Báo người dùng: từng nguồn bài mới ở đầu trang (`new_on_top`), bài cũ lấy thêm (`backfilled`), đã tới hết trang chưa (`reached_end_text`: còn bài cũ thì `older_posts` nhắc chạy `--backfill`), bài trùng bỏ qua, nguồn đã xong, nguồn bị chặn, nguồn backfill bỏ qua (`skipped`), tổng kho (mới/đã dùng/đã bỏ). Người dùng xem kho ở tab **Kho** của app (lọc theo trạng thái/nguồn, "Bỏ" bài không muốn dùng = `store.mjs reject`).

Không làm ý, không tạo bài, không gửi Metricool trong chế độ này.

## Chế độ 2. Làm bài & đưa lên

Không mở Facebook. Cần `node`, Codex CLI (tạo ảnh) và tool MCP Metricool (Claude: connector claude.ai "Metricool"; Codex: `codex mcp add metricool --url https://ai.metricool.com/mcp` + `codex mcp login metricool`). Không có tool Metricool: vẫn làm bài tới bước 2.5, báo rõ "chưa gửi Metricool", bài chờ lượt sau.

2.0. Gửi nốt và đối chiếu (đầu mỗi lượt, từng thương hiệu):
```
node scripts/metricool-mcp.mjs payload --brand <id>     # bài đã ghi + có link ảnh mà chưa gửi (bài đã gửi tự bị bỏ)
node scripts/metricool-mcp.mjs status  --brand <id>     # tham số getScheduledPosts để đối chiếu
```
Gửi `items` như bước 2.6. Với `status`: có `query` thì gọi `getScheduledPosts` đúng tham số, khớp theo `id`: PENDING/nháp → để yên; **ERROR** → báo cáo; **PUBLISHED** → `node <thư mục skill>/scripts/mark-published.mjs <POST-xx> <yyyy-mm-dd> [link] --lang <ngôn ngữ đăng>`; nháp mà người đã hẹn giờ trong Metricool → chạy lại `record` (cùng `--id`, không `--draft`).

2.1. Ý từ kho (chỉ bài `new`; bài được đánh dấu `used`, `used_by` = mã ý, không dùng lại):
```
node scripts/ideas.mjs init --brand <id> [--count N] [--items S0001,S0002] [--source <sid>]
node scripts/ideas.mjs set  --brand <id> --id I001 --json "{\"product_type\":\"...\",\"scene\":\"...\",\"angle\":\"...\",\"props\":\"...\",\"caption_structure\":\"...\",\"hook\":\"...\",\"why\":\"...\"}"
node scripts/ideas.mjs pick --brand <id> --id I001
node scripts/ideas.mjs reject --brand <id> --id I001 --note "<lý do>" [--item rejected]
```
Mặc định `--count` = `cadence.posts_per_week` (không có thì 3), bài mới nhất trước, xen kẽ các nguồn. Điền ý theo `prompts/idea-abstract.md` (ý trừu tượng, không chép chữ/số điện thoại/link/tên shop: `set` chặn).

2.2. Bản nháp và ảnh:
```
node scripts/draft.mjs new --brand <id> --idea I001 --product "<ảnh của thương hiệu>" [--scene "<ảnh không khí>"]
node scripts/draft.mjs new --brand <id> --idea I001 --ref-image "<workspace/store/<id>/images/S0001-1-....jpg>" --brand-can-produce   # scene-swap, chỉ khi bật
node scripts/draft.mjs image --id <draft> [--force]
node scripts/draft.mjs watermark --id <draft>        # chỉ khi product_images.watermark.enabled
node scripts/draft.mjs confirm-clean --id <draft> --by "<tên>"   # chỉ scene-swap, sau khi xem kỹ
```
- Ảnh sản phẩm (`brand-image`, mặc định): trong thư mục skill hoặc `product_images.sources`. Ảnh không khí không được là ảnh của kho/đối thủ.
- Trước `image`: mở `prompt.txt`, thay `{{PRODUCT_DESCRIPTION}}` bằng mô tả đúng sản phẩm (chữ từng ký tự, dấu, font, màu, vật liệu, tỉ lệ); không xoá dòng NO LOGO.
- `image` chạy `codex exec --skip-git-repo-check -s workspace-write - -i <ảnh> < prompt.txt`, rồi tự làm sạch metadata (remove-watermark-skill): `image-generated.png` (gốc) → `image.png` (sạch) + `image-clean-report.json`. Xem ảnh: sai thì sửa prompt, `--force` (tối đa 2 lần). Hết lượt Codex thì dừng và báo.
- Scene-swap (opt-in `product_images.reference_redraw.enabled`): ảnh kho của chính thương hiệu, chỉ đổi cảnh, xoá logo/watermark/nhãn size/số điện thoại của shop; bắt buộc `--brand-can-produce` và `confirm-clean`.

2.3. Caption theo `brief.md` (SKILL.md mục A + project.md): `content-<lang>.txt` cho ngôn ngữ đăng (`channels[].lang`, vd `content-en.txt`) và ngôn ngữ chỉ để đọc (`language_policy.review_langs`, vd `content-vn.txt`; không bao giờ đăng). Không nhắc tên shop nguồn, không nhãn AI.

2.4. Kiểm tra tự động:
```
node scripts/draft.mjs check --id <draft>        # qua hết → "ready"; không qua → "needs_caption" + problems
```
Kiểm: ảnh sạch metadata (điểm ảnh không đổi), đủ caption từng ngôn ngữ, dòng Website và hashtag cố định, không Markdown/ký tự ẩn, không chép caption tham khảo, không nhãn AI, prompt có NO LOGO (cảnh báo), watermark nếu bật, scene-swap đã `confirm-clean` và caption không có tên shop.

2.5. Ghi vào thương hiệu và host ảnh:
```
node scripts/finalize.mjs run --brand <id>       # mọi bản "ready" của thương hiệu (hoặc --id <draft>)
```
Kiểm lại lần nữa; không qua → `check_failed` + lý do, dừng riêng bài đó; qua → `writeback.mjs` tạo `workspace/posts/POST-<slug>/` + mục `approved` trong `catalog.json` của skill (`approval.by: "auto"`, `captions` = ngôn ngữ đăng, `review_captions` = chỉ để đọc, `inspiration.store_item`), chạy `check-post.mjs` của skill, rồi `host-image.mjs` đẩy ảnh lên repo công khai `C:\hoangpq\social-autopilot-sources` và ghi `media_url` (link raw ngay, đổi sang GitHub Pages khi sẵn sàng). Host lỗi không huỷ bài: chạy lại `node scripts/host-image.mjs publish --brand <id> --post POST-xx` (lệnh có trong `image_host.next`). Muốn bỏ một bài trước khi ghi: `node scripts/finalize.mjs cancel --id <draft> [--note ".."]` (hoặc nút Bỏ ở tab Bài đã tạo).

2.6. Gửi Metricool qua MCP:
```
node scripts/metricool-mcp.mjs payload --brand <id> [--posts POST-xx,...] [--draft|--schedule]
```
- Mỗi `items[]` = một bài `approved` có `media_url`/`video_url`, chưa có `metricool.<network>.id`, qua `check-post.mjs`. Bài không qua kiểm (check-post lỗi, giờ đã qua, nhãn AI...) nằm trong `blocked` với lý do; bài khác vẫn đi.
- Mặc định theo `settings.metricool.default_mode` (`draft`: nháp, không tự đăng; `schedule`: hẹn giờ thật). `--draft`/`--schedule` ghi đè cho một lần.
- Với từng item: gọi tool `createScheduledPost` với **đúng** `args.blogId`, `args.date`, `args.info` (chuỗi JSON, không sửa). Rồi ngay:
  ```
  node scripts/metricool-mcp.mjs record --brand <id> --post POST-xx --id <id> --uuid <uuid> --planner-url <plannerUrl> --publication <publicationDate.dateTime> --tz <publicationDate.timezone> [--draft]
  ```
  (lệnh có sẵn trong `item.record`). `record` ghi `metricool.<network>` vào catalog; hẹn giờ thật thì thêm `schedule.<network>` + `scheduled`; rồi chạy `check-post.mjs`. Tool lỗi → không `record`, báo cáo; lượt sau `payload` đưa lại bài đó.
- Không bao giờ tạo hay sửa bài cho Fortera Apparel (blogId `<blog_id_1>`); không `createScheduledPostForReview`.
- Giờ: `info.publicationDate` mang múi giờ khách (`cadence.timezone`), Metricool tự quy đổi. Text chỉ gồm ngôn ngữ đăng, không `review_langs`, không nhãn AI.
- Chỉ gỡ file trên repo ảnh khi bài đã `published`: `node scripts/host-image.mjs remove --brand <id> --post POST-xx`.

2.7. Báo cáo:
```
node scripts/queue.mjs
```
Mỗi thương hiệu: kho (`store`), nghiên cứu gần nhất, bài đã ghi (`written`: POST-xx, link ảnh hoặc lỗi host, trạng thái Metricool `draft|scheduled|published|error|not_sent` + `planner_url`), bài lỗi (`failed`), bài đang làm. Báo người dùng: từng bài (POST-xx, ảnh, caption EN nguyên văn, bản VN ghi rõ "chỉ để đọc, không đăng", link ảnh, Metricool), bài cũ đã gửi nốt, bài lỗi và lý do, kho còn bao nhiêu bài `new`. Nhắc mở app (tab Bài đã tạo).

## Phụ lục: CSV cho Metricool (chỉ dự phòng khi MCP không dùng được; không tự import)

```
node scripts/metricool-csv.mjs export --brand <id> [--posts POST-01,POST-02] [--draft] [--lang en] [--date YYYY-MM-DD --time HH:MM] --out <file.csv>
node scripts/metricool-csv.mjs validate <file.csv> [--brand <id>] [--allow-today] [--check-urls]
```
- Chỉ bài `approved` có `media_url` hoặc `video_url`; đúng 99 cột theo `docs/metricool-csv-template.csv`; chỉ ngôn ngữ đăng; nhãn AI và link WebP bị từ chối. Bài đã gửi qua MCP bị bỏ qua.
- Giờ: catalog `schedule`, `--date/--time`, `cadence.slots`, hoặc tự động (bảng ở `docs/metricool.md`), quy đổi sang múi giờ brand Metricool. Người dùng tự nhập file trong Metricool.

## Phụ lục: lệnh khác

```
node scripts/store.mjs list|show|reject|restore|known --brand <id> [...]   # kho (app tab Kho dùng cùng hàm)
node scripts/store.mjs migrate [--brand <id>]                             # dữ liệu cũ workspace/runs/*/refs.json → kho
node scripts/prompts.mjs list | show --mode "<chế độ>" --agent "<agent>" [--brand <id>]
node scripts/social.mjs show|set --brand <id> ...                          # social.json an toàn (chặn token, chạy check-skill)
node scripts/research.mjs clean --in <file> [--out <file>]                 # lọc U+034F / zero-width / NBSP
node scripts/image-clean.mjs --id <draft>                                  # làm sạch metadata lại
node scripts/writeback.mjs --id <draft>                                    # chạy lại ghi vào thương hiệu khi lỗi giữa chừng
```
