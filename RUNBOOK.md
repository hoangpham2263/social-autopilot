# RUNBOOK: social-autopilot (3 chế độ)

Scripts + RUNBOOK là nguồn duy nhất của quy trình. Prompt (tab **Prompt** của app, `docs/scheduled-prompt.md`) chỉ ngắn (tối đa 18 dòng, mẫu cố định `TASK`, `OPTIONS`, `TOOL`, `SKILL`, `STEPS`, `STOP IF`, `NEVER`; mỗi bước đánh số khớp 1:1 với số bước ở đây); mọi chi tiết nằm ở đây. Agent nào cũng chạy được (Claude Code, Codex; ChatGPT chỉ phần gửi Metricool): mọi bước là lệnh `node scripts/...` chạy trong thư mục tool (`<tool folder>`), in **một JSON** (`ok: true|false`); đọc JSON, không đoán. Chạy lại không sinh trùng. App chỉ để xem, duyệt và quản lý; việc do agent làm.

Ba chế độ (đường chính của Mode 2 và Mode 3: `scripts/pipeline.mjs`):
1. **Research only**: agent (Playwright MCP, Chrome đã đăng nhập của người dùng) lấy bài mới của các trang tham khảo, rồi tìm thêm theo từ khoá/hashtag trên nhiều nền tảng, chỉ bài có sản phẩm đúng loại thương hiệu bán, vào kho `workspace/store/<brand>/`, bỏ trùng. Không làm ý/bài, không gửi Metricool.
2. **Create & publish**: đồng bộ brand Metricool → gửi các bài **đã duyệt** mà chưa gửi thành bài **hẹn giờ thật** (không bao giờ nháp) đúng giờ slot của brand → làm bài mới → kiểm tra tự động → bài ở trạng thái **To review** và **dừng**. Người dùng duyệt trong app (Approve = ghi vào sổ bài của tool `workspace/posts/<brand>/` + host ảnh; skill chỉ đọc); lượt sau hẹn giờ các bài đó.
3. **Publish approved**: chỉ hẹn giờ trên Metricool các bài **Approved** chưa gửi (không làm bài, không mở trình duyệt).

Trạng thái người dùng thấy (tab Posts, đúng thứ tự): **To review** (chờ duyệt) · **Approved** (đã duyệt, chờ gửi: chưa có id Metricool) · **Scheduled** (đã hẹn giờ trên Metricool: có id, không bao giờ gửi lại) · **Posted** (đã đăng); bài lỗi có dấu đỏ.

## Rules for every run

- Prompt ghi sẵn đường dẫn: `TOOL:` (thư mục tool) và mỗi thương hiệu một dòng `SKILL: <id> → <thư mục skill>`; agent không tự chọn skill, chỉ làm với các skill đó và đọc `SKILL.md`, `project/project.md`, `project/social.json` của từng skill ở bước Setup.
- **Dừng (STOP) vẫn ghi nhật ký:** lượt nào dừng giữa chừng (bị chặn, Chrome không nối được, lỗi Metricool, hết lượt Codex...) **vẫn luôn** làm bước ghi nhật ký (`runlog.mjs add`, kèm lý do dừng: `--reason "<lý do>"`, vd `--reason "chrome unreachable"`; nhật ký ghi kết quả **stopped** và không lấy số liệu của lượt cũ) rồi báo cáo. `node scripts/runlog.mjs --help` in cách dùng. Bước ghi nhật ký không bao giờ bị bỏ.
- Mỗi lượt (mọi chế độ, mọi agent) theo đúng các bước đánh số của chế độ đó, không bỏ bước; **bước gần cuối luôn là ghi nhật ký** (`scripts/runlog.mjs`, 1.5 / 2.9 / 3.1), **bước cuối là báo cáo** với các mục cố định (1.6 / 2.10 / 3.2).

- Thương hiệu: chỉ các thương hiệu usable (`node scripts/brands.mjs`). "all usable brands" = mọi thương hiệu usable.
  - **Mode 1 (Research):** lần lượt từng thương hiệu, từng trang tham khảo và từng truy vấn, **không song song** (một trình duyệt = một agent).
  - **Mode 2 / Mode 3:** đường nhanh `scripts/pipeline.mjs` (mục "Mode 2 fast path"): **một pipeline cho mọi thương hiệu**, không cần sub-agent theo thương hiệu; agent chỉ dừng ở chỗ cần phán đoán (chọn ý, xem ảnh, viết caption). Các bước 2.0 → 2.10 bên dưới vẫn là quy trình đầy đủ và là **đường dự phòng** khi pipeline lỗi (khi đó các thương hiệu có thể chạy song song, một sub-agent mỗi thương hiệu). Ảnh luôn làm song song (2.4, `draft.mjs image-batch`); cả máy không bao giờ quá `codex.concurrency` lượt Codex cùng lúc, kể cả khi nhiều thương hiệu chạy song song.
- **Run progress (tab Prompt của app):** bước Setup chạy `node scripts/brands.mjs --run <research|create|publish>`: lượt chạy hiện ở khung **Run progress** (nhận lượt "pending" do nút Copy prompt tạo, hoặc mở lượt mới). Các script của từng bước tự cập nhật `workspace/runs/current-<mode>.json` (`scripts/progress.mjs`); `runlog.mjs add` kết thúc lượt. Agent không phải làm gì thêm.
- Skill không bao giờ được chép vào tool. Mỗi brand Metricool trỏ tới một thư mục skill (`skill_path` trong `workspace/metricool-brands.json`); tool chỉ **đọc** thư mục đó; **không bao giờ ghi vào skill** (bài đã duyệt, Metricool id, ngày đăng nằm trong sổ bài của tool `workspace/posts/<brand>/`). Mọi dữ kiện riêng của thương hiệu đọc từ skill (`SKILL.md`, `project/project.md`, `project/social.json`). Không hard-code thương hiệu, không trộn nguồn hay kho giữa thương hiệu.
- Brand chỉ được làm và gửi bài khi đã trỏ tới một skill dùng được; brand chưa trỏ skill, hoặc `removed: true` (đã mất khỏi tài khoản) trong `workspace/metricool-brands.json`, thì **không bao giờ**. Không dùng blogId khác `args.blogId` của payload; không `createScheduledPostForReview`.
- Tuỳ chọn của lượt (dòng `Options:` của prompt) ưu tiên hơn mặc định: Research → `--source a,b` (trang tham khảo), `--platforms a,b|none` (nền tảng discovery), `--keywords "k1,k2"`, `--max-posts N` (mục tiêu mỗi thương hiệu), `--backfill` hoặc `--full` cho `research.mjs start`; Create → `--count N` cho `ideas.mjs init` (trống = đủ bài cho `planning.ahead_days` ngày tới); Publish approved → `--limit N` (tối đa N bài đã duyệt mỗi brand, bài duyệt sớm nhất trước) cho `metricool-mcp.mjs payload`; chỉ Publish approved → `--window morning|midday|afternoon|evening` (chỉ giờ trong khung đó của ngày, theo múi giờ Metricool của brand; tốt nhất trước, không có dữ liệu thì giữa khung) và Start: **From today** = `--start today` (mặc định trong app) hoặc **From tomorrow** (không có cờ) (giờ tốt nhất kế tiếp sau bây giờ, chừa 15 phút an toàn; brand 1 bài/ngày chỉ dùng giờ chính, không bao giờ giờ dự phòng tối nay) cho `payload`. Giờ được tính lúc chạy `payload`, nên chạy `payload` ngay trước khi gửi; item đã quá `send_before` thì không gửi, chạy lại `payload` (giờ chuyển sang slot kế). Create & publish không có hai tuỳ chọn này: bài đã duyệt luôn hẹn ở giờ tốt nhất tự động, từ ngày mai.
- Trước khi làm bài cho thương hiệu: đọc `SKILL.md` và `project/project.md` của skill.
- **Không bao giờ gắn nhãn AI** lên bài (caption, text, alt). **Không logo trên sản phẩm** (logo chỉ là watermark nhỏ ở góc, khi thương hiệu bật).
- Không đăng thẳng lên mạng xã hội; mọi bài đi qua Metricool dạng hẹn giờ. Agent **không bao giờ tự duyệt** bài (`finalize.mjs approve` chỉ do người dùng, qua app).
- Không dùng ảnh hay câu chữ của đối thủ; không nhắc tên shop nguồn; không đăng nhập hộ, không lưu cookie.
- Lệnh trả `ok:false`: ghi lý do vào báo cáo, đi tiếp; không lách luật. Hết lượt Codex (tạo ảnh) thì dừng tạo ảnh và báo.
- Báo cáo bằng tiếng Việt (mục 1.6 / 2.10 / 3.2), nhắc người dùng mở app (tab Library / Posts).

