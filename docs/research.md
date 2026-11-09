# Mode 1 "Research only": crawl hết nhanh, rồi lọc

Hai bước tách rời: **(1) crawl bằng script** (`scripts/crawl-fb.mjs`, không có agent bấm từng bài) lấy mọi bài theo luật dừng, **(2) lọc một lượt** (`store.mjs classify` + `verdict`): agent đọc chữ + ảnh thumb của cả lô và giữ/bỏ. Lệnh và thứ tự: `RUNBOOK.md`, Mode 1. Kho của mỗi thương hiệu: `workspace/store/<brand>/` (`items.json`, `images/`, `progress.json`, `duplicates.json`); kho của các thương hiệu không bao giờ trộn.

## Trước khi bắt đầu
- Chrome có cổng điều khiển (`--remote-debugging-port=9222`, profile riêng đã đăng nhập Facebook tài khoản phụ `research.fb_account`): RUNBOOK mục "Chrome cho crawl". `npm install` một lần. Không tự đăng nhập, không nhập mật khẩu; cookie chỉ nằm trong profile Chrome, không bao giờ trong repo.
- `research.mjs start` mở lượt; `crawl-fb.mjs` chỉ crawl các source trong `run.sources`, đúng thứ tự, của **một** thương hiệu. Một Chrome, một lượt crawl: không chạy song song.

## Crawl bằng script (`crawl-fb.mjs`)
- **Kết nối**: `research.browser.cdp` (mặc định `http://127.0.0.1:9222`, đổi bằng `--cdp`) gắn vào Chrome đang mở, chỉ mở/đóng tab của chính nó; hoặc `research.browser.user_data_dir` (profile ngoài thư mục tool) để tool tự mở Chrome.
- **Mỗi bước cuộn = một `page.evaluate`**: bấm "Xem thêm"/"See more" **chỉ trong phần chữ của bài**, rê chuột lên nhãn thời gian (Facebook chỉ hiện link bài khi hover), đọc mọi bài chưa đọc, rồi cuộn ~1 màn hình. Nghỉ ngẫu nhiên `research.delay_seconds` sau mỗi bước cuộn (không phải mỗi bài). Backfill khi còn ở trên `oldest_seen`: cuộn 3 màn hình, nghỉ nửa nhịp, không mở "Xem thêm".
- **Mỗi bài**: `post_url` (permalink `/posts/`, `/permalink`, `story_fbid`; không có thì `/reel/`, `/videos/`, `/photo/?fbid=`), `alt_urls` (link từng ảnh, để bỏ trùng), caption đầy đủ, `posted_date` (từ nhãn thời gian: "2d", "3 giờ", "Hôm qua", "November 2", "2 tháng 11, 2024"...; không rõ thì trống), ảnh (`scontent`, bỏ emoji/avatar/ảnh bình luận), `media_type` (`photo` / `album` / `video` / `text`). Bình luận (role=article lồng trong bài) không bao giờ được lấy.
- **Ảnh**: tải bằng phiên của Chrome vào `<source>/raw/<n>-<k>.<jpg|png|webp>` (ảnh trong feed; bài video lấy ảnh bìa). Ảnh đại diện trang → `raw/avatar.*`.
- **raw.json** (chuẩn duy nhất; `ingest` vẫn nhận dạng mảng cũ): `{ "page": { "name", "avatar": "raw/avatar.jpg" }, "posts": [{ post_url, alt_urls, posted_date, caption, images: ["raw/1-1.jpg"], media_type, store, page_pos }] }`. Mỗi vòng ghi đè bằng bài của vòng đó; `ingest.json` nhớ link đã ingest nên ingest lại cùng file không đếm trùng giả.
- **Bài không caption** (chỉ ảnh) vẫn giữ, đánh dấu `caption_empty` để bước lọc quyết. Bài chỉ có chữ (không ảnh) bị `ingest` bỏ ("không có file ảnh").
- **Luật dừng** (giống `stop_rule`): mặc định 3 bài liên tiếp đã có (bài ghim đầu trang không làm dừng sớm); `--backfill` cuộn nhanh qua bài đã có, bắt đầu lấy sau `oldest_seen` (theo mã/link, hoặc ngày cũ hơn); `--full` không dừng ở bài đã có; `--since`: 2 bài liên tiếp cũ hơn mốc; hết trang: 3 lần cuộn không có bài mới.
- **`--max-posts` xoay vòng**: mỗi vòng, mọi nguồn còn bài được phần đều của số còn lại (10 bài / 3 nguồn = 4, 3, 3); nguồn cạn để phần dư cho các nguồn khác ở vòng sau (tab vẫn mở, cuộn tiếp từ chỗ cũ). Nguồn chưa từng được mở vì hết phần: `result --state skipped` ("Skipped (quota)", không tính là cạn).
- **Trang ngừng tải** (Facebook hay chỉ hiện 1-3 bài rồi đứng, vd trang ít tương tác): script chờ khi còn vòng tải (`role=progressbar`), cuộn lùi rồi bấm End; 3 lần không có gì mới mà mới thấy ít hơn `research.browser.stall_posts` (5) bài thì chuyển tab theo `fallback_tabs`: `/posts` (feed), rồi lưới `/photos_by` và `/reels`. Ô lưới mới (chưa có trong `known.json`) được mở **một lần** ở tab phụ để lấy caption, ngày, ảnh lớn (nghỉ `delay_seconds` mỗi lần mở). Lưới ảnh bỏ sót bài chỉ có chữ; lưới reels bổ sung video. Tab đã dùng ghi trong JSON (`tabs`).
- **Bị chặn**: checkpoint, captcha, form đăng nhập, "Bạn tạm thời bị chặn", "Security check" → dừng ngay, nguồn đó `blocked`, không mở nguồn nào nữa (các nguồn chưa mở để `pending`).
- **Selector hỏng**: 3 bước liền đọc được 0 bài trong khi trang có phần chữ bài/link bài → `partial` với note `error: selectors ...`. Mọi selector nằm trong `scripts/fb-extract.mjs` (`SELECTORS`, mỗi mục là danh sách dự phòng); sửa ở đó, chạy `npm test` (fixture `tests/fixtures/fb-*.html`), hoặc crawl tay nguồn đó (Dự phòng bên dưới).
- **Không bao giờ** like, bình luận, theo dõi, chia sẻ, nhắn tin; thao tác duy nhất ngoài cuộn là "Xem thêm" trong chữ của bài.

