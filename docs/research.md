# Mode 1 "Research only": agent thu thập bằng Playwright MCP, rồi lọc

**Ai làm:** agent (Claude Code / Codex) lái Chrome **đã đăng nhập của người dùng** qua Playwright MCP, theo từng bước do `research.mjs next` chỉ. Không có script crawl tự chạy trên mọi nền tảng; `scripts/crawl-fb.mjs` chỉ còn là **đường nhanh tuỳ chọn cho trang tham khảo Facebook** (mục cuối). Lệnh và thứ tự: `RUNBOOK.md`, Mode 1. Kho của mỗi thương hiệu: `workspace/store/<brand>/` (`items.json`, `images/`, `progress.json`, `duplicates.json`, `rejected.json`); kho các thương hiệu không bao giờ trộn.

**Thứ tự (người dùng, 10/11/2026):**
1. **Trang tham khảo** của thương hiệu (`research.sources[]` trong `project/social.json` của skill): bài mới chưa có trong kho.
2. Hết trang tham khảo mà chưa đủ **mục tiêu** của lượt (`--max-posts N` = mục tiêu bài mới mỗi thương hiệu), hoặc không đặt mục tiêu: **tìm thêm (discovery)** theo `research.discovery.keywords` / `hashtags` (tiếng Anh, thị trường Mỹ) trên các nền tảng bật: Instagram, Pinterest, TikTok, Facebook (tìm bài + nhóm công khai), Reddit, Etsy, YouTube/Shorts, Houzz (chỉ thương hiệu nội thất/nhà). Xoay vòng các nền tảng (mỗi lần một truy vấn của nền tảng ít truy vấn nhất), tới khi đủ mục tiêu hoặc hết truy vấn. Mỗi nền tảng tối đa `max_per_platform` bài giữ mỗi lượt.
3. **Chỉ lấy bài có SẢN PHẨM đúng loại thương hiệu bán** (`research.discovery.product_fit`): `types` (loại sản phẩm, theo project.md mục 5), `must_have`, `must_not`. Bài sai loại bị bỏ **ngay lúc lấy** (không tải ảnh, không lưu; chỉ ghi vào `rejected[]` của raw.json) và lần nữa ở bước lọc. DreamyVows: bảng LED neon theo yêu cầu (chữ, câu, tên, logo, cưới, sự kiện, bar), bảng neon phải có trong ảnh và là chủ thể. GRENHEIM: đồ gỗ tự nhiên (bàn ăn, bàn trà, console live-edge...), không kim loại/nhựa/MDF.

## Vòng lặp của agent
```
node scripts/research.mjs browser --brand <id> --state ok        # 1.0 Playwright MCP đã nối Chrome của người dùng (fail → --state fail --note, dừng)
node scripts/research.mjs start --brand <id> [OPTIONS]            # 1.1 mở lượt: trang tham khảo + hàng đợi truy vấn discovery
node scripts/store.mjs known --brand <id>                         # một lần: brand_post_urls / brand_post_ids (bài đã có: không mở, không tải)
lặp:
  node scripts/research.mjs next --brand <id>                     # việc tiếp theo: step reference | discovery | done
  → lấy đúng nguồn/truy vấn đó (mục theo nền tảng bên dưới), ghi <dir>/raw.json + ảnh vào <downloads>
  → node scripts/research.mjs ingest --brand <id> --source <sid>  |  --query <qid>
  → node scripts/research.mjs result --brand <id> --source <sid> --state end|known|since|limit|blocked|partial
                                                                  |  --query <qid> --state done|limit|empty|blocked|partial [--note ..]
tới khi next trả "done" → 1.3 lọc (store.mjs classify / verdict) → 1.4 report
```
- `next` (reference): `url`, `stop_rule`, `known_file`, `share` (phần của trang trong mục tiêu), `raw_file`, `downloads`.
- `next` (discovery): `platform`, `kind` (keyword/hashtag), `term`, `found_by`, `url` (trang tìm kiếm/hashtag mở sẵn), `share` (tối đa bài mới cho truy vấn này), `platform_notes`, `product_fit`, `raw_file`, `downloads`.
- Mục tiêu đã đủ khi còn trang tham khảo chưa làm: `next` trả `skip: true` kèm lệnh `result --state skipped`.
- `result --query ... --state`: `done` (đã xem hết kết quả hợp trong vài màn hình), `limit` (đủ `share`), `empty` (không có bài hợp), `blocked` (tường đăng nhập/captcha/checkpoint: các truy vấn còn lại của **nền tảng đó** bị bỏ trong lượt này, nền tảng khác vẫn tiếp), `partial` (dừng giữa chừng, cần `--note`).

