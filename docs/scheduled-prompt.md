# Prompt dán sẵn (2 chế độ, mỗi agent một bản)

Nguồn duy nhất của các prompt: app (tab **Prompt**) và `node scripts/prompts.mjs show --mode "<chế độ>" --agent "<agent>" [--brand <id>]` đọc thẳng file này. Mỗi prompt là một mục `### <chế độ> · <agent>` với một khối `text`; `{{BRAND}}` được thay bằng mã thương hiệu (vd `dreamyvows`, `grenheim`) hoặc "tất cả thương hiệu usable".

Quy trình chỉ có hai chế độ, không có bước duyệt (người dùng, 09/11/2026):
1. **Chỉ nghiên cứu**: chạy riêng (vd mỗi tuần), cần trình duyệt đã đăng nhập Facebook. Crawl mọi nguồn của thương hiệu vào **kho** (`workspace/store/<brand>/`), bỏ trùng, báo cáo. Không làm ý/bài.
2. **Làm bài & đưa lên**: khi người dùng bảo, không mở Facebook. Đầu lượt: gửi nốt bài đã làm xong mà chưa gửi Metricool (payload tự bỏ bài đã gửi) và đối chiếu bài đã gửi. Rồi kho → ý → ảnh → caption → kiểm tra tự động → ghi vào skill thương hiệu (approved, by `auto`) → host ảnh → gửi Metricool qua MCP (mặc định **nháp**, `settings.metricool.default_mode`) → `record` → báo cáo. Bài không qua kiểm tra dừng riêng. Agent không có tool Metricool thì báo rõ và để bài lại; lượt sau agent có connector sẽ gửi.

Agent: tất cả bước là lệnh `node scripts/...` in JSON, không phụ thuộc agent nào. Khác nhau chỉ ở công cụ ngoài:
- **Claude Code**: Playwright MCP (`npx @playwright/mcp@latest --extension`, extension Playwright MCP Bridge trong Chrome đã đăng nhập) cho nghiên cứu; connector claude.ai "Metricool" cho Metricool; Codex CLI để tạo ảnh.
- **Codex** (Codex CLI / app Codex): đọc `AGENTS.md`. Nghiên cứu cần MCP trình duyệt trong `~/.codex/config.toml` (`[mcp_servers.playwright]`, `command = "npx"`, `args = ["-y", "@playwright/mcp@latest", "--extension"]`). Metricool: `codex mcp add metricool --url https://ai.metricool.com/mcp` rồi `codex mcp login metricool` (kiểm tra bằng `codex mcp list`; hoặc `[mcp_servers.metricool]` với `url = "https://ai.metricool.com/mcp"` trong `~/.codex/config.toml`); chưa có thì bài chờ lượt sau.
- **ChatGPT** (web/desktop, đã nối Metricool): không chạy được lệnh trên máy. Chỉ gửi nốt được bài đã làm xong khi người dùng dán JSON của `metricool-mcp.mjs payload`; còn lại phải chạy bằng Claude Code hoặc Codex.

### Chỉ nghiên cứu · Claude Code

Cần: Playwright MCP gắn Chrome đã đăng nhập Facebook (tài khoản phụ), quyền chạy `node` trong thư mục tool.