## Lọc sau khi crawl (`store.mjs classify` / `verdict`)
- `classify --brand <id> [--limit 40] [--source <sid>]`: lô bài `new` chưa lọc (id, nguồn, đoạn đầu caption hoặc `(no caption)`, media, đường dẫn thumb), `what_to_take` từng nguồn, đường dẫn `project.md` (phạm vi sản phẩm), `rules_of_thumb`, `remaining_after`.
- Agent quyết cả lô trong một lượt (đọc chữ + xem ảnh thumb, **không mở trình duyệt**), ghi `[{ "id", "fit": true|false, "reason" }]`, chạy `verdict --brand <id> --file <file>`. `fit:false` → Dropped, ghi chú `filter: <lý do>` (tab Library hiện lý do); `fit:true` → giữ. Bài đã used/rejected bị bỏ qua (`skipped`).
- Luật nhanh: bỏ **tuyển dụng**; bỏ **cuộc thi / minigame / giveaway**; bỏ **chỉ có chữ** (hoặc ảnh chỉ là chữ, banner khuyến mãi không thấy sản phẩm); bỏ **chia sẻ lại không có ảnh sản phẩm**; bỏ **sản phẩm ngoài ngành hàng** (so với `project.md` và `what_to_take`). Không chắc → giữ (người dùng còn Drop ở app).
- Báo cáo/nhật ký: mỗi nguồn `kept` / `filtered`; nguồn có ≥ 5 bài đã lọc mà giữ < 30% bị gắn cờ keep rate thấp (xem lại `what_to_take` hoặc thay nguồn).

## Dự phòng: crawl tay bằng Playwright MCP
Chỉ dùng khi `crawl-fb.mjs` không chạy được cho một nguồn (selector hỏng chưa sửa kịp, trang lạ). Claude Code / Codex có Playwright MCP (`npx -y @playwright/mcp@latest --extension`) gắn vào Chrome đã đăng nhập. Đọc `stop_rule` và `known_file` của source (`known.json`: `post_urls`, `brand_post_urls`, `brand_post_ids`, `newest_seen`, `oldest_seen`). Nghỉ ngẫu nhiên trong `delay_seconds` giữa **mọi** lần mở trang, cuộn, bấm. Gặp checkpoint/captcha: `research.mjs result --source <sid> --state blocked --note "<lý do>"`, dừng.