## Luật chung trên mọi nền tảng
- **Chỉ xem:** mở trang, cuộn, mở bài, đọc. **Không bao giờ** like, thả tim, lưu/save/pin, theo dõi, bình luận, nhắn tin, chia sẻ, tham gia nhóm, đăng hay tải lên gì. Không đăng nhập hộ, không nhập mật khẩu, không lưu cookie. Không đụng Chrome cổng 9222 (Chrome riêng của `crawl-fb.mjs`).
- **Nhịp lịch sự:** nghỉ **ngẫu nhiên 5-15 giây** giữa mọi lần mở trang, cuộn, bấm (`browser_wait_for` với thời gian ngẫu nhiên). Cuộn mỗi lần khoảng một màn hình (`browser_press_key` PageDown hoặc `browser_evaluate` `window.scrollBy(0, innerHeight)`). Một truy vấn: tối đa khoảng 8-10 lần cuộn; hết bài mới hoặc kết quả lạc đề thì dừng truy vấn (`done`).
- **Dừng ngay** khi gặp tường đăng nhập, captcha, "checkpoint", "unusual activity", "try again later", trang trống bất thường: `result --state blocked --note "<thấy gì>"`, không thử lại nền tảng đó trong lượt.
- **Đọc gọn:** dùng `browser_evaluate` đọc nhiều ô một lần (link, ảnh, chữ) thay vì snapshot từng bài; snapshot/screenshot chỉ để nhìn sản phẩm khi cần phán đoán.
- **Bỏ bài đã có:** link hoặc mã bài nằm trong `brand_post_urls` / `brand_post_ids` (lệnh `store.mjs known`) thì bỏ qua, không mở, không tải.
- **Kiểm sản phẩm TRƯỚC khi tải** (nhìn ảnh): đúng một loại trong `product_fit.types`, đạt `must_have`, không dính `must_not`. Không đạt → ghi `{ post_url, author, reason }` vào `rejected[]`, không tải. Đạt → ghi `product_fit: { "type": "<đúng một chuỗi trong types>", "reason": "<thấy gì>" }`. `ingest` từ chối bài không có `product_fit.type` hợp lệ (ghi `rejected.json`).
- **Mỗi bài cần:** `post_url` (permalink của bài/pin/video/listing, không phải link trang tìm kiếm), `alt_urls` (link khác của cùng bài nếu thấy), `images` (file đã tải, ảnh lớn nhất), `caption` (đầy đủ, nguyên văn), `author` (tên tài khoản/trang/shop), `posted_date` (`YYYY-MM-DD` nếu thấy, không thì trống), `likes` (số nếu hiện, không thì bỏ), `product_fit`.
- **Tải ảnh:** lấy URL ảnh lớn nhất (`img.currentSrc`, phần tử lớn nhất của `srcset`, ảnh ở chế độ xem lớn), tải bằng `curl -L -A "Mozilla/5.0" -e <post_url> -o <downloads>/<n>-<k>.jpg "<url>"`. JPEG/PNG/WebP thật (ingest kiểm chữ ký file). curl bị 403: trong trang chạy `browser_evaluate` `fetch(url).then(r => r.arrayBuffer())` đổi sang base64 rồi ghi file bằng `node -e`. Video/Shorts/TikTok: ảnh bìa hoặc khung hình rõ sản phẩm (ảnh `poster`/thumbnail). Không chụp màn hình thay ảnh.
- **raw.json** (một file mỗi nguồn/truy vấn, ghi đè được, ingest nhiều đợt không đếm trùng):
  ```json
  { "query": { "id": "instagram-h-customneonsign", "platform": "instagram" }, "platform": "instagram",
    "posts": [
      { "post_url": "https://www.instagram.com/p/AbC123/", "alt_urls": [], "author": "@studio.events",
        "caption": "...", "posted_date": "2026-10-28", "likes": 312, "images": ["raw/1-1.jpg"],
        "product_fit": { "type": "wedding neon sign", "reason": "Better Together sign behind the sweetheart table, clearly the subject" } } ],
    "rejected": [ { "post_url": "https://www.instagram.com/p/XyZ789/", "author": "@x", "reason": "LED strip lights, no sign" } ] }
  ```
  Trang tham khảo dùng `{ "page": { "name", "avatar" }, "posts": [...], "rejected": [...] }` như cũ (thêm `platform`, `author`, `product_fit` khi agent lấy).

