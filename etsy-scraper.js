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
const SEARCH_URL = `https://www.etsy.com/search?q=${encodeURIComponent(KEYWORD)}`;

async function runTest() {
    for (let i = 0; i < PROXIES.length; i++) {
        const proxy = PROXIES[i];
        const [ip, port, username, password] = proxy.split(':');
        const proxyServer = `${ip}:${port}`;

        console.log(`\n🚀 Thử quét Etsy với Proxy: ${proxyServer}`);
        
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    `--proxy-server=http://${proxyServer}`,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled'
                ]
            });

            const page = await browser.newPage();
            await page.authenticate({ username, password });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            console.log(`🔍 Đang truy cập: ${SEARCH_URL}`);
            const response = await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
            
            if (response && response.status() === 403) {
                console.log("⚠️ Bị Etsy chặn (Lỗi 403 Forbidden). Sẽ đổi sang Proxy tiếp theo...");
                await browser.close();
                continue;
            }

            console.log("⏳ Đang bóc tách dữ liệu thẻ HTML...");
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Etsy sử dụng PerimeterX Captcha
            const isCaptcha = await page.$('#px-captcha');
            if (isCaptcha) {
                 console.log("⚠️ Etsy hiện Captcha (PerimeterX). Sẽ tự động đổi Proxy tiếp theo...");
                 await browser.close();
                 continue;
            }

            const products = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('div[data-search-results] li'));
                const results = [];
                
                items.forEach(item => {
                    const linkEl = item.querySelector('a.listing-link');
                    const titleEl = item.querySelector('h3');
                    const priceEl = item.querySelector('.currency-value');
                    const reviewCountEl = item.querySelector('.v2-listing-card__shop-rating span.wt-text-caption');
                    
                    if (linkEl && titleEl) {
                        const title = titleEl.innerText.trim();
                        const link = linkEl.getAttribute('href');
                        const price = priceEl ? `$${priceEl.innerText.trim()}` : "Không có giá";
                        const reviewCount = reviewCountEl ? reviewCountEl.innerText.trim() : "0 đánh giá";
                        
                        // Lọc các thẻ rỗng (không phải sản phẩm thực)
                        if (title.length > 5) {
                            results.push({ title, price, reviewCount, link });
                        }
                    }
                });
                
                return results;
            });

            console.log(`\n✅ ĐÃ TÌM THẤY ${products.length} SẢN PHẨM TRÊN ETSY:`);
            products.slice(0, 10).forEach((p, index) => {
                console.log(`\n[${index+1}] Tên: ${p.title.substring(0, 80)}...`);
                console.log(`    💰 Giá: ${p.price}`);
                console.log(`    ⭐ Đánh giá cửa hàng: ${p.reviewCount}`);
                console.log(`    🔗 Link: ${p.link.split('?')[0]}`); // Bỏ param dư thừa để link gọn hơn
            });

            await browser.close();
            return;
        } catch (error) {
            console.error(`❌ Lỗi với Proxy ${proxyServer}: ${error.message}`);
            if (browser) await browser.close();
        }
    }
    
    console.log("🛑 Tất cả các Proxy đều đã bị Etsy chặn. Hãy chờ một lát rồi thử lại.");
}

runTest();