```text
Chế độ: CHỈ NGHIÊN CỨU. Thương hiệu: {{BRAND}}.
Thư mục: C:\hoangpq\social-autopilot. Đọc AGENTS.md, RUNBOOK.md (Chế độ 1) và docs/research.md, làm đúng từng bước.

1. node scripts/brands.mjs; node scripts/sources.mjs. Chỉ thương hiệu usable; mỗi lần một thương hiệu, không song song.
2. node scripts/research.mjs start --brand <id> (thêm --since YYYY-MM-DD, --max-posts N, --full hoặc --backfill nếu tôi yêu cầu; lần đầu có thể giới hạn bằng --max-posts/--since; các bài cũ hơn lấy dần bằng --backfill). Đọc run.sources: stop_rule, known_file, oldest_seen; run.skipped là nguồn backfill bỏ qua (đã reached_end).
3. Với từng source, bằng Playwright MCP trên Chrome đã đăng nhập: mở trang, tab Bài viết/Ảnh, cuộn tới khi đúng stop_rule (hết trang, gặp 3 bài liên tiếp đã có trong known.json, tới mốc --since, đủ --max-posts). Lượt --backfill: cuộn nhanh qua bài đã có (không mở, chỉ đối chiếu link/mã với known.json) tới khi qua oldest_seen rồi mới lấy, theo docs/research.md mục Backfill. Bỏ qua bài có link/mã đã nằm trong known.json (brand_post_urls, brand_post_ids) TRƯỚC khi tải. Mở từng bài mới lấy caption đầy đủ, ngày đăng, link bài (và link ảnh trong alt_urls), tải ảnh lớn nhất vào <source>/raw/, ghi <source>/raw.json. Nghỉ ngẫu nhiên delay_seconds giữa mọi thao tác.
4. node scripts/research.mjs ingest --brand <id> --source <sid>, rồi node scripts/research.mjs result --brand <id> --source <sid> --state <end|known|since|limit|partial> [--note "..."] (lượt --backfill không dùng known).
5. Gặp checkpoint, captcha, yêu cầu đăng nhập, "tạm thời bị chặn": dừng ngay, research.mjs result --state blocked --note "<lý do>", không mở thêm source nào.
6. Cuối cùng: node scripts/research.mjs report --brand <id>; báo tôi bằng tiếng Việt: từng nguồn số bài mới ở đầu trang (new_on_top), số bài cũ lấy thêm (backfilled), đã tới hết trang chưa (reached_end; còn bài cũ thì nhắc --backfill), số bài trùng bỏ qua, nguồn đã xong, nguồn bị chặn và lý do, tổng kho (mới/đã dùng/đã bỏ). Nhắc tôi xem kho ở tab Kho của app.

Không làm ý tưởng, không tạo bài, không đăng gì, không gửi gì lên Metricool. Không đăng nhập hộ, không lưu cookie. Script trả ok:false thì ghi lý do và đi tiếp, không lách luật.
```

### Chỉ nghiên cứu · Codex

Cần: Codex CLI có MCP trình duyệt (Playwright MCP như trên, cùng extension trong Chrome đã đăng nhập). Không có công cụ trình duyệt thì chế độ này phải chạy bằng Claude Code.

```text
Chế độ: CHỈ NGHIÊN CỨU. Thương hiệu: {{BRAND}}.
Thư mục làm việc: C:\hoangpq\social-autopilot. Đọc AGENTS.md (luật chung), RUNBOOK.md (Chế độ 1) và docs/research.md.

Trước hết kiểm tra bạn có công cụ trình duyệt (MCP playwright, gắn Chrome đã đăng nhập Facebook qua extension). Nếu KHÔNG có: dừng ngay, không làm gì, báo tôi "Chế độ nghiên cứu cần MCP trình duyệt: thêm [mcp_servers.playwright] (npx -y @playwright/mcp@latest --extension) vào ~/.codex/config.toml, hoặc chạy bằng Claude Code".

Nếu có:
1. node scripts/brands.mjs; node scripts/sources.mjs. Chỉ thương hiệu usable, lần lượt từng thương hiệu.
2. node scripts/research.mjs start --brand <id> [--since YYYY-MM-DD | --max-posts N | --full | --backfill theo lời tôi; lần đầu có thể giới hạn bằng --max-posts/--since; các bài cũ hơn lấy dần bằng --backfill]. Đọc stop_rule, known_file, oldest_seen của từng source; run.skipped là nguồn backfill bỏ qua.
3. Từng source: mở trang, tab Bài viết/Ảnh, cuộn tới khi đúng stop_rule (lượt --backfill: cuộn nhanh qua bài đã có, không mở, tới khi qua oldest_seen rồi mới lấy; docs/research.md mục Backfill); bỏ qua bài đã có trong known.json (brand_post_urls, brand_post_ids) trước khi tải; mở bài mới lấy caption đầy đủ, ngày đăng, link bài + alt_urls, tải ảnh lớn nhất vào <source>/raw/, ghi <source>/raw.json theo docs/research.md. Nghỉ ngẫu nhiên delay_seconds giữa mọi thao tác.
4. node scripts/research.mjs ingest --brand <id> --source <sid>; node scripts/research.mjs result --brand <id> --source <sid> --state <end|known|since|limit|partial> [--note ".."] (lượt --backfill không dùng known).
5. Checkpoint/captcha/đăng nhập lại: dừng ngay, result --state blocked --note "<lý do>", không mở source khác.
6. node scripts/research.mjs report --brand <id>; báo bằng tiếng Việt: từng nguồn bài mới ở đầu trang (new_on_top), bài cũ lấy thêm (backfilled), đã tới hết trang chưa (reached_end; còn bài cũ thì nhắc --backfill), bài trùng bỏ qua, nguồn xong, nguồn bị chặn, tổng kho.

Không tạo ý/bài, không đăng, không gửi Metricool. Lệnh ok:false thì ghi lại và đi tiếp.
```