### Crawl tay một source
1. Mở `url` của source. Trang Facebook: vào tab **Bài viết** (hoặc trang chính, phần bài viết). Nếu nguồn chủ yếu đăng ảnh (album sản phẩm), dùng tab **Ảnh** (`/photos` hoặc `/photos_by`), mở từng ảnh để vào bài.
2. Cuộn xuống dần (mỗi lần một màn hình, nghỉ giữa các lần) cho tới khi đúng `stop_rule`:
   - **hết trang**: cuộn thêm 3 lần liền mà không có bài mới hiện ra (không còn vòng tải thêm) → `--state end`;
   - **tới bài đã có** (lần crawl sau, không `--full`): gặp **3 bài liên tiếp** có link hoặc mã nằm trong `known.json` → `--state known`. Bài ghim đầu trang có thể là bài cũ: bỏ qua, đi tiếp;
   - **tới mốc ngày** (`--since`): tới bài đăng trước ngày đó → `--state since`;
   - **đủ phần của nguồn** (`--max-posts N` là tối đa N bài mới cho cả thương hiệu, chia đều cho các nguồn; phần của nguồn ghi trong `stop_rule`, sau mỗi `ingest` xem `next_source_share`): đã lấy đủ phần → `--state limit`;
   - dừng giữa chừng vì lý do khác (hết thời gian, trang lỗi) → `--state partial --note "<lý do>"`.
   - Lượt `--backfill` không có `--state known` (bài đã có là chỗ phải cuộn qua, không phải chỗ dừng).
3. Với **mỗi bài** trong lúc cuộn (`[data-ad-rendering-role="story_message"]` là phần chữ của bài):
   - Lấy link bài (`https://www.facebook.com/<trang>/posts/<id>`, `/permalink/...`, hoặc `https://www.facebook.com/photo/?fbid=...`). Nếu link hoặc mã số trong link (fbid, story_fbid, `/posts/<id>`, `pfbid...`) có trong `known.json` (`brand_post_urls`, `brand_post_ids`): **bỏ qua, không mở, không tải**.
   - Bài mới: mở bài (hoặc ảnh → "Xem bài viết"), bấm "Xem thêm" để có **caption đầy đủ**; lưu nguyên văn (U+034F và ký tự ẩn để `ingest` lọc).
   - **Ngày đăng**: đọc nhãn thời gian của bài, ghi `posted_date` dạng `YYYY-MM-DD` (không rõ thì bỏ trống).
   - **Ảnh**: mỗi ảnh của bài, lấy URL `scontent` lớn nhất (mở ảnh ở chế độ xem lớn), tải bằng curl vào `<source>/raw/<n>-<k>.jpg`. Ưu tiên JPEG/PNG; WebP chỉ khi không có cách khác. Không chụp màn hình thay ảnh. Bài video: lấy ảnh bìa.
   - Ghi mọi link khác của cùng bài thấy được (link `photo/?fbid=...` của từng ảnh, permalink) vào `alt_urls`: Facebook hiện một bài dưới nhiều mã, `ingest` dùng các mã này để bỏ trùng.
   - Tên shop (`store`), loại sản phẩm (`main_product`), giá ghi công khai (`price_seen`): tuỳ chọn.
4. Ghi `<source>/raw.json` dạng `{ "page": { "name": "<tên trang>", "avatar": "raw/avatar.jpg" }, "posts": [...] }` (có thể ghi và `ingest` nhiều đợt; link đã ingest từ thư mục này được bỏ qua, không tính trùng):
   ```json
   { "page": { "name": "Tên trang", "avatar": "raw/avatar.jpg" }, "posts": [
     { "post_url": "https://www.facebook.com/shop/posts/1234567890",
       "alt_urls": ["https://www.facebook.com/photo/?fbid=1122334455"],
       "posted_date": "2026-10-28",
       "caption": "...",
       "images": ["raw/1-1.jpg", "raw/1-2.jpg"],
       "main_product": "đèn neon Happy Birthday để bàn", "price_seen": "600.000đ", "store": "Tên trang" }
   ] }
   ```
5. `node scripts/research.mjs ingest --brand <id> --source <sid>` rồi `node scripts/research.mjs result --brand <id> --source <sid> --state <...>`. Sang source tiếp theo.
6. Hết các source: `node scripts/research.mjs report --brand <id>` và báo người dùng.