## Theo nền tảng
`next` đã đưa sẵn `url`; dưới đây là cách đọc trên từng trang. Selector có thể đổi: không đọc được thì nhìn snapshot và điều chỉnh, không đoán dữ liệu.

### instagram
- Mở: hashtag `instagram.com/explore/tags/<tag>/`, từ khoá `instagram.com/explore/search/keyword/?q=<kw>`. Lưới ô vuông; mỗi ô là `a[href*="/p/"]` hoặc `a[href*="/reel/"]`.
- Đọc lưới một lần: `[...document.querySelectorAll('a[href*="/p/"],a[href*="/reel/"]')].map(a => ({ href: a.href, img: a.querySelector('img')?.currentSrc, alt: a.querySelector('img')?.alt }))` (`alt` thường có mô tả + caption ngắn: lọc nhanh sản phẩm).
- Bài có vẻ hợp: mở link (cùng tab, xong `browser_navigate_back`), đọc caption (`h1` hoặc khối chữ đầu), tên tài khoản (link hồ sơ đầu tiên), ngày (`time[datetime]`), lượt thích nếu hiện; ảnh: `img` lớn nhất trong `article` (album: bấm "Next" từng ảnh, tối đa 4). `/reel/` và `/p/` cùng mã là một bài.
- Dừng: hộp "Log in to continue"/"Sign up" che trang, "Try again later" → blocked.

### pinterest
- Mở: `pinterest.com/search/pins/?q=<kw>` (hashtag: `q=%23tag`). Lưới pin `a[href*="/pin/"]`.
- Đọc lưới: link pin + `img.currentSrc` (thay `/236x/` bằng `/736x/` hoặc `/originals/` cho ảnh lớn) + `alt`.
- Mở pin khi cần: tiêu đề, mô tả, nguồn (link ra web/shop: ghi vào `alt_urls` nếu là bài mạng xã hội), tên người đăng. Nhiều pin là mockup của shop: chỉ giữ ảnh thật hoặc ảnh sản phẩm sạch; ảnh chữ mẫu ("Your Names") vẫn được lấy làm ý nhưng không scene-swap.
- Dừng: popup đăng nhập không đóng được → blocked.

### tiktok
- Mở: tag `tiktok.com/tag/<tag>`, tìm `tiktok.com/search?q=<kw>`. Ô video `a[href*="/video/"]` (hoặc `/photo/`).
- Đọc: link, ảnh bìa (`img` trong ô; `poster`), mô tả ngắn, tác giả (`/@handle` trong link), lượt xem/thích nếu hiện. Chỉ giữ video mà ảnh bìa/khung hình thấy rõ sản phẩm; không tải video.
- Dừng: captcha kéo trượt (puzzle), "Log in to TikTok" chặn trang → blocked.

### facebook
- Mở: tìm bài `facebook.com/search/posts/?q=<kw>`, hashtag `facebook.com/hashtag/<tag>`. Nhóm công khai: `facebook.com/search/groups/?q=<kw>` → mở nhóm **công khai** đã thấy bài, đọc tab bài viết; **không bao giờ** bấm Tham gia/Join, không trả lời câu hỏi nhóm.
- Đọc như trang tham khảo (mục "Trang tham khảo" bên dưới): permalink `/posts/`, `/permalink/`, `story_fbid`, `photo/?fbid=` (mọi link của cùng bài vào `alt_urls`), "Xem thêm"/"See more" chỉ trong chữ bài, ảnh `scontent` lớn nhất. Không lấy bình luận.
- Dừng: checkpoint, "Bạn tạm thời bị chặn", form đăng nhập → blocked.