### Chỉ nghiên cứu · ChatGPT

ChatGPT (web/desktop) không chạy được lệnh và không đọc được thư mục trên máy, nên không làm được chế độ này. Prompt dưới chỉ để ChatGPT trả lời đúng khi bị dán nhầm.

```text
Chế độ: CHỈ NGHIÊN CỨU. Thương hiệu: {{BRAND}}.
Chế độ này cần chạy lệnh node trong thư mục C:\hoangpq\social-autopilot và điều khiển Chrome đã đăng nhập Facebook (Playwright MCP), rồi ghi ảnh/caption vào kho workspace/store/<brand>/ trên máy.

Nếu bạn KHÔNG chạy được lệnh trên máy này (ChatGPT web/desktop không có terminal và trình duyệt của máy): đừng làm gì cả, đừng mở Facebook bằng trình duyệt riêng của bạn, đừng tự tóm tắt trang. Chỉ trả lời tôi đúng một đoạn: "Chế độ Chỉ nghiên cứu cần Claude Code (Playwright MCP + Chrome đã đăng nhập) hoặc Codex có MCP trình duyệt. Mở thư mục social-autopilot bằng một trong hai rồi dán prompt tương ứng ở tab Prompt của app."

Nếu bạn là Codex trong ChatGPT và chạy được lệnh trên máy này: làm đúng prompt "Chỉ nghiên cứu · Codex" (AGENTS.md, RUNBOOK.md Chế độ 1, docs/research.md).
```

### Làm bài & đưa lên · Claude Code

Cần: quyền chạy `node` và `codex` (tạo ảnh) trong thư mục tool, đọc `C:\hoangpq\vaniecom-workspace\skills\`, connector claude.ai "Metricool". Không cần trình duyệt.

```text
Chế độ: LÀM BÀI & ĐƯA LÊN (từ kho, không mở Facebook, không có bước duyệt). Thương hiệu: {{BRAND}}.
Thư mục: C:\hoangpq\social-autopilot. Đọc AGENTS.md và RUNBOOK.md (Chế độ 2), làm đúng từng bước; mọi script in JSON.

0. node scripts/brands.mjs. Chỉ thương hiệu usable, lần lượt. Với từng thương hiệu, TRƯỚC khi làm bài mới:
   a. Gửi nốt bài cũ: node scripts/metricool-mcp.mjs payload --brand <id> (mọi bài đã ghi + có link ảnh mà chưa gửi; bài đã gửi tự bị bỏ qua), gửi như bước 6.
   b. Đối chiếu: node scripts/metricool-mcp.mjs status --brand <id>; có query thì gọi tool Metricool getScheduledPosts với đúng tham số, khớp theo id: ERROR → ghi vào báo cáo; PUBLISHED → chạy mark-published.mjs của skill như JSON hướng dẫn; nháp/PENDING → để yên.