### Backfill (crawl tay): lấy dần các bài cũ hơn
Lượt mặc định dừng sau 3 bài đã có, nên các bài **cũ hơn** những gì lần đầu đã crawl (lần đầu dùng `--max-posts` / `--since`, hoặc dừng giữa chừng) không bao giờ được lấy. `node scripts/research.mjs start --brand <id> --backfill [--source <sid>] [--since ..] [--max-posts N]` lấy chúng:
- `workspace/store/<brand>/progress.json`, mỗi nguồn: `newest_seen`, `oldest_seen` (`date`, `post_id`, `post_url`), `reached_end` (đã cuộn tới hết trang một lần), `last_run` (kiểu lượt `new|backfill|full`, cách dừng, `new_on_top`, `backfilled`). Nguồn có `reached_end: true` bị `--backfill` bỏ qua (`run.skipped`, không còn bài cũ hơn); nguồn có `oldest_seen` đã trước `--since` cũng bỏ qua.
- **Cuộn nhanh qua bài đã có** (từ đầu trang tới `oldest_seen`):
  - Không mở bài, không bấm "Xem thêm", không tải ảnh. Chỉ đọc link/mã của các bài đang hiện trên trang và đối chiếu với `known.json` (`post_urls`, `brand_post_urls`, `brand_post_ids`).
  - Đọc link bằng một lần `browser_evaluate` thay vì snapshot từng bài, vd `[...document.querySelectorAll('a[href*="/posts/"],a[href*="/permalink/"],a[href*="fbid="],a[href*="/videos/"]')].map(a => a.href)`; tìm `oldest_seen.post_id` hoặc `oldest_seen.post_url` trong danh sách đó.
  - Mỗi lần cuộn nhiều màn hình (phím End hoặc `window.scrollBy(0, 3 * innerHeight)`), nghỉ ở cận dưới `delay_seconds` (vd 3-6 giây; vẫn ngẫu nhiên, không cuộn liên tục). Checkpoint/captcha: dừng như mọi lượt.
  - Đã thấy `oldest_seen` trên trang (hoặc ngày đăng của bài đang hiện đã cũ hơn `oldest_seen.date`): về nhịp thường.
- **Từ sau `oldest_seen`**: làm như crawl thường (mục trên, bước 3-5): bài chưa có trong `known.json` thì mở, lấy caption/ngày/ảnh; bài đã có thì bỏ qua. Lấy tới **hết trang** (`--state end`, ghi `reached_end`), tới mốc `--since` (`--state since`) hoặc đủ `--max-posts` bài (`--state limit`).
- Không thấy được `oldest_seen` (bài đã bị xoá): dùng ngày, lấy từ bài đầu tiên cũ hơn `oldest_seen.date`.
- Báo cáo (`research.mjs report`) theo nguồn: `new_on_top` (bài mới ở đầu trang), `backfilled` (bài cũ hơn lấy thêm), `reached_end_text` (có/chưa) và `older_posts` (còn bài cũ chưa lấy không: chạy `--backfill`).

## Bỏ trùng (tool tự làm khi ingest)
Kho không bao giờ giữ một bài hai lần, trên mọi nguồn của thương hiệu:
- cùng link bài (bỏ `www.`/`m.`, tham số theo dõi) hoặc cùng mã bài Facebook (kể cả `alt_urls`);
- cùng ảnh: SHA-1 của file, hoặc ảnh gần giống (dHash 256 bit, khác ≤ `research.dedupe.image_distance`, mặc định 20 bit): shop khác đăng lại hay Facebook nén lại vẫn bị bắt. JPEG/PNG đọc được trên Windows (System.Drawing) và macOS (sips); WebP cần ffmpeg (`settings.ffmpeg.command`), không có thì chỉ so SHA-1 (JSON báo `images_without_phash`);
- cùng caption (chữ thường, bỏ ký tự ẩn, emoji, hashtag, link, số điện thoại, dấu câu) hoặc giống ≥ `research.dedupe.caption_similarity` (mặc định 90%), với caption đủ dài (≥ 40 ký tự sau chuẩn hoá).

Bài trùng ghi vào `duplicates.json` (khớp bài nào, luật nào); báo cáo ghi "x bài trùng bỏ qua" theo nguồn.

## Lấy gì, không lấy gì
- Lấy: ảnh bài, caption, ngày đăng, link bài, loại sản phẩm, giá công khai. Chỉ để học ý (loại sản phẩm, bối cảnh, góc chụp, khung bài).
- Không lấy: bình luận, tên/ảnh người bình luận, tin nhắn, thông tin cá nhân.
- Ảnh và caption đối thủ chỉ nằm trong `workspace/` (git bỏ qua), không bao giờ vào bài của thương hiệu (trừ scene-swap opt-in, đã xoá logo/tên shop).

## Bài học
- Facebook chèn U+034F và ký tự zero-width vào caption: luôn qua `ingest`, không dùng caption thô.
- Facebook hiện cùng một bài dưới nhiều mã (bài và từng ảnh): ghi `alt_urls`; `ingest` còn so ảnh và caption.
- Dựng lại cảnh từ ảnh đối thủ vẫn là sản phẩm của họ: bài thật dùng ảnh sản phẩm của thương hiệu.
- Timeline của một số trang (vd ít tương tác) chỉ tải 1-3 bài rồi đứng: tab ảnh bỏ sót reels và bài chữ, nên `crawl-fb.mjs` thử `/posts`, rồi gộp lưới `/photos_by` + `/reels`.
- Mở lại lượt cùng ngày từng ingest lại `raw.json` cũ và đếm thành bài trùng giả: `start` giờ chuyển dữ liệu cũ vào `archive/`, `ingest` bỏ qua link đã ingest.