### reddit
- Mở: `reddit.com/search/?q=<kw>&type=posts`. Kết quả `a[href*="/comments/"]`.
- Mở bài có ảnh: tiêu đề + chữ bài (caption), subreddit + tác giả (`u/...`, ghi `author`), điểm upvote (`likes`), ảnh `i.redd.it` / `preview.redd.it` (bỏ tham số để lấy ảnh gốc; gallery: tối đa 4). Ảnh khách tự chụp rất tốt để học bối cảnh thật. Bỏ bài chỉ có chữ.
- Dừng: "You've been blocked by network security", trang xác minh → blocked.

### etsy
- Mở: `etsy.com/search?q=<kw>`. Listing `a[href*="/listing/"]`.
- Đọc: tiêu đề listing (caption), tên shop (`author`), ảnh listing lớn (`il_fullxfull` thay `il_340x270`), số sao/đánh giá nếu hiện (`likes` bỏ trống). Ảnh sản phẩm của đối thủ **cùng loại sản phẩm**: ứng viên scene-swap (khi thương hiệu bật `reference_redraw`), vẫn phải xoá logo/chữ shop. Bỏ quảng cáo "Ad by" nếu lạc loại.
- Dừng: captcha "We need to make sure you're not a robot" → blocked.

### youtube
- Mở: hashtag `youtube.com/hashtag/<tag>/shorts`, tìm `youtube.com/results?search_query=<kw>` (bộ lọc Shorts). Ưu tiên Shorts.
- Đọc: link (`/shorts/<id>` = `watch?v=<id>`: một bài), tiêu đề, kênh (`author`), lượt xem nếu hiện, ảnh thumbnail lớn `https://i.ytimg.com/vi/<id>/hqdefault.jpg` (hoặc `maxresdefault.jpg`). Chỉ giữ khi thumbnail/khung hình thấy rõ sản phẩm thành phẩm (không phải quá trình làm).
- Dừng: "Sign in to confirm you're not a bot" → blocked.

### houzz
- Chỉ thương hiệu nội thất/nhà (GRENHEIM). Mở: `houzz.com/photos/query/<kw-gạch-nối>`. Ảnh phòng thật ở Mỹ.
- Đọc: link ảnh (trang `.../phvw-vp~<id>`), tiêu đề/mô tả, tên nhà thiết kế (`author`), ảnh lớn (`img` lớn nhất, thay cỡ trong URL bằng bản lớn). Chỉ giữ khi món đồ gỗ đúng loại là chủ thể của ảnh, không phải chi tiết nhỏ trong phòng.
- Dừng: trang xác minh/captcha → blocked.

## Bản quyền
Bài tìm thêm (discovery) chỉ để **học ý** (bối cảnh, góc chụp, khung caption, cách đặt sản phẩm); ảnh và chữ đối thủ chỉ nằm trong `workspace/` (git bỏ qua), không bao giờ vào bài của thương hiệu. Scene-swap chỉ từ ảnh sản phẩm của đối thủ **cùng loại sản phẩm** thương hiệu làm được (`reference_redraw` bật, `--brand-can-produce`, xoá logo/tên shop, `confirm-clean`); ảnh người dùng thường (Reddit, Instagram cá nhân) không bao giờ scene-swap.

## Lọc sau khi lấy (`store.mjs classify` / `verdict`)
- `classify --brand <id> [--limit 40] [--source <sid>]`: lô bài `new` chưa lọc (id, nguồn, `platform`, `found_by`, `author`, `product_fit` đã ghi lúc lấy, đoạn đầu caption hoặc `(no caption)`, media, đường dẫn thumb), `what_to_take` từng trang tham khảo, `product_fit` của skill (`types`, `must_have`, `must_not`), đường dẫn `project.md` (phạm vi sản phẩm), `rules_of_thumb`, `remaining_after`.
- Agent quyết cả lô trong một lượt (đọc chữ + xem ảnh thumb, **không mở trình duyệt**), ghi `[{ "id", "fit": true|false, "reason" }]`, chạy `verdict --brand <id> --file <file>`. `fit:false` → Removed, ghi chú `filter: <lý do>` (sản phẩm sai loại: lý do bắt đầu bằng `off-brand:`); `fit:true` → giữ. Bài đã rejected bị bỏ qua (`skipped`).
- Luật nhanh: bỏ **sản phẩm không thuộc `product_fit.types`** hoặc dính `must_not` (lần kiểm thứ hai, kể cả bài crawl-fb lấy không có `product_fit`); bỏ **tuyển dụng**; bỏ **cuộc thi / minigame / giveaway**; bỏ **chỉ có chữ** (hoặc ảnh chỉ là chữ, banner khuyến mãi không thấy sản phẩm); bỏ **chia sẻ lại không có ảnh sản phẩm**. Không chắc → giữ (người dùng còn Remove ở app).
- Báo cáo/nhật ký: mỗi trang tham khảo `kept` / `filtered`; trang có ≥ 5 bài đã lọc mà giữ < 30% bị gắn cờ keep rate thấp (xem lại `what_to_take` hoặc thay nguồn). Discovery: mỗi nền tảng và mỗi truy vấn `kept` / `off-brand` (bỏ lúc lấy) / `duplicates`.