### Công cụ theo agent
- **Claude Code**: Playwright MCP (`--extension`, gắn vào Chrome đã đăng nhập của người dùng) cho Mode 1 (trang tham khảo + discovery: Claude mở trang, cuộn, gọi script trích xuất); connector claude.ai "Metricool" cho Mode 2; Codex CLI để tạo ảnh.
- **Codex** (CLI/app, đọc `AGENTS.md`): Mode 1 cần MCP trình duyệt như Claude Code, trong `~/.codex/config.toml` (`[mcp_servers.playwright]`, `command = "npx"`, `args = ["-y", "@playwright/mcp@latest", "--extension"]`). Mode 2 cần MCP Metricool:
  ```
  codex mcp add metricool --url https://ai.metricool.com/mcp
  codex mcp login metricool
  ```
  Không có MCP Metricool: bỏ 2.0-2.2, vẫn làm bài tới 2.7, ghi trong báo cáo "chưa đồng bộ/gửi Metricool: Codex chưa có MCP Metricool" kèm hai lệnh trên.
- **ChatGPT** (web/desktop, không chạy được lệnh trên máy): không làm được Mode 1 và phần làm bài. Chỉ gửi bài đã duyệt khi người dùng dán JSON của `node scripts/metricool-mcp.mjs payload --brand <id>`: với từng `items[]` gọi `createScheduledPost` với ĐÚNG `args.blogId`, `args.date`, `args.info` (chuỗi JSON giữ nguyên; ảnh đã ở `info.media`), ghi `id`, `uuid`, `plannerUrl`, `publicationDate.dateTime`, `publicationDate.timezone`. Bỏ qua `blocked`, `skipped`. Trả lời tiếng Việt: bài đã gửi (POST-xx, giờ, plannerUrl), lệnh `item.record` đã điền giá trị thật cho từng bài (người dùng chạy trên máy), bài lỗi và lý do.

## Bước chung. Thương hiệu và nguồn