1. Đọc SKILL.md và project/project.md của thương hiệu.
2. node scripts/ideas.mjs init --brand <id> [--count N]: chỉ lấy bài kho trạng thái "new", tự đánh dấu "used". Điền từng ý theo prompts/idea-abstract.md (ideas.mjs set); ý không hợp: ideas.mjs reject --item rejected; ý tốt: ideas.mjs pick.
3. Mỗi ý đã pick: node scripts/draft.mjs new --brand <id> --idea I0xx --product "<ảnh sản phẩm của chính thương hiệu>" (scene-swap --ref-image chỉ khi social.json bật product_images.reference_redraw). Điền {{PRODUCT_DESCRIPTION}} trong prompt.txt (giữ NO LOGO), node scripts/draft.mjs image --id <draft>, xem ảnh (sai thì sửa prompt, --force, tối đa 2 lần), watermark nếu thương hiệu bật, scene-swap thì confirm-clean sau khi xem kỹ.
4. Viết caption theo brief.md và skill: content-en.txt (đăng) và content-vn.txt (chỉ để đọc, không bao giờ đăng). Không nhãn AI, không tên shop nguồn. node scripts/draft.mjs check --id <draft> tới khi "ready".
5. node scripts/finalize.mjs run --brand <id>: kiểm tra lại, ghi vào skill thương hiệu (approved, by auto, check-post), host ảnh. Bài lỗi dừng riêng (check_failed), bài khác đi tiếp.
6. Gửi Metricool: node scripts/metricool-mcp.mjs payload --brand <id>; với từng item gọi tool Metricool createScheduledPost với đúng args.blogId, args.date, args.info (không sửa), rồi chạy ngay item.record với id, uuid, plannerUrl, publicationDate.dateTime, publicationDate.timezone Metricool trả về. Mặc định là NHÁP (settings metricool.default_mode); chỉ --schedule khi tôi bảo hẹn giờ thật. Bài trong "blocked" không gửi, ghi lý do. Không bao giờ dùng blogId khác (Fortera <blog_id_1> cấm), không createScheduledPostForReview. Không có tool Metricool hoặc tool lỗi: ghi rõ trong báo cáo, để bài lại (lượt sau sẽ gửi).
7. node scripts/queue.mjs; báo tôi bằng tiếng Việt: mỗi bài (POST-xx, đường dẫn ảnh, caption EN nguyên văn, bản VN chỉ để đọc, link ảnh host, Metricool nháp/hẹn giờ + plannerUrl hoặc "chưa gửi" và vì sao), bài cũ đã gửi nốt, bài lỗi và lý do, kho còn bao nhiêu bài "new". Nhắc tôi xem tab Bài đã tạo của app.

Không đăng thẳng lên mạng xã hội. Không ghi nhãn AI. Hết lượt Codex thì dừng tạo ảnh và báo.
```

### Làm bài & đưa lên · Codex

Cần: Codex CLI (chạy `node`, và `codex exec` để tạo ảnh), đọc thư mục skills. Metricool: MCP server `metricool` đã thêm và đăng nhập (`codex mcp list`); không có thì bài được làm và ghi đủ nhưng chờ lượt sau để gửi.

```text
Chế độ: LÀM BÀI & ĐƯA LÊN (từ kho, không mở Facebook, không có bước duyệt). Thương hiệu: {{BRAND}}.
Thư mục làm việc: C:\hoangpq\social-autopilot. Đọc AGENTS.md và RUNBOOK.md (Chế độ 2); mọi bước là lệnh node in JSON.

Trước hết xem bạn có tool MCP của Metricool (createScheduledPost, getScheduledPosts) không; ghi nhớ cho bước 0 và 6.

