const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const PROXIES = [
    "51.81.76.67:50552:pxdpwv1c9h:dPWV1c9h",
    "51.81.219.188:55541:pxfbvz9d1m:fBVZ9d1M",
    "51.81.179.179:64105:pxfdxl2n8t:fDXL2n8t",
    "185.149.232.124:30862:pxmqpx2i8r:mQpX2i8r",
    "15.204.2.33:47145:pxzmiq8c5c:zMIQ8c5c"
];

const KEYWORD = 'Comfort Colors shirt';
const SEARCH_URL = `https://www.amazon.com/s?k=${encodeURIComponent(KEYWORD)}`;

async function runTest() {
    // Loop qua các Proxy để đề phòng bị Amazon chặn
    for (let i = 0; i < PROXIES.length; i++) {
        const proxy = PROXIES[i];
        const [ip, port, username, password] = proxy.split(':');
        const proxyServer = `${ip}:${port}`;

        console.log(`\n🚀 Thử quét Amazon với Proxy: ${proxyServer}`);
        
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true, // Chạy ngầm
                args: [
                    `--proxy-server=http://${proxyServer}`,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled'
                ]
            });

            const page = await browser.newPage();
            // Xác thực proxy
            await page.authenticate({ username, password });

            // Fake User-Agent để giống người dùng thật hơn
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            console.log(`🔍 Đang truy cập: ${SEARCH_URL}`);
            const response = await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
            
            if (response && response.status() === 503) {
                console.log("⚠️ Bị Amazon chặn (Lỗi 503 / Captcha). Sẽ tự động đổi sang Proxy tiếp theo...");
                await browser.close();
                continue; // Chạy vòng lặp với proxy tiếp theo
            }

            console.log("⏳ Đang bóc tách dữ liệu thẻ HTML...");
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Kiểm tra rõ xem có bị dính Captcha hình con chó không
            const isCaptcha = await page.$('form[action="/errors/validateCaptcha"]');
            if (isCaptcha) {
                 console.log("⚠️ Amazon hiện Captcha (Hình con chó). Sẽ tự động đổi Proxy tiếp theo...");
                 await browser.close();
                 continue;
            }

            const products = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('div[data-component-type="s-search-result"]'));
                const results = [];
                
                items.forEach(item => {
                    const titleEl = item.querySelector('h2 a span');
                    const linkEl = item.querySelector('h2 a');
                    const priceWholeEl = item.querySelector('.a-price-whole');
                    const priceFractionEl = item.querySelector('.a-price-fraction');
                    const reviewEl = item.querySelector('span[aria-label*="out of 5 stars"]');
                    const reviewCountEl = item.querySelector('span[aria-label*="out of 5 stars"] + span[aria-label]');
                    
                    if (titleEl && linkEl) {
                        const title = titleEl.innerText.trim();
                        const link = "https://www.amazon.com" + linkEl.getAttribute('href');
                        
                        let price = "Không có giá";
                        if (priceWholeEl && priceFractionEl) {
                            price = `$${priceWholeEl.innerText.replace('.', '')}.${priceFractionEl.innerText}`;
                        } else if (priceWholeEl) {
                            price = `$${priceWholeEl.innerText.replace('.', '')}`;
                        }
                        
                        const rating = reviewEl ? reviewEl.getAttribute('aria-label') : "Chưa có đánh giá";
                        const reviewCount = reviewCountEl ? reviewCountEl.getAttribute('aria-label') : "0 đánh giá";
                        
                        results.push({ title, price, rating, reviewCount, link });
                    }
                });
                
                return results;
            });

            console.log(`\n✅ ĐÃ TÌM THẤY ${products.length} SẢN PHẨM TRÊN AMAZON:`);
            products.slice(0, 10).forEach((p, index) => {
                console.log(`\n[${index+1}] Tên: ${p.title.substring(0, 80)}...`);
                console.log(`    💰 Giá: ${p.price}`);
                console.log(`    ⭐ Đánh giá: ${p.rating} (${p.reviewCount})`);
                console.log(`    🔗 Link: ${p.link}`);
            });

            await browser.close();
            return; // Nếu cào thành công thì thoát ngay lập tức, không dùng các Proxy thừa nữa
        } catch (error) {
            console.error(`❌ Lỗi với Proxy ${proxyServer}: ${error.message}`);
            if (browser) await browser.close();
        }
    }
    
    console.log("🛑 Tất cả các Proxy đều đã bị Amazon chặn. Hãy chờ một lát rồi thử lại.");
}

runTest();