```
node scripts/brands.mjs [--run research|create|publish]   # usable = thương hiệu chạy được; problems/skipped = lý do bỏ qua; --run: bước Setup, lượt hiện ở Run progress
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

**Claude mở trang trên Chrome đã đăng nhập của người dùng (Playwright MCP), tự cuộn, đọc bằng một script trích xuất (`collect.mjs`), nhìn ảnh để lọc (và sửa adapter), rồi lọc một lượt.** Thứ tự (người dùng, 10/11/2026): (1) **trang tham khảo** của thương hiệu (`research.sources[]`: bài mới chưa có trong kho); (2) hết trang tham khảo mà chưa đủ mục tiêu (`--max-posts N` mỗi thương hiệu, hoặc không đặt mục tiêu): **tìm thêm (discovery)** theo `research.discovery.keywords` / `hashtags` của skill trên các nền tảng bật (Instagram, Pinterest, Facebook tìm bài + nhóm, Etsy, Houzz cho nội thất), xoay vòng các nền tảng tới khi đủ mục tiêu hoặc hết truy vấn. **Chỉ lấy bài có sản phẩm đúng loại thương hiệu bán** (`research.discovery.product_fit`: `types`, `must_have`, `must_not`): bài sai loại không tải, không lưu (ghi `rejected[]`), và bị lọc lần nữa ở 1.3. Script `research.mjs next` nói việc tiếp theo **và in sẵn lệnh `collect` + `adapter.status`**; chi tiết từng nền tảng và quy trình adapter: `docs/research.md`. Facebook chưa có script in-page (`pageScript`): lấy tay bằng Playwright MCP cho tới khi script đó được viết và kiểm trên trang thật. Một trình duyệt = một agent, không song song.

1.0. Kiểm tra trình duyệt (**bước đầu tiên**, trước `research.mjs start`): công cụ Playwright MCP có và đang nối Chrome của người dùng (vd `browser_tabs` trả danh sách tab). Một trình duyệt = một agent: không chạy hai agent cùng lúc trên Chrome đã đăng nhập đó.

1.0b. Quy tắc trình duyệt (đo được: tab ẩn thì mọi chờ khung hình treo hàng chục giây): đóng các tab còn sót từ lượt trước, chỉ làm trong MỘT tab mới. Browser rules: start every browser_run_code_unsafe with `await page.bringToFront();` (a hidden tab never gets animation frames, so rAF-based waits and mouse.wheel hang); work in ONE tab: close tabs left over from earlier runs and open the source in a new tab; never use waitForFunction for page readiness (use waitForLoadState('domcontentloaded') with a short timeout, or waitForTimeout; if waitForFunction is unavoidable use { polling: 250, timeout: 10000 }); any single browser call that takes more than 30 s counts as stuck: stop using it and go on (fallback: read the page yourself). Scrolling: scrollBy first, page.mouse.wheel(0,900) only as fallback AFTER bringToFront (Facebook sometimes needs real scrolling to render its feed).
```
node scripts/research.mjs browser --brand <id> --state ok
node scripts/research.mjs browser --brand <id> --state fail --note "<lý do>"   # không có MCP / không nối được: dừng, không start
```
Claude Code: `claude mcp add playwright -- npx -y @playwright/mcp@latest --extension` (extension "Playwright MCP Bridge" trong Chrome của người dùng). Codex: `~/.codex/config.toml` `[mcp_servers.playwright]` `command = "npx"`, `args = ["-y", "@playwright/mcp@latest", "--extension"]`. Không đăng nhập hộ: trang nào đòi đăng nhập thì truy vấn đó `blocked`.

1.1. Mở lượt cho một thương hiệu:
```
node scripts/research.mjs start --brand <id> [--source a,b|none] [--platforms a,b|none] [--keywords "k1,k2"] [--hashtags "t1,t2"] [--max-posts N] [--since YYYY-MM-DD] [--full | --backfill]
```
- `--max-posts N` = **mục tiêu** N bài mới cho thương hiệu trong lượt: trang tham khảo trước (chia đều cho chúng), phần còn lại từ discovery. Trống = trang tham khảo theo luật dừng, rồi mọi truy vấn discovery (mỗi nền tảng tối đa `max_per_platform`). Brand = tất cả: mỗi thương hiệu được N.
- `--platforms`: nền tảng discovery (mặc định mọi nền tảng bật trong skill; nền tảng không bật trong skill bị bỏ, JSON `platforms_ignored`; `none` = chỉ trang tham khảo). `--keywords` / `--hashtags`: thay danh sách của skill cho lượt này.
- Trang tham khảo: lần đầu lấy hết bài (cuộn tới hết trang); lần sau chỉ bài mới ở đầu trang (dừng sau 3 bài liên tiếp đã có). `--backfill`: bài **cũ hơn** `oldest_seen` (trang đã `reached_end` bỏ qua, `run.skipped`); `--full`: cuộn hết dù đã có; `--since`: mốc ngày.
- Mở lại cùng ngày: `run.json`, `raw.json`, `raw/`, `ingest.json` và thư mục `discovery/` cũ chuyển vào `archive/<giờ>/`, không bao giờ ingest lại.
- Tiến độ từng trang: `workspace/store/<brand>/progress.json` (`newest_seen`, `oldest_seen`, `reached_end`).

1.2. Thu thập, lặp tới khi `next` trả `done`. **Một đường duy nhất:** Claude mở `open` của `next` bằng Playwright MCP (`browser_navigate`), (một lần mỗi phiên: chạy `install.js`, tức `node scripts/collect.mjs install` rồi `browser_run_code_unsafe` + `filename`; mở trang SAU khi install, cuộn, chạy file nhỏ; `--inline` = file một khối cũ) rồi lặp: `node scripts/collect.mjs script --brand <id> --for-query|--for-source <id>` ghi script trích xuất vào `research.script_dir` (mặc định `~/.playwright-mcp/social-autopilot/<brand>-<task>.js`, thư mục Playwright MCP đọc được) và in đường dẫn → chạy file đó bằng MỘT lần gọi `browser_run_code_unsafe` với tham số `filename` (không dán, không chép; chỉ đọc trang hiện tại, chỉ bài mới so với `seen.json` của bước; phía Node của script gửi kết quả về app đang chạy (không qua trang, không bị CSP chặn) bằng một token dùng một lần, 5 phút (`research.token_minutes`), và chỉ trả `{saved:true,total,tag,bytes}`) → (**Token:** the script file holds no secret; its Node side fetches a one-time token (5 minutes, one use) from the app when it runs. If it returns `saved:false` with HTTP 403, run `collect.mjs script` again.**) `node scripts/collect.mjs from-page --brand <id> --for-query|--for-source <id>` không cần `--b64` (đọc `page-result.json` trong thư mục bước; chỉ khi script trả `saved:false` kèm `b64` mới truyền `--b64 <cả dòng b64>`, hoặc `--file`; không gõ lại; kiểm total + checksum, bỏ bài đã có trong kho, tải ảnh, cộng dồn vào raw.json) → nhìn ảnh `review[]` và chạy `collect.mjs fit` ngay (nguồn và truy vấn), đọc bộ đếm `read / pending_fit / kept / rejected / need / need_more` → cuộn (đoạn `scrollBy` của `next.scroll` cho mọi nền tảng, kể cả Facebook; `page.mouse.wheel(0,900)` chỉ là dự phòng sau `bringToFront` khi feed không hiện; phím End không tải feed Facebook; 1-2 lần, chờ `scroll_wait_seconds`: Pinterest/Houzz/Etsy 2-4 giây, Instagram/Facebook 5-10 giây) → trích xuất lại, tới khi một `stop_rules` đúng (đủ `target` = `need_more` 0 tính bài ĐÃ GIỮ sau fit, `poor_source` = đã đọc ≥ 3 × `need` mà vẫn thiếu, 3 lần trích xuất không có bài mới, mọi bài đã có, tường đăng nhập / captcha / trang đóng → `result --state blocked|end|known`) → `ingest` → `result`. **Reference sources are never skipped to save output: each gets its turn before discovery; skip one only with `result --state blocked|partial|known|end` and a reason. Login wall (Facebook or any site): `result --state blocked --note "login wall"`, go on with the other sources, and re-check that source ONCE at the end of that brand's run (Chrome may have been signed in meanwhile).** `ingest` bỏ bài chưa qua `fit` vào danh sách `unjudged` (không lưu, không vào rejected.json, không tính `rejected`; lượt sau nhặt lại). `collect.mjs fit --file` trên Windows cần đường dẫn Windows (không dùng /tmp). Script đọc thiếu bài đang thấy: xem DOM, sửa `SELECTORS` của adapter, trích xuất lại (docs/research.md "Adapter").

   - **Giới hạn thời gian:** Time cap: at most research.source_minutes (default 3) per source/query; next / script / from-page / fit print elapsed and, over the limit, stop "time": record research.mjs result --state partial --note 'time limit', keep what you have, go to the next source.
   - **Dự phòng khi script không chạy:** Facebook: open the page, scroll once with the scrollBy snippet BEFORE the first extract (the feed only renders after a real scroll); an empty first extract on a page that was NOT scrolled is expected, not a script failure, and does not count toward the two empty extracts of the fallback. If the extract script errors, or still returns 0 posts / total_on_page 0 after two EXTRA extracts (scroll once more between them) on a page that visibly has posts, STOP using the script for that source: read the page yourself (Playwright MCP snapshot, a small browser_evaluate, or a screenshot), write the posts you see in the same small JSON the script returns ({platform, url, tiles:[{id, url, image_urls, caption, author, date_text}]}, no checksum) and pass it to collect.mjs from-page --json '<that>' (the tool downloads the images, skips known posts, writes raw.json; verified:false is expected); then the same loop (look at images, fit, counters, stop rules, time cap).
```
node scripts/collect.mjs fit --brand <id> --for-query <qid> --file <decisions.json>   # agent NHÌN ảnh review[].image: [{id, fit:true, type, reason}|{id, fit:false, reason}]
node scripts/collect.mjs status                                       # trạng thái từng adapter
```
- Adapter `untested` (viết khi chưa có trình duyệt): so vài bài đầu của `review[]` với trang đang mở; đúng thì đặt `status: "ok"` + `checked: "<ngày>"` trong `scripts/platforms/index.mjs`, sai/thiếu thì sửa `SELECTORS` (khối đầu file) rồi trích xuất lại.
- `collect.mjs` chỉ xem, không đăng nhập, dừng ngay khi gặp tường đăng nhập/captcha (`state: blocked` → `result --state blocked`).
Các lệnh của một bước (sau các lần trích xuất):
```
node scripts/store.mjs known --brand <id>            # một lần: link/mã bài đã có (không mở, không tải lại)
node scripts/research.mjs next --brand <id>
#  step "reference": lấy trang url theo stop_rule (docs/research.md "Trang tham khảo"), ghi raw_file + ảnh vào downloads, rồi
node scripts/research.mjs ingest --brand <id> --source <sid>
node scripts/research.mjs result --brand <id> --source <sid> --state end|known|since|limit|blocked|partial [--note ..]
#  step "discovery": mở url (trang tìm/hashtag) của platform, lấy tối đa share bài đúng product_fit (docs/research.md "<platform>"), rồi
node scripts/research.mjs ingest --brand <id> --query <qid>
node scripts/research.mjs result --brand <id> --query <qid> --state done|limit|empty|blocked|partial [--note ..]
```
- Luật chung (docs/research.md): chỉ xem (không like/lưu/theo dõi/bình luận/nhắn tin/tham gia nhóm/đăng); chờ `scroll_wait_seconds` giữa hai lần cuộn; mỗi bài đọc link bài, ảnh lớn nhất, caption, tác giả, ngày, lượt thích nếu thấy, `product_fit` { type, reason }; bài sai loại → `rejected[]` (không tải).
- `ingest` bỏ trùng trên **mọi nền tảng** của thương hiệu (link/mã bài kể cả `alt_urls`, Instagram `/p/` = `/reel/`; SHA-1 + dHash ảnh; caption), bỏ bài thiếu `product_fit.type` vào `unjudged` (không lưu) và từ chối bài sai type (ghi `workspace/store/<brand>/rejected.json` kèm lý do), giữ `platform`, `source_url`, `author`, `found_by` (`reference page` | `keyword:<kw>` | `hashtag:<tag>`), `product_fit`.
- Tường đăng nhập, captcha, checkpoint: dừng ngay nền tảng đó, `result --state blocked --note "<thấy gì>"`: truy vấn còn lại của nền tảng đó bị bỏ trong lượt, nền tảng khác vẫn tiếp. Trang tham khảo Facebook bị chặn: các trang Facebook còn lại `--state skipped`.
- `next` trả `skip: true` (mục tiêu đã đủ khi còn trang tham khảo): chạy đúng lệnh `do` (`result --state skipped`).
- Trang tham khảo **Facebook**: cùng một đường (mở trang, cuộn, trích xuất); mã bài = permalink thật, fbid ảnh là alias (docs/research.md "Facebook: script trích xuất"); rồi tiếp `research.mjs next` cho discovery.

1.3. Lọc một lượt (agent tự quyết, không mở trình duyệt):
```
node scripts/store.mjs classify --brand <id> [--limit 40]
node scripts/store.mjs verdict  --brand <id> --file <verdicts.json>
```
- `classify` in một lô gọn các bài `new` chưa lọc: `id`, `source`, `platform`, `found_by`, `author`, `product_fit` (ghi lúc lấy), đoạn đầu caption (`(no caption)` khi bài chỉ có ảnh), `media`, `thumb` (đường dẫn ảnh), kèm `what_to_take` của từng nguồn, `product_fit` của skill (`types`, `must_have`, `must_not`), đường dẫn `project.md` (phạm vi sản phẩm) và `rules_of_thumb`.
- Agent xem chữ + ảnh thumb (đọc file ảnh), đối chiếu `what_to_take` và phạm vi sản phẩm trong `project.md`, ghi `[{ "id": "S0001", "fit": true|false, "reason": "..." }]` (lý do ngắn, bắt buộc khi `fit:false`), rồi `verdict`. Lặp tới khi `total_unjudged` = 0.
- `fit:false` → bài thành **Removed** (`rejected`), ghi chú `filter: <lý do>`; `fit:true` → giữ (Available). Người dùng vẫn Restore được ở tab Library (bài đó không bị lọc lại).
- Luật nhanh: bỏ sản phẩm không thuộc `product_fit.types` hoặc dính `must_not` (lý do `off-brand: ...`; lần kiểm thứ hai); bỏ bài tuyển dụng; bỏ cuộc thi, minigame, giveaway; bỏ bài chỉ có chữ (hoặc ảnh chỉ là chữ, không thấy sản phẩm); bỏ bài chia sẻ lại mà không có ảnh sản phẩm; bỏ sản phẩm ngoài ngành hàng của thương hiệu. Giữ: ảnh sản phẩm thật đúng ngành hàng, có bối cảnh/góc chụp/khung caption học được.

1.4. Số liệu báo cáo:
```
node scripts/research.mjs report --brand <id>
```
Mỗi trang tham khảo: bài mới, `kept` / `filtered`, `rejected_off_brand`, `low_keep` (≥ 5 bài đã lọc và giữ < 30%), trạng thái, còn bài cũ không. `discovery`: mỗi nền tảng (truy vấn đã làm, giữ, bỏ vì sai loại, trùng, blocked, đủ max) và mỗi truy vấn (`found_by`, trạng thái, giữ / sai loại / trùng); `target`, `new_total` (trang tham khảo + discovery).

1.5. Ghi nhật ký lượt chạy (bước gần cuối của mọi lượt):
```
node scripts/runlog.mjs add --mode research --agent "<Claude Code|Codex>" [--started <giờ bắt đầu ISO>] [--file <ghi chú.json>]
```
Tool tự lấy số liệu (từng nguồn: bài mới, **kept / filtered**, discovery theo nền tảng/truy vấn: giữ / sai loại / trùng, trạng thái New posts / Dried up / Skipped (quota) / Blocked / Error, cờ keep rate thấp) và ghi `workspace/logs/runs/<thời điểm>-research.json`; tab **Log** hiện "N kept · M filtered". Agent chỉ thêm ghi chú/lỗi bằng file JSON `{ "notes": "...", "errors": ["..."], "brands": { "<id>": { "notes": "...", "errors": ["..."] } } }`.

1.6. Báo cáo cho người dùng, tiếng Việt, **luôn đúng các mục sau** (giống tab Log):
- **Kết quả chung:** +N bài mới (trang tham khảo + tìm thêm, so với mục tiêu) · N giữ · M lọc bỏ · K bỏ vì sai loại sản phẩm, số nguồn cạn (Dried up), số nguồn/nền tảng bị chặn.
- **Theo thương hiệu:** từng trang tham khảo: bài mới · giữ / lọc bỏ · trạng thái (New posts / Dried up / Skipped (quota) / Blocked / Error); tìm thêm: từng nền tảng và truy vấn (từ khoá/hashtag): giữ · sai loại · trùng · trạng thái.
- **Cần làm:** nguồn/nền tảng bị chặn (lý do: đăng nhập, captcha), nguồn lỗi (vd `error: selectors`), nguồn keep rate thấp (xem lại `what_to_take` hoặc thay nguồn), nguồn cạn nhiều lượt liền (gợi ý thêm nguồn mới), còn bài cũ thì nhắc `--backfill`.
- **Kho:** tổng (Available / Removed; Available = còn dùng được, thẻ ghi "new" hoặc "used N×"); xem ở tab **Library** (bài bị lọc nằm ở Removed, có lý do).

Không làm ý, không tạo bài, không gửi Metricool trong chế độ này. Không bao giờ like, bình luận, theo dõi, chia sẻ hay nhắn tin.

## Mode 2. Create & publish

Không mở Facebook. Cần `node`, Codex CLI (tạo ảnh) và MCP Metricool của agent.

### Mode 2 fast path (pipeline.mjs, mặc định)

Cùng các bước và cùng các kiểm tra như 2.0 → 2.10 (pipeline gọi đúng các script đó), chỉ ít lượt qua lại của agent hơn: mọi ý trong **một** file, mọi caption trong **một** file, mọi ảnh mới trên **một** contact sheet. Pipeline dừng đúng 2 chỗ cần phán đoán và in chính xác việc phải làm (`next`). Gọi MCP Metricool vẫn do agent làm.
```
node scripts/pipeline.mjs mcp-plan --brand <id|all>        # 2.0: các lệnh MCP cần gọi (getBrandSettings, getBestTimeToPostByNetwork, đúng tham số) và file lưu
node scripts/pipeline.mjs create --brand <id|all> --brand-settings workspace/tmp/brand-settings.json --best-times-dir workspace/tmp [--count N | --items S0008] [--restart]   # --count N = N bài mỗi brand, min(N, bài Available trong kho); --restart (và chạy lại) bỏ mọi ý chưa điền/chưa thành bài và nhả bài kho đã giữ (kho chỉ tính đã dùng khi có draft/post thật); brand có 0 bài Available: dừng với stop "needs research" cho brand đó (brand khác vẫn chạy): chạy Research cho brand đó trước. --items: đúng bài kho đó (một brand); scene-swap trong file ý: "scene_swap": true + "brand_can_produce": true + "ref_has_face" + "ref_mode" (keep-scene: + "ref_text" + "sign_text" mới)
   # A: brands --run, sync-brands/sync-times, payload + status từng brand (workspace/pipeline/publish.json), ideas init → workspace/pipeline/ideas-todo.json
   # agent: gửi từng item của publish.json (createScheduledPost đúng args → lệnh record), đối chiếu status_queries (2.1-2.2)
   # STOP (i): điền ideas-todo.json cho mọi thương hiệu một lượt (ý trừu tượng theo prompts/idea-abstract.md, ảnh sản phẩm của thương hiệu, cỡ thật, sign_text khi custom_text, mô tả sản phẩm từng chữ) hoặc "reject"