## Trang tham khảo (agent, Playwright MCP)
Bước 1 của mọi lượt. `next` trả `step: reference` với `url`, `stop_rule`, `known_file` (`known.json`: `post_urls`, `brand_post_urls`, `brand_post_ids`, `newest_seen`, `oldest_seen`), `share`. Nghỉ ngẫu nhiên 5-15 giây giữa **mọi** lần mở trang, cuộn, bấm. Gặp checkpoint/captcha: `research.mjs result --source <sid> --state blocked --note "<lý do>"`, không mở trang tham khảo Facebook nào nữa trong lượt (trang còn lại `--state skipped`); discovery trên nền tảng khác vẫn theo `next`.

### Lấy một trang tham khảo
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
   - **Sản phẩm đúng loại** (mục "Luật chung"): ghi `product_fit` { type, reason }; bài sai loại không tải, chỉ ghi vào `rejected[]`.
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
5. `node scripts/research.mjs ingest --brand <id> --source <sid>` rồi `node scripts/research.mjs result --brand <id> --source <sid> --state <...>`.
6. Chạy lại `node scripts/research.mjs next --brand <id>`: trang tham khảo kế tiếp, rồi các truy vấn discovery.

### Backfill: lấy dần các bài cũ hơn của trang tham khảo
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



## Đường nhanh tuỳ chọn cho trang tham khảo Facebook: `crawl-fb.mjs`
Tuỳ chọn, chỉ cho trang tham khảo **Facebook** (bỏ qua mọi trang khác và mọi truy vấn discovery). Cần Chrome crawl riêng có cổng 9222 (RUNBOOK "Chrome cho crawl"; agent không bao giờ tự mở/đụng Chrome đó). `node scripts/crawl-fb.mjs --check` rồi `node scripts/crawl-fb.mjs --brand <id>` thay cho việc agent lấy từng trang Facebook; xong thì quay lại `research.mjs next` (discovery).
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
- **Selector hỏng**: 3 bước liền đọc được 0 bài trong khi trang có phần chữ bài/link bài → `partial` với note `error: selectors ...`. Mọi selector nằm trong `scripts/fb-extract.mjs` (`SELECTORS`, mỗi mục là danh sách dự phòng); sửa ở đó, chạy `npm test` (fixture `tests/fixtures/fb-*.html`), hoặc để agent lấy trang đó (mục "Trang tham khảo").
- **Không bao giờ** like, bình luận, theo dõi, chia sẻ, nhắn tin; thao tác duy nhất ngoài cuộn là "Xem thêm" trong chữ của bài.

## Bỏ trùng (tool tự làm khi ingest)
Kho không bao giờ giữ một bài hai lần, trên mọi nguồn **và mọi nền tảng** của thương hiệu:
- cùng link bài (bỏ `www.`/`m.`, tham số theo dõi) hoặc cùng mã bài (kể cả `alt_urls`): mã Facebook; Instagram `/p/` = `/reel/`; YouTube `watch?v=` = `/shorts/` = `youtu.be`; mã pin Pinterest, video TikTok, bài Reddit, listing Etsy, ảnh Houzz;
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
- Agent lái Chrome đã đăng nhập của người dùng (Playwright MCP) đọc được mọi nền tảng; script crawl riêng cho từng trang dễ hỏng khi giao diện đổi, nên chỉ giữ `crawl-fb.mjs` làm đường nhanh cho trang Facebook.
- Tìm theo từ khoá ra nhiều sản phẩm lạc loại (đèn LED dây, đồ kim loại...): kiểm `product_fit` trước khi tải, không lưu bài sai loại.