0. node scripts/brands.mjs; chỉ thương hiệu usable, lần lượt. Với từng thương hiệu, TRƯỚC khi làm bài mới (khi có tool Metricool): node scripts/metricool-mcp.mjs payload --brand <id> và gửi các bài cũ chưa gửi như bước 6; rồi node scripts/metricool-mcp.mjs status --brand <id> (có query thì getScheduledPosts, khớp theo id: ERROR báo, PUBLISHED chạy mark-published.mjs của skill, nháp/PENDING để yên).
1. Đọc SKILL.md và project/project.md của thương hiệu.
2. node scripts/ideas.mjs init --brand <id> [--count N] (chỉ bài kho "new"). Điền ý theo prompts/idea-abstract.md (ideas.mjs set), reject --item rejected nếu không hợp, pick ý tốt.
3. Mỗi ý: node scripts/draft.mjs new --brand <id> --idea I0xx --product "<ảnh của thương hiệu>"; điền {{PRODUCT_DESCRIPTION}} (giữ NO LOGO); node scripts/draft.mjs image --id <draft> (tool gọi codex exec; nếu sandbox chặn lệnh lồng nhau thì báo tôi); xem ảnh; watermark nếu bật; scene-swap thì confirm-clean.
4. Caption theo brief.md: content-en.txt (đăng), content-vn.txt (chỉ đọc, không đăng); không nhãn AI, không tên shop. node scripts/draft.mjs check --id <draft> tới "ready".
5. node scripts/finalize.mjs run --brand <id> (ghi vào skill, approved by auto, host ảnh; bài lỗi dừng riêng).
6. Gửi Metricool (có tool): node scripts/metricool-mcp.mjs payload --brand <id>; từng item gọi createScheduledPost với đúng args (không sửa info), chạy item.record với kết quả. Mặc định NHÁP. Bài "blocked" không gửi, ghi lý do. Không có tool Metricool: KHÔNG gửi gì, ghi rõ trong báo cáo "chưa gửi Metricool: Codex chưa có MCP Metricool (codex mcp add metricool --url https://ai.metricool.com/mcp; codex mcp login metricool)"; bài sẽ được gửi ở lượt sau. Không bao giờ dùng blogId <blog_id_1> (Fortera), không createScheduledPostForReview.
7. node scripts/queue.mjs; báo bằng tiếng Việt: từng bài (POST-xx, ảnh, caption EN, bản VN chỉ đọc, link ảnh, Metricool nháp/hẹn giờ + plannerUrl hoặc chưa gửi và vì sao), bài cũ đã gửi nốt, bài lỗi, kho còn bao nhiêu bài "new".

Không đăng thẳng lên mạng xã hội, không nhãn AI, ok:false thì ghi lý do và đi tiếp.
```

### Làm bài & đưa lên · ChatGPT

ChatGPT web/desktop không chạy được lệnh trên máy, nên không làm bài được. Nó chỉ gửi nốt lên Metricool (connector Metricool của ChatGPT) những bài đã làm xong, khi người dùng dán JSON của `node scripts/metricool-mcp.mjs payload --brand <id>` vào cuối prompt; sau đó chạy các lệnh `record` ChatGPT trả về.

```text
Chế độ: LÀM BÀI & ĐƯA LÊN. Thương hiệu: {{BRAND}}.
Phần làm bài (đọc kho workspace/store/, tạo ảnh bằng Codex CLI, ghi bài vào skill thương hiệu, host ảnh) cần chạy lệnh node trong C:\hoangpq\social-autopilot. Nếu bạn không chạy được lệnh trên máy này, đừng tự viết bài hay tạo ảnh ngoài quy trình.

Nếu dưới prompt này KHÔNG có JSON payload: chỉ trả lời "Phần làm bài cần Claude Code hoặc Codex mở thư mục social-autopilot. Muốn tôi gửi nốt bài đã làm xong lên Metricool, hãy dán JSON của node scripts/metricool-mcp.mjs payload --brand <id>."

Nếu có JSON payload (bài đã ghi vào thương hiệu, ảnh có link công khai, mặc định NHÁP), với từng phần tử trong "items":
1. Gọi createScheduledPost của Metricool với ĐÚNG args.blogId, args.date và args.info (info là chuỗi JSON: giữ nguyên, không sửa chữ, không thêm hashtag, không thêm nhãn AI, không đổi draft). Ảnh đã nằm trong info.media (link https); chỉ dùng mediaFiles khi tôi tự đính kèm ảnh và bảo dùng ảnh đính kèm.
2. Ghi lại id, uuid, plannerUrl, publicationDate.dateTime, publicationDate.timezone Metricool trả về.
Bỏ qua mọi thứ ngoài "items" ("blocked", "skipped"). Không bao giờ dùng blogId khác args.blogId; tuyệt đối không tạo hay sửa bài cho Fortera Apparel (blogId <blog_id_1>). Không dùng createScheduledPostForReview. Không đăng thẳng.

Cuối cùng trả lời bằng tiếng Việt: bài đã gửi (POST-xx, nháp hay hẹn giờ, giờ, plannerUrl) và, cho từng bài, lệnh item.record đã điền giá trị thật (thay <id>, <uuid>, <plannerUrl>, <publicationDate.dateTime>, <publicationDate.timezone>) để tôi chạy trong C:\hoangpq\social-autopilot. Bài lỗi thì ghi lý do.
```