node scripts/pipeline.mjs create --resume --ideas workspace/pipeline/ideas-todo.json
   # B: ideas set/pick, draft.mjs new, điền mô tả vào prompt.txt (giữ NO LOGO), image-batch chạy nền
node scripts/pipeline.mjs create --resume
   # C: chờ ảnh, contact sheet workspace/pipeline/contact-sheet-<n>.png (draft.mjs contact-sheet) + captions-todo.json
   # agent: XEM từng contact sheet (sản phẩm hợp bối cảnh, cỡ thật, chữ đúng từng ký tự, không logo trên sản phẩm, không chữ mẫu; nghi ngờ thì mở ảnh riêng)
   # STOP (ii): viết mọi caption trong captions-todo.json (theo brief.md) hoặc "redo" (mô tả/cỡ/chữ mới; tối đa 2 lần)
node scripts/pipeline.mjs create --resume --captions workspace/pipeline/captions-todo.json
   # D: ghi caption, làm sạch metadata, watermark nếu bật, draft.mjs check; chưa đạt → sửa và gửi lại file; đạt hết → queue + runlog (kết thúc)
node scripts/pipeline.mjs status                            # lượt đang ở đâu, việc tiếp theo
```
- Một lượt Create một lúc (`workspace/pipeline/create.json`; `--restart` để bỏ lượt dở). Lượt dừng giữa chừng: vẫn `runlog.mjs add --mode create --reason "<lý do>"`.
- Pipeline lỗi: làm tiếp theo các bước từng bước 2.0 → 2.10 bên dưới (đường dự phòng); không lách kiểm tra.

2.0. Đồng bộ brand Metricool và giờ đăng tốt nhất (bước đầu của mọi lượt Mode 2):
- Gọi tool MCP `getBrandSettings`, lưu nguyên câu trả lời JSON vào một file (vd `workspace/tmp/brand-settings.json`), rồi:
  ```
  node scripts/metricool-mcp.mjs sync-brands --from workspace/tmp/brand-settings.json
  ```
- Ghi `workspace/metricool-brands.json` (dạng: `config/metricool-brands.example.json`): tên, blogId, múi giờ, mạng đã nối của từng brand. **Giữ** liên kết skill (`skill_id`, `skill_path`) theo blogId; brand không còn trong tài khoản thành `removed: true`. Báo người dùng brand mới (`added`, cần Choose skill ở Overview) và brand đã mất (`removed`).
- Với từng thương hiệu usable: gọi tool MCP `getBestTimeToPostByNetwork` cho brand Metricool của nó (mạng `facebook`), lưu JSON vào file rồi:
  Tham số (theo mô tả của tool: tối đa 1 tuần): `brandId` = blogId của brand, `socialNetwork` = `facebook`, `timezone` = múi giờ của brand trong Metricool (từ `getBrandSettings` / `workspace/metricool-brands.json`), `fromDate` = 00:00 ngày mai **theo múi giờ Metricool của brand**, `toDate` = 23:59 ngày thứ 7 tính từ mai (cùng múi giờ đó), dạng ISO có offset (vd `2026-11-10T00:00:00-05:00`). Mỗi brand một lần gọi.
  ```
  node scripts/metricool-mcp.mjs sync-times --brand <id> --from workspace/tmp/best-times-<id>.json
  ```
  Giờ đăng lấy từ đây; Metricool chưa có dữ liệu thì tool dùng bảng nghiên cứu `config/best-times.json` (docs/metricool.md mục 3). Không đặt giờ tay.

2.1. Gửi bài đã duyệt mà chưa gửi (từng thương hiệu usable):
```
node scripts/metricool-mcp.mjs payload --brand <id> [--posts POST-xx,...]
```
- Mỗi `items[]` = một bài đã duyệt (sổ bài `workspace/posts/<brand>/catalog.json`, `approved`) có `media_url`/`video_url`, chưa có `metricool.<network>.id`, qua kiểm bài `posts.mjs check`. Bài không qua kiểm (kiểm bài lỗi, giờ đã qua, nhãn AI, ký tự ẩn, link không https hay WebP...) nằm trong `blocked` kèm lý do; bài khác vẫn đi.
- Luôn là **bài hẹn giờ thật** (`draft: false`, `autoPublish: true`) ở giờ tốt nhất: mỗi ngày `cadence.posts_per_day` bài theo giờ tốt nhất của Metricool, không có thì bảng nghiên cứu (`docs/metricool.md` mục 3), theo múi giờ khách `cadence.timezone`; `item.time_source` ghi nguồn chọn giờ; `info.publicationDate` mang múi giờ đó, Metricool tự quy đổi. Không có `--draft`/`--schedule`. Bài cũ từng gửi dạng nháp được gửi lại thành bài hẹn giờ (`record` ghi `replaced_draft`; xoá nháp cũ trong Metricool).
- Với từng item: gọi tool `createScheduledPost` với **đúng** `args.blogId`, `args.date`, `args.info` (chuỗi JSON, không sửa). Rồi ngay (lệnh có sẵn trong `item.record`):
  ```
  node scripts/metricool-mcp.mjs record --brand <id> --post POST-xx --id <id> --uuid <uuid> --planner-url <plannerUrl> --publication <publicationDate.dateTime> --tz <publicationDate.timezone>
  ```
  `record` ghi `metricool.<network>` + `schedule.<network>` vào sổ bài của tool, trạng thái `scheduled` (**Scheduled** trong app), rồi kiểm bài. **Không bao giờ gửi hai lần:** `payload` không bao giờ có bài đã có id Metricool sống (scheduled/published), kể cả khi gọi tên bằng `--posts`; `record` từ chối id thứ hai cho cùng bài (không còn `--force`), trừ khi bài đã được rút về bằng `posts.mjs unsend` (id cũ vào `metricool_history`). Tool lỗi → không `record`, báo cáo; lượt sau `payload` đưa lại bài đó.

2.2. Đối chiếu bài đã gửi:
```
node scripts/metricool-mcp.mjs status --brand <id>
```
`query` là `null` (chưa có bài nào đã gửi đang chờ) thì **bỏ qua** `getScheduledPosts`. Có `query` thì gọi `getScheduledPosts` đúng tham số, khớp theo `id`: PENDING → để yên; **ERROR** → báo cáo (id, plannerUrl, lý do; app hiện dấu đỏ); **PUBLISHED** → `node scripts/posts.mjs mark-published --brand <id> --post <POST-xx> --date <yyyy-mm-dd> [--url <link>] --lang <ngôn ngữ đăng>` (Posted; ghi vào sổ bài của tool, không bao giờ vào skill). Sau khi đã đăng mới được gỡ file host: `node scripts/host-image.mjs remove --brand <id> --post POST-xx`. Id nằm trong `ignore_ids` (bài người dùng đã đưa về To review, đã xoá trong Metricool): **bỏ qua**, không `record`, không `mark-published`, không làm sống lại.

2.3. Ý từ kho. Bài kho **không bị dùng hết** (người dùng, 10/11/2026): mỗi bài đổi cảnh và nội dung, nên một bài tham khảo có thể gợi ý nhiều bài, mỗi lần một góc mới. Mỗi bản nháp ghi một lượt vào `uses[]` của bài kho (`draft, idea, scene, product, sign_text, at`); bài vẫn `new`. Trạng thái: **Available** (`new`: còn dùng được, thẻ ghi "new" hoặc "used N×") · **Removed** (`rejected`: không dùng nữa, kèm lý do: bộ lọc, "used enough" hoặc ghi chú người dùng; Restore đưa về Available). Trạng thái "retired" cũ tự chuyển thành Removed (giữ lý do).
```
node scripts/ideas.mjs init --brand <id> [--count N] [--items S0001,S0002] [--source <sid>]
node scripts/ideas.mjs set  --brand <id> --id I001 --json "{\"product_type\":\"...\",\"scene\":\"...\",\"angle\":\"...\",\"props\":\"...\",\"caption_structure\":\"...\",\"hook\":\"...\",\"why\":\"...\"}"
node scripts/ideas.mjs pick --brand <id> --id I001
node scripts/ideas.mjs reject --brand <id> --id I001 --note "<lý do>" [--item rejected]
```
Mặc định `--count` = số bài còn thiếu để phủ `settings.planning.ahead_days` ngày tới (mặc định 7) với `cadence.posts_per_day` bài/ngày (trừ bài đã duyệt chưa đăng và bản nháp đang làm/chờ duyệt; đủ rồi thì không làm thêm). Thứ tự chọn: bài Available chưa dùng lần nào trước (mới nhất trước, xen kẽ các nguồn), rồi bài đã dùng ít lượt nhất đã qua cooldown (`settings.ideas.reuse_cooldown_days`, mặc định 7 ngày); không bao giờ bài Removed hay bài đang có ý mở. `--items S0008` = đúng các bài đó (bài trong cooldown vẫn được, có ghi chú; Removed → lỗi rõ ràng). Bài dùng lại: kết quả `init` có `previous_uses` + `reuse_rule`: phải khác **cảnh** HOẶC khác **sign_text** so với mọi lượt trước (keep-scene: giữ cảnh, đổi chữ; new-scene: đổi cảnh, giữ chữ); cùng cảnh + cùng chữ + cùng sản phẩm thì `set`/`pick`/`draft.mjs new` chặn (lúc `set` chưa có chữ thì chưa chặn). `settings.ideas.suggest_remove_after` (mặc định 0 = tắt): từ N lượt thì Library chỉ **gợi ý** Remove, không tự áp. Remove/Restore: `node scripts/store.mjs remove --brand <id> --id S0001 [--note "used enough"]` / `restore`. Dữ liệu cũ (`status: used`) tự đọc thành `new` + `uses` từ các bản nháp trong `used_by`; ghi hẳn: `node scripts/store.mjs migrate-uses`. Điền ý theo `prompts/idea-abstract.md` (ý trừu tượng, không chép chữ/số điện thoại/link/tên shop: `set` chặn).

2.4. Bản nháp và ảnh:
```
node scripts/draft.mjs new --brand <id> --idea I001 --product "<ảnh sản phẩm của thương hiệu>" --size "<cỡ thật>" [--sign-text "<chữ trên bảng>"] [--scene "<ảnh không khí>"]
node scripts/draft.mjs new --brand <id> --idea I001 --ref-image "workspace/store/<id>/images/S0001-1-....jpg" --brand-can-produce --ref-mode keep-scene --ref-text "<chữ gốc>" --sign-text "<chữ mới>" --size ".."   # scene-swap, ảnh KHÔNG có mặt người
node scripts/draft.mjs new --brand <id> --idea I001 --ref-image "..." --brand-can-produce --ref-mode new-scene --size ".." --compare ".." [--sign-text "<chữ đang có>"]   # scene-swap, ảnh CÓ mặt người
node scripts/draft.mjs reprompt --id <draft> [--size ..] [--compare ..] [--smaller N] [--sign-text .. | --clear-sign-text] [--description ".."]   # dựng lại prompt.txt (giữ mô tả cũ), rồi image --force
node scripts/draft.mjs size-check --id <draft> --product-pct N --object-pct N [--wall-pct N]   # SAU MỖI ẢNH: đo tỉ lệ, ghi vào status.json, hiện ở app
node scripts/draft.mjs image-batch --brand <id|all> [--concurrency N]   # MỌI bản nháp chờ ảnh, song song (mặc định settings codex.concurrency = 3)
node scripts/draft.mjs image --id <draft> [--force]                      # một bản nháp (làm lại một ảnh)
node scripts/draft.mjs watermark --id <draft>                    # chỉ khi product_images.watermark.enabled
node scripts/draft.mjs confirm-clean --id <draft> --by "<tên>" [--no-people]   # chỉ scene-swap, sau khi xem kỹ; new-scene bắt buộc --no-people
```
- Ảnh sản phẩm (`brand-image`, mặc định): trong thư mục skill hoặc `product_images.sources`. Ảnh không khí không được là ảnh kho/đối thủ.
- **Cỡ thật và chữ trên sản phẩm** (luật nằm trong skill: `references/image-guide.md` mục "Kích thước thật và chữ trên sản phẩm" và project.md mục 10): `--size` bắt buộc, lấy theo `product_images.size_source` trong social.json (cm và inch, vd "91 cm (36 in) wide"). `product_images.custom_text: true` (vd DreamyVows) thì bắt buộc `--sign-text`: chữ hợp cảnh (tên cặp đôi, tên quán...), không phải chữ mẫu "Your Names"/"Your Logo" (tool chặn). Có thể ghi sẵn trong ý (`product_size`, `sign_text` qua `ideas.mjs set`). Tool chỉ điền vào prompt; xem ảnh: sai cỡ so với đồ xung quanh, còn chữ mẫu hoặc sai chữ thì làm lại.
- **Tỉ lệ (docs/LESSONS.md; skill image-guide mục "Tỉ lệ trong khung hình")**: `--compare` = vật so sánh trong cảnh kèm cỡ thật (vd "the 4-seat wooden table below, 120 cm (47 in) wide"); prompt luôn có giới hạn: sản phẩm ≤ 60% vật đó, ≤ 40% tường, chừa tường phía trên ≥ 20% chiều cao, chiếm 20-35% ngang ảnh (`--close-up` cho bài cận cảnh; `--frame-max N`; thương hiệu đổi ở `product_images.size_limits`, `null` = bỏ). Sau mỗi ảnh: xem ảnh, ước chiều ngang sản phẩm ÷ chiều ngang ảnh (`--product-pct`) và ÷ vật so sánh (`--object-pct`), chạy `size-check`. Vượt: tạo lại **một** lần theo `next` (`reprompt --smaller N` + `image --force`), đo lại; vẫn vượt thì báo (`check` chặn; `--accept "<lý do>"` chỉ cho bài cận cảnh thật).
- Trước `image`: mở `prompt.txt`, thay `{{PRODUCT_DESCRIPTION}}` bằng mô tả đúng sản phẩm (chữ từng ký tự, dấu, font, màu, vật liệu, tỉ lệ); **không xoá dòng NO LOGO**.
- **Album (người dùng 11/11/2026):** mỗi bài có số ảnh ngẫu nhiên trong `posts.images_per_post` (mặc định `[1, 3]` ở `config/settings.json`; mỗi thương hiệu đè được trong `workspace/brands/<id>.json` `posts.images_per_post`, tool không ghi vào skill; `draft.mjs new --images N` ép số ảnh). `draft.json` ghi `image_count`. Trong thư mục bản nháp ảnh chính luôn là `image.png` (mọi kiểm tra, làm sạch, size-check, watermark như cũ), ảnh phụ là `image-02.png`, `image-03.png`... với `prompt-02.txt`, `prompt-03.txt`... (`prompts/album-extra.txt`: cùng sản phẩm, cùng chữ, cùng cảnh của ảnh chính, khác cú máy: (a) cận chi tiết vật liệu/cạnh/ánh sáng, (b) góc rộng/góc khác của cùng phòng; vẫn NO LOGO, không nhãn AI, khối PHOTOREALISM, luật cỡ thật). `{{PRODUCT_DESCRIPTION}}` điền giống `prompt.txt` (pipeline điền mọi `prompt*.txt`). `draft.mjs image` làm ảnh chính rồi từng ảnh phụ (mỗi ảnh một lượt Codex trong slot chung `codex.concurrency`, đầu vào = `image.png` sạch + ảnh sản phẩm), mỗi ảnh phụ được xoá metadata và ghi `status.json images.<file>` (`ok`/`failed`, sha1); ảnh chính làm lại thì ảnh phụ làm lại theo; chỉ thiếu ảnh phụ thì `draft.mjs image --id <draft>` làm bù (`--force-extras` làm lại hết). `check` báo thiếu/chưa sạch từng ảnh; `confirm-clean` (scene-swap) xem và xác nhận **mọi** ảnh (một hash chung). Approve ghi sang sổ bài theo chuẩn skill: 1 ảnh = `image.png`; nhiều ảnh = `image-01.png` (bìa), `image-02.png`... (catalog `image` + `images[]`, `media_alt[]` một alt mỗi ảnh). **Chữ trên ảnh luôn tiếng Anh; không bao giờ làm `image-vn.png`/`image-en.png`**; bản tiếng Việt chỉ là `content-vn.txt`. Bản nháp cũ chỉ có `image.png` chạy như trước.
- **Ảnh song song (cách mặc định):** điền `prompt.txt` cho mọi bản nháp trước, rồi chạy **một** lệnh `draft.mjs image-batch --brand <id|all>`: mỗi bản nháp chờ ảnh (có `prompt.txt` đã điền, chưa có `image.png`; bản `image_failed` được thử lại) chạy một tiến trình Codex riêng, tối đa `--concurrency N` cùng lúc (mặc định `codex.concurrency`, 3) và cả máy tối đa `codex.concurrency` lượt Codex (khe chung `workspace/tmp/codex-slots/`); mỗi bản nháp giữ `codex.log` riêng và được làm sạch metadata ngay khi xong. Bản còn `{{...}}` trong `prompt.txt` nằm ở `skipped`. Claude Code chạy lệnh này ở chế độ nền (run_in_background) và **viết caption trong lúc ảnh đang chạy** (2.5), rồi xem ảnh và `check`. Codex báo hết lượt / rate limit (`usage limit`, `rate limit`, `quota`, 429): chờ `codex.retry_wait_seconds` (60 s), thử lại **một** lần; vẫn lỗi → `image_failed` kèm lý do (JSON `failed[]`), các bản khác vẫn đi tiếp. Mọi bản đều hết lượt → dừng tạo ảnh, ghi lý do vào nhật ký và báo cáo.
- `image` (một bản nháp) chạy `codex exec --skip-git-repo-check -s workspace-write - -i <ảnh> < prompt.txt`, rồi tự làm sạch metadata (`settings.remove_watermark.script`): `image-generated.png` (gốc) → `image.png` (sạch) + `image-clean-report.json`. Xem ảnh: sai thì sửa prompt, `--force` (tối đa 2 lần). Sandbox chặn `codex exec` lồng nhau thì báo người dùng.
- Scene-swap / bài từ ảnh tham khảo (opt-in `product_images.reference_redraw.enabled`; người dùng 10/11/2026): ảnh kho của chính thương hiệu; **sản phẩm luôn lấy từ ảnh tham khảo** (đúng bảng/đồ đó) và **luôn xoá** mọi logo, tên shop, watermark, nhãn size, số điện thoại, giá; bắt buộc `--brand-can-produce` và `confirm-clean`. Agent **nhìn ảnh tham khảo** rồi chọn `--ref-mode` (ghi `ref_has_face` + `ref_mode` vào file ý và draft.json; `--ref-has-face` phải khớp):
  - **keep-scene** (không có mặt người): giữ nguyên cảnh/nền/khung hình gốc, chỉ thay chữ trên sản phẩm (`prompts/ref-keep-scene.txt`). Bắt buộc `--ref-text` (chữ đang có, đọc đúng) và `--sign-text` chữ **mới**: hợp bối cảnh, **cùng ngôn ngữ/chữ viết** với chữ gốc, đúng font/màu/bố cục; không placeholder, không tên thương hiệu bên thứ ba, không tên khách thật; tool chặn chữ trùng chữ gốc. Caption nhắc đúng chữ mới. Không `size-check` (giữ khung gốc; app ghi "kept original framing").
  - **new-scene** (có mặt người, bất kỳ ai nhận ra được): cảnh đời thật mới hợp sản phẩm, xoá hẳn mọi người, giữ nguyên chữ trên sản phẩm (`prompts/ref-new-scene.txt`; `--sign-text` chỉ ghi lại chữ đang có nếu đọc chắc). Luật tỉ lệ + ảnh như đời thật vẫn áp dụng: `--compare`, lùi máy khỏi ảnh cận, `size-check`. Sau khi xem: `confirm-clean --no-people` (không còn người nào).

2.5. Caption theo `brief.md` (SKILL.md mục A + project.md): `content-<lang>.txt` cho ngôn ngữ đăng (`channels[].lang`, vd `content-en.txt`) và ngôn ngữ chỉ để đọc (`language_policy.review_langs`, vd `content-vn.txt`; không bao giờ đăng). Không nhắc tên shop nguồn, không nhãn AI.

2.6. Kiểm tra tự động:
```
node scripts/draft.mjs check --id <draft>        # qua hết → "ready" (To review); không qua → "needs_caption" + problems
```
Kiểm: ảnh sạch metadata (điểm ảnh không đổi), đủ caption từng ngôn ngữ, caption nhắc đúng `sign_text` (nếu có) và không còn chữ mẫu "Your Names"/"Your Logo" (khi `custom_text`), dòng Website và hashtag cố định, không Markdown/ký tự ẩn, không chép caption tham khảo, không nhãn AI, prompt có NO LOGO, watermark nếu bật, scene-swap đã `confirm-clean` (new-scene: kèm `--no-people`) và caption không có tên shop, keep-scene có `ref_text` + `sign_text` mới khác chữ gốc, `size-check` của ảnh hiện tại không vượt giới hạn (chưa đo = cảnh báo). Sửa rồi chạy lại tới khi `ready`.

2.7. **Dừng ở To review.** Agent không duyệt, không bao giờ ghi vào skill, không host ảnh, không gửi bài mới này. Người dùng xem trong app (tab **Posts** → Preview): **Approve** chạy `node scripts/finalize.mjs approve --id <draft>` (kiểm lại lần nữa, ghi sổ bài của tool `workspace/posts/<brand>/` (`catalog.json` + `<POST-xx>/`, `scripts/posts.mjs`): mục `approved`, ảnh sạch + caption, kiểm bài, host ảnh → `media_url`; skill không bị đụng); không qua → `check_failed` + lý do. **Drop** = `node scripts/finalize.mjs cancel --id <draft> [--note ".."]`. Host lỗi không huỷ bài: chạy lại `node scripts/host-image.mjs publish --brand <id> --post POST-xx` (có trong `image_host.next`). Lượt Create & publish sau gửi bài đã duyệt ở bước 2.1. **Back to review** (tab Posts, bài Approved hoặc Scheduled, không bao giờ bài Posted) = `node scripts/finalize.mjs unapprove --id <draft> [--metricool-deleted]`: mục sổ bài + thư mục bài chuyển vào `workspace/posts/<brand>/archive/<POST-xx>-<giờ>/`, ảnh host bị gỡ khỏi repo ảnh (git rm + push), bản nháp về To review, lượt dùng của mục kho vẫn giữ; số POST đó không dùng lại. Bài đã hẹn giờ trên Metricool: người dùng xoá trong Metricool trước rồi xác nhận (`--metricool-deleted`); id Metricool cũ giữ trong `status.json` `reverted[]` của bản nháp. Agent không tự chạy lệnh này.

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
- **Khác:** brand Metricool mới/mất (2.0), bài đã đăng, kho còn bao nhiêu bài Available / sẵn sàng (chưa dùng + qua cooldown). Cảnh báo "Library low" đếm bài chưa dùng + bài dùng lại được sau cooldown.

## Mode 3. Publish approved

Đường nhanh: `node scripts/pipeline.mjs mcp-plan` → gọi MCP, lưu file → `node scripts/pipeline.mjs publish --brand <id|all> --brand-settings workspace/tmp/brand-settings.json --best-times-dir workspace/tmp [--limit N] [--window w] [--start today]` (brands --run publish, sync, payload tính giờ ngay lúc này + status) → gửi từng item NGAY (createScheduledPost → record; quá `send_before` thì chạy lại payload) → đối chiếu → `node scripts/pipeline.mjs publish --resume` (queue + run log) → báo cáo 3.2. Dự phòng: các bước dưới đây.

Chỉ gửi lên Metricool các bài người dùng đã **Approve** mà chưa gửi. Không làm ý, không tạo bài, không mở trình duyệt. Dùng lại đúng các bước của Mode 2, không lặp lại ở đây:
- Setup (như mọi lượt), rồi **2.0** (đồng bộ brand và giờ đăng tốt nhất), **2.1** (hẹn giờ thật mọi bài đã duyệt chưa gửi), **2.2** (đối chiếu), **2.8** (số liệu: `node scripts/queue.mjs`).

3.1. Ghi nhật ký lượt chạy: như 2.9 nhưng `--mode publish`:
```
node scripts/runlog.mjs add --mode publish --agent "<Claude Code|Codex>"
```

3.2. Báo cáo cho người dùng, tiếng Việt, **luôn đúng các mục**: **Kết quả chung** (N bài đã hẹn giờ · N lỗi), **Đã hẹn giờ** (POST-xx · giờ đăng · plannerUrl), **Lỗi** (bài lỗi Metricool hoặc bị chặn, kèm lý do), **Khác** (brand Metricool mới/mất, bài đã đăng). Nhắc: bài chờ duyệt (To review) vẫn nằm ở tab **Posts**.

## Phụ lục: ảnh/video host

- **Album:** `host-image.mjs publish` đẩy mọi ảnh (`<post>-01.png`, `<post>-02.png`...) và ghi `media_url` là danh sách link đúng thứ tự (bìa trước); `metricool-mcp.mjs payload` đưa cả danh sách vào `info.media` của `createScheduledPost` và `info.mediaAltText` (một alt mỗi ảnh, `posts.mjs fill-alt` điền bù). Một ảnh: `media_url` vẫn là một link.

`host-image.mjs` (gọi tự động khi Approve) chép ảnh sạch của bài đã duyệt vào clone của repo **công khai** `social-autopilot-sources` (`settings.imageHost.path`, mặc định `workspace/image-host` trong thư mục tool: repo git riêng, `workspace/` không lên git của tool; máy chưa có thì `host-image.mjs` tự `git clone` từ `settings.imageHost.remote_url`), đường dẫn `<brand>/<yyyy>/<mm>/<post-id>.<ext>`, commit "<brand> <post-id>", push, chờ HTTP 200, ghi `media_url` dạng link raw GitHub:
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
node scripts/progress.mjs show --mode research|create|publish            # Run progress (tab Prompt) của lượt đang chạy / lượt cuối
node scripts/progress.mjs new --mode <mode> [--brand a,b]                 # lượt pending mới (như nút Copy prompt)
node scripts/social.mjs show --brand <id>                                 # social.json tool dùng (skill + chỉnh riêng trong tool)
node scripts/social.mjs override --brand <id> --json '{"posts_per_day":2,"paused":false,"sources_add":[],"sources_disabled":[]}'   # như Edit brand: lưu ở workspace/brands/<id>.json, skill không đổi
node scripts/research.mjs clean --in <file> [--out <file>]                 # lọc U+034F / zero-width / NBSP
node scripts/image-clean.mjs --id <draft>                                  # làm sạch metadata lại
node scripts/writeback.mjs --id <draft>                                    # chạy lại ghi vào sổ bài của tool khi Approve lỗi giữa chừng
node scripts/posts.mjs list|check|mark-published --brand <id> [--post POST-xx] [...]   # sổ bài của tool (workspace/posts/<brand>/)
```
