# Social Autopilot

Tự làm bài Facebook cho nhiều thương hiệu và hẹn giờ đăng qua Metricool.
Agent (Claude Code hoặc Codex) làm việc; app chỉ để xem, duyệt và quản lý.

## Cách hoạt động

```
1. Research   →  crawl các nguồn bạn chọn (đầy đủ tới hết trang, tiếp tục được; sổ đăng ký nhớ nguồn nào đã xong) vào Library (bỏ trùng); tìm theo từ khoá chỉ khi skill của thương hiệu bật `research.discovery.enabled` (tự chạy sau các nguồn). Nguồn là danh sách của bạn (Overview > Edit), không có link mặc định
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
3. **Playwright MCP** chạy trên profile Chrome riêng của tool (đăng nhập một lần ở Run tab > Browser, các lần chạy sau dùng nền, headless): không cần `npm install`.
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
| Overview | Brand, skill, trạng thái, số bài; Edit: nguồn nghiên cứu của bạn (thêm tên tuỳ chọn + link, xoá, tick) kèm trạng thái crawl và Recrawl |
| Library | Bài tham khảo đã crawl: Available (còn dùng được, thẻ ghi "new" hoặc "used N×") / Removed (không dùng nữa, kèm lý do); một bài có thể gợi ý nhiều bài (mỗi lần góc mới); Preview: **Make a post from this** (sang Prompt: Create & publish, 1 bài, `--items`, tuỳ chọn Scene-swap), Remove (lý do tuỳ chọn), Restore |
| Posts | Thẻ và Preview hiện ngày tạo (YYYY-MM-DD, bên phải dòng phụ) giống Library hiện ngày crawl; Bài của mình: To review · Approved (chờ gửi) · Scheduled (trên Metricool) · Posted; bài album xem trước đủ mọi ảnh, ảnh bìa trước |
| Prompt | Lấy prompt để chạy |
| Settings | Tài khoản, yêu cầu, cài đặt tool |

**Research** (tab Run): chọn **Brand**, **Platforms** (mặc định "All" = instagram, pinterest, facebook, etsy, houzz; bỏ tick một nền tảng thì nguồn của nó bị loại và discovery chỉ chạy trên các nền tảng còn tick, prompt thêm `--platforms a,b`; nguồn hiệu lực = nền tảng đã tick ∩ nguồn đã tick; không tick nền tảng nào thì khoá "Tick at least one platform") và **Sources** [ô chỉ liệt kê những gì CÒN LẠI, mỗi dòng chỉ có TÊN (không trạng thái, không số bài): nguồn chưa crawl hết (none/partial) và nguồn được gợi ý (nhãn nhỏ "suggested", tooltip = nền tảng + lý do + URL; mặc định chưa tick; tick rồi thì được thêm vào nguồn của brand đúng lúc bấm Run now / Copy prompt qua POST /api/sources/accept, còn dựng prompt thì không ghi gì); nguồn complete bị ẩn nhưng vẫn chạy quick top check; nhãn tóm tắt "k of M" = k dòng đang tick trên M dòng đang hiện (không tính nguồn ẩn), "None left" khi M = 0; trang Edit vẫn liệt kê tất cả kèm trạng thái và Recrawl (đặt về none nên nguồn hiện lại), cùng danh sách nguồn gợi ý với nút Add / Dismiss (Dismiss: URL đó không bao giờ được gợi ý lại)] (mặc định mọi nguồn đang bật của brand được crawl, không cờ `--source`; bỏ tick để tập trung vài nguồn cho lượt đó, không lưu, prompt thêm `--source`; không tick nguồn nào thì Copy prompt / Run now bị khoá "Tick at least one source"; bật/tắt từng nguồn và xem never / partial / complete, số bài, ngày chạy cuối ở Overview > Edit) và **Max posts per brand** (trống = không giới hạn). Không có link mặc định và không có ô Crawl: nguồn mới/dở được lấy tới hết trang (tiếp tục được ở lần sau), nguồn đã xong chỉ kiểm đầu trang; nút **Recrawl** ở Overview > Edit (mỗi nguồn) cho lấy lại từ đầu. Chưa có nguồn thì Copy prompt / Run now bị khoá kèm lời nhắc thêm link ở Overview > Edit. Khi không còn gì để crawl (mọi nguồn đã complete và không có gợi ý chờ; ô Sources ghi "None left", dưới nút có dòng "All sources are done: this run looks for new sources"), Research đi tìm NGUỒN MỚI ngoài danh sách: OPTIONS có `external sources for: <brand>` và prompt thêm bước cuối `EXTRA STEP 1.4b External sources` (không đánh số, sau 1.4, trước run log; văn bản ở `scripts/prompts.mjs` `EXTERNAL_TEXT`, chỗ `{{EXTERNAL}}` của docs/scheduled-prompt.md). Agent chạy `node scripts/sources.mjs queries --brand <id>` (keywords/hashtags/platforms của `research.discovery` trong skill, dùng cả khi `discovery.enabled` là false, bị ô Platforms giới hạn), tìm trang công khai MỚI (Facebook page/group, Instagram account, Pinterest board/profile, Etsy shop, Houzz pro) có sản phẩm hợp brand, và với mỗi ứng viên tốt (tối đa 5 mỗi brand mỗi lượt) chỉ GỢI Ý, không crawl: `node scripts/sources.mjs suggest --brand <id> --url <url> --name "<tên>" --platform <p> --reason "<lý do ngắn>"` (kiểm URL http(s), bỏ qua trang đã là nguồn / đã gợi ý / đã Dismiss; không gợi ý trang cá nhân hay riêng tư). Gợi ý nằm ở `workspace/brands/<id>.json` `suggested[]` (`{id,name,platform,url,reason,found_at}`) và `dismissed_suggestions[]`, chỉ ghi qua `sources.mjs suggest|accept|dismiss|list-suggested` (cùng khoá file với override) hoặc POST /api/sources/accept|dismiss; người dùng chọn trong ô Sources của tab Run hoặc ở trang Edit (Add / Dismiss). Script `collect.mjs` lấy dữ liệu (script in-page tự cuộn, chạy qua Playwright MCP trong Chrome đã đăng nhập, một lần gọi một vòng), rồi agent lọc cả lô (`store.mjs classify` / `verdict`): bài bị lọc nằm ở Library → Dropped kèm lý do; tab Log hiện "N kept · M filtered".

## Run now (chạy không cần dán)
Tab Prompt có nút **Run now** cạnh **Copy prompt** (Copy vẫn như cũ). App tự chạy Claude Code ở chế độ headless với đúng prompt đó, kèm Playwright MCP riêng cho lần chạy, và hiện tiến độ trực tiếp (trạng thái, thời gian, dòng cuối, Live log). Trình duyệt là profile Chrome riêng của tool, chạy nền (headless), không có bước Connect. Agent chạy với danh sách tool giới hạn theo mode và giới hạn thời gian cứng (settings `agent_run.timeout_minutes`: research 30, create 30, publish 15 phút; `agent_run.max_turns` theo mode (xem bên dưới)). Nút **Stop** dừng cả cây tiến trình. Chỉ một lần chạy mỗi lúc. Không tìm thấy Claude: đặt `claudeCli.command` trong workspace/settings.json. Log rút gọn ở workspace/runs/agent-run.log (không chứa input/kết quả của tool).
Model của lần chạy: ô **Model** (Default | Haiku | Sonnet | Opus, nhớ riêng từng mode, chỉ khi Run in the app) truyền `--model haiku|sonnet|opus`; Default = không cờ (Claude Code tự chọn); settings `agent_run.model_map` có thể đổi alias thành model id đầy đủ.

Quy tắc theo mode (Run now, `core/setup/agent-run.mjs`): Research = Playwright MCP (cấu hình MCP strict) + Bash/Read/Glob/Grep; Create = Bash/Read/Write/Edit/Glob/Grep + Metricool CHỈ đọc (getBrandSettings, getBestTimeToPostByNetwork, getScheduledPosts), KHÔNG BAO GIỜ tool ghi Metricool, thêm tool trình duyệt Playwright khi engine ảnh của lần chạy là Flow; Publish approved = như Create + createScheduledPost, không có trình duyệt. Playwright MCP chỉ được cấu hình khi lần chạy cần trình duyệt (Research, Create với Flow). `--add-dir`: thư mục tool, skillsRoot (brand-content-skills), `brandsRoot` nếu có, và thư mục Downloads khi dùng Flow (agent chuyển file ảnh tải về từ đó). Giới hạn cứng (`agent_run.timeout_minutes`, phút): research 30, create 30, create_flow 45, publish 15; `agent_run.max_turns` là số chung hoặc object theo mode, mặc định research 400, create 600, create_flow 900, publish 200. Lỗi có hướng dẫn trên live panel và toast: chưa đăng nhập Claude Code (`claude` một lần trong terminal rồi đăng nhập), connector Metricool thiếu/cần đăng nhập lại (Publish, Create), profile của trình duyệt riêng bị khóa hoặc thiếu. Khi kết thúc: toast kết quả, làm mới Posts, Library, Overview, Log; kết quả được ghi vào Log như lần chạy prompt (nếu agent chưa tự ghi). Một trình duyệt = một agent: app chặn khi đang có một lần chạy headless, nhưng KHÔNG dò được phiên khác (terminal, Claude Desktop) đang dùng cùng profile Chrome riêng; hãy đóng chúng trước khi bấm Run now với Research hoặc Create + Flow.
Live panel của Run now có thanh tiến độ (đã xong/tổng bước của mode, theo Run progress; chưa có dữ liệu bước thì thanh chạy mờ; xanh = xong, đỏ = lỗi, vàng = dừng/hết giờ) và Live log dễ đọc bằng tiếng Việt (`friendly` trong GET /api/agent-run, không tên tool/đường dẫn); log thô đã làm sạch nằm trong mục "Chi tiết kỹ thuật" (đóng sẵn). Khi chạy xong, panel hiện BÁO CÁO ĐẦY ĐỦ của agent (`report` trong GET /api/agent-run, giữ xuống dòng, đã ẩn token, tối đa 12000 ký tự, lưu trong workspace/runs/agent-run.json), có nút Copy report.
Bộ đếm trực tiếp của lần chạy (GET /api/run-progress, hỏi cùng nhịp với /api/agent-run, chỉ đọc từ file lần chạy đã ghi): Research = bài mới giữ được mỗi brand / mục tiêu (`run.json`), Create = drafts / yêu cầu và ảnh xong (`pipeline/create.json` + drafts), Publish = đã lên lịch / tổng đã duyệt; hiện dưới thanh tiến độ, trong pill ở các tab khác, và giữ số cuối khi chạy xong. Overview mỗi brand hiện Channels, Plan (posts/day, hôm nay), Library ready/cooling/removed, Posts theo trạng thái, Sources, Last crawl.
Khoá khi đang chạy: khi một lần Run now của app đang active (GET /api/agent-run), mọi nút/ô có thể làm hỏng lần chạy bị disabled (Run tab trừ Stop và phần chỉ đọc; Reload/Update ở header; Save/Recrawl/Add/Remove/Approve/Drop/Restore ở các tab khác; tooltip "A run is active: wait for it to finish or press Stop"), có banner kèm thời gian chạy; mở khoá khi chạy xong hoặc khi 3 lần hỏi trạng thái liên tiếp lỗi. Hàm trung tâm `setRunLock` trong ui/index.html; chỉ lần chạy của chính app mới khoá (không dò được lần chạy ở terminal); server cũng từ chối POST /api/update và /api/reload khi đang chạy.

## Own browser (log in once)

**Own browser (the only browser mode, `browser.mode: "own"`).** Run now uses the tool's own Chrome profile (`workspace/browser-profile`, local, gitignored, never committed or logged). Run tab > Browser > **Open browser to log in** opens a visible Chrome on that profile with Facebook, Instagram, Pinterest, Etsy, Houzz and Flow (Google): log in by hand (the tool never sees passwords), close the window. Runs then start `npx @playwright/mcp@latest --browser chrome --user-data-dir <profile> --headless` in the background: no visible window, no clash with other sessions. The login window and a run cannot hold the profile at the same time (each refuses while the other is active). A login wall or checkpoint ends the run with the hint "Log in again: Run tab > Browser > Open browser to log in". Settings: `browser.headless` (default true; switch off if a site blocks headless), `browser.profile_dir` (`browser.mode` is always `own`; an old stored value is ignored).

Run the prompt yourself (Copy prompt): start the session's Playwright MCP with the profile, e.g. `claude mcp add playwright -- npx -y @playwright/mcp@latest --browser chrome --user-data-dir <tool>/workspace/browser-profile --headless` (close the login window first). Without `--headless` the window is visible. If the installed Chrome channel cannot be used, the package falls back to its own Chromium and the logins must be redone in it.

## Browser
Nothing is machine-specific: Chrome is discovered; override with `research.chrome_path` in `workspace/settings.json` if needed.
## Quy tắc

- Luôn hẹn giờ thật, không làm nháp. Đăng mỗi ngày (`cadence.posts_per_day`, mặc định 1) ở giờ tốt nhất của Metricool cho brand; chưa có dữ liệu thì theo bảng nghiên cứu `config/best-times.json` (America/New_York). Không đặt giờ tay. Publish approved có Start: From today (mặc định trong app: giờ tốt nhất kế tiếp, chừa 15 phút; 1 bài/ngày chỉ giờ chính) / From tomorrow.
- Không logo trên sản phẩm, không nhãn AI.
- Ảnh được host ở repo công khai `social-autopilot-sources` (link raw GitHub); bản clone nằm trong tool ở `workspace/image-host` (tự clone từ `imageHost.remote_url` khi chưa có).
- Agent không bao giờ tự duyệt bài.

## Settings file

Tab **Settings** chỉ cho sửa **Plan ahead (days)** và **Auto-host images**. Các cài đặt chuẩn khác không hiện trên app; ai cần đổi thì sửa tay `workspace/settings.json` của máy (ghi đè lên mặc định `config/settings.json`, cùng khoá):
Tab **Settings** còn có **Image engine** (`image_engine`): `Codex` (mặc định) hoặc `Google Flow`. Với Flow, Create & publish bảo agent tạo ảnh trên Google Flow trong Chrome (Playwright MCP) rồi chạy `draft.mjs register-image`; ảnh Flow có sao Google ở góc phải dưới và tool xoá cục bộ (`scripts/image-unsparkle.mjs`, nhận PNG/JPG). Với Flow tạo ảnh theo lô: gửi hết prompt (bìa của mọi bài) không chờ, chờ một lần, rồi ảnh phụ của album (ảnh 1 làm tham chiếu), tải và đăng ký từng ảnh; `draft.mjs flow-brief --id <draft> [--n k]` in prompt rút gọn. Chi tiết: `docs/flow-images.md`. Tab **Run**, chế độ Create & publish có ô chọn **Images** (Codex / Google Flow), mặc định theo Settings, chỉ áp dụng cho lần chạy đó (không ghi vào Settings): ghi vào prompt (`{{IMAGES}}`) và lệnh `pipeline.mjs create --image-engine ...`; Run now với Flow cho phép các tool trình duyệt Playwright và chạy trong trình duyệt riêng như Research. Sao Google được tool tự dò vị trí (1K ≈ 103/97 px, 2K = 120/120 px từ mép phải/dưới), nên nhận cả ảnh 1K và 2K. Không có skill remove-watermark trên máy thì dùng bộ làm sạch metadata có sẵn trong tool (`cleaner: built-in`).

| Khoá | Ý nghĩa |
|---|---|
| `research.delay_seconds` | `[min, max]` giây nghỉ ngẫu nhiên (giữ cho tương thích) |
| `research.scroll_wait_seconds` | theo nền tảng, `[min, max]` giây Claude chờ giữa hai lần cuộn (Pinterest/Houzz/Etsy 2-4, Instagram/Facebook 5-10) |
| `research.dedupe` | ngưỡng trùng: `image_distance` (/256), `caption_similarity` (0–1) |
| `codex.command`, `codex.timeout_minutes` | lệnh chạy Codex, thời gian chờ tối đa |
| `codex.concurrency`, `codex.retry_wait_seconds` | số ảnh Codex làm cùng lúc trên cả máy (3), giây chờ trước khi thử lại khi Codex báo hết lượt (60) |
| `posts.album_mode` | `random` (mặc định) | `angle` | `scene`: kiểu album của bài từ 2 ảnh: `angle` = cùng cảnh, góc khác; `scene` = cùng sản phẩm, cảnh khác theo bảng của thương hiệu; random = 50/50 mỗi bài, ghi vào `draft.json` `album_mode`. Settings > Album; ô chọn nhiều Image types ở Run tab (Same scene, other angles / Other scenes; mặc định tích cả hai = ngẫu nhiên giữa hai kiểu, không cờ; chỉ tích một = `--album angle` hoặc `--album scene`; luôn giữ ít nhất một; chỉ có tác dụng với bài từ 2 ảnh); CLI `pipeline.mjs create --album angle|scene|random` |
| `posts.images_per_post` | `[min, max]` (1-4) số ảnh mỗi bài, chọn ngẫu nhiên (mặc định `[1, 4]`, tối đa 4; Settings > Images per post; mỗi lần chạy: hai ô số min/max luôn hiện ở Run tab (mặc định theo Settings = không cờ; min = max = `--images N`; còn lại `--images min-max`); ô chọn nhiều Image types ở Run tab (Same scene, other angles / Other scenes; mặc định tích cả hai = ngẫu nhiên giữa hai kiểu, không cờ; chỉ tích một = `--album angle` hoặc `--album scene`; luôn giữ ít nhất một; chỉ có tác dụng với bài từ 2 ảnh); mặc định lấy từ Settings > Album); thương hiệu đè trong `workspace/brands/<id>.json` `posts.images_per_post`. 1 ảnh = `image.png`; nhiều ảnh = `image-01.png` (bìa), `image-02.png`...; chữ trên ảnh luôn tiếng Anh |
| `ffmpeg.command` | lệnh ffmpeg (watermark, đọc WebP khi dedupe) |
| `skillsRoot` | thư mục repo chứa skill dùng chung (mặc định `../vaniecom-workspace`): thương hiệu ở `<skillsRoot>/brand-content-skills/brands/<id>/` (một thư mục cho mỗi thương hiệu, trong skill); chỉ thư mục con có `SKILL.md` được coi là skill; tool vẫn nhận `<repo>/brands/<id>/` (đè bằng `brandsRoot` / `SA_BRANDS_ROOT`) và bố cục cũ `<id>-skills/`; biến môi trường `SA_SKILLS_ROOT` đè lên khi chạy thử |
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
Các lựa chọn của Run tab (Agent, How to run, Brand, Max posts, Sources/Platforms, Images, Images per post (min/max), Image types, Posts, Time, Start) được nhớ trong trình duyệt/app này (localStorage); Library item thì không.

- **Quản lý đăng nhập (own browser)**: Run tab > Browser > Logins liệt kê từng nền tảng (Facebook, Instagram, Google/Flow bắt buộc; Pinterest, Etsy, Houzz không) với trạng thái đã đăng nhập / chưa / không rõ, nút Log in mở cửa sổ own browser đúng trang, Refresh. Trạng thái chỉ đọc METADATA cookie (tên, host, hạn) từ bản sao tạm của file cookie trong workspace/browser-profile (`core/setup/own-browser.mjs`, GET `/api/browser-logins`), không giải mã, không trả giá trị. Biết được: cookie đăng nhập có mặt và chưa hết hạn. Không biết được: phiên còn hợp lệ trên site hay không (bị đăng xuất phía server, checkpoint, đổi mật khẩu); Etsy và Houzz luôn là Unknown vì chưa có cookie đăng nhập xác nhận. **Check by visiting** (nút riêng, không bao giờ tự chạy; `core/setup/login-visit.mjs`, POST `/api/browser-visit`): Chrome headless tạm trên chính profile, mở MỘT trang cần đăng nhập mỗi nền tảng (Facebook /settings, Instagram /accounts/edit/, Pinterest /settings/, Etsy /your/account, Houzz /settings [độ tin cậy thấp, chưa xác nhận], Google myaccount.google.com), chờ ~6 s (tối đa 12 s), chỉ quyết định từ URL CUỐI (host + path) sau redirect: về trang đăng nhập/checkpoint = chưa đăng nhập, ở lại trang tài khoản = đã đăng nhập, còn lại (captcha, lỗi, timeout) = Unknown. Không đọc DOM, ảnh chụp, cookie hay storage; không lưu URL. Từ chối khi cửa sổ login đang mở hoặc run đang giữ profile; tổng tối đa 90 s; luôn kill cả cây tiến trình. Kết quả ghi đè Unknown của cookie (và kết quả rõ ràng của lần ghé mới nhất thắng cookie), giữ trong bộ nhớ phiên + `workspace/runs/login-checks.json` (chỉ trạng thái và giờ). Giao diện luôn hiện dòng "Checked HH:MM (cookies | visited the pages)" + toast tóm tắt; mỗi hàng có tooltip lý do và nguồn. Chưa kiểm chứng với site thật: các redirect của Etsy/Houzz/Pinterest, và Facebook có thể bật checkpoint với trình duyệt tự động. Bảng trang + mẫu URL nằm ở `VISIT_PAGES` (sửa được). Nguồn cần đăng nhập BẮT BUỘC mà chưa đăng nhập hiện ổ khóa và cảnh báo trước Run now (không chặn). Check by visiting KHÔNG ghé Etsy, Houzz và Pinterest (tuỳ chọn, đọc được khi chưa đăng nhập; ghé từ trình duyệt ngầm có thể kích trang chặn bot như "Access is temporarily restricted"): chỉ có gợi ý từ cookie hoặc "unknown".
