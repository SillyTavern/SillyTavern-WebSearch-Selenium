import { Builder, Browser, By, until, WebDriver } from 'selenium-webdriver';
import { Options as ChromeOptions } from 'selenium-webdriver/chrome.js';
import { Options as FirefoxOptions } from 'selenium-webdriver/firefox.js';
import { Options as EdgeOptions } from 'selenium-webdriver/edge.js';
import bodyParser from 'body-parser';
import { Router } from 'express';
import { Chalk } from 'chalk';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

interface SearchResult {
    results: string;
    links: string[];
    images: string[];
}

interface PluginInfo {
    id: string;
    name: string;
    description: string;
}

interface Plugin {
    init: (router: Router) => Promise<void>;
    exit: () => Promise<void>;
    info: PluginInfo;
}

const chalk = new Chalk();
const MODULE_NAME = '[SillyTavern-WebSearch-Selenium]';

class DriverConfig {
    get TIMEOUT(): number {
        // 5 minutes
        if (this.isDebug() && !this.isHeadless()) {
            return 60000 * 5;
        }

        // 5 seconds
        return 5000;
    }

    MAX_IMAGES = 10;

    private getBrowserName(): string {
        const env = process.env.ST_SELENIUM_BROWSER;
        if (env && Object.values(Browser).includes(env)) {
            return env;
        }

        return Browser.CHROME;
    }

    private isHeadless(): boolean {
        return (process.env.ST_SELENIUM_HEADLESS ?? 'true') === 'true';
    }

    private isDebug(): boolean {
        return (process.env.ST_SELENIUM_DEBUG ?? 'false') === 'true';
    }

    private getChromeOptions(): ChromeOptions {
        const chromeOptions = new ChromeOptions();
        if (this.isHeadless()) {
            chromeOptions.addArguments('--headless');
        }
        chromeOptions.addArguments('--disable-infobars');
        chromeOptions.addArguments('--disable-gpu');
        chromeOptions.addArguments('--no-sandbox');
        chromeOptions.addArguments('--disable-dev-shm-usage');
        chromeOptions.addArguments('--lang=en-GB');
        return chromeOptions;
    }

    private getFirefoxOptions(): FirefoxOptions {
        const firefoxOptions = new FirefoxOptions();
        if (this.isHeadless()) {
            firefoxOptions.addArguments('--headless');
        }
        firefoxOptions.setPreference('intl.accept_languages', 'en,en_US');
        return firefoxOptions;
    }

    private getEdgeOptions(): EdgeOptions {
        const edgeOptions = new EdgeOptions();
        if (this.isHeadless()) {
            edgeOptions.addArguments('--headless');
        }
        return edgeOptions;
    }

    async getDriver(): Promise<WebDriver> {
        const browserName = this.getBrowserName();
        console.log(chalk.green(MODULE_NAME), 'Using browser:', browserName);
        console.log(chalk.green(MODULE_NAME), 'Headless:', this.isHeadless());
        console.log(chalk.green(MODULE_NAME), 'Debug:', this.isDebug());
        const driver = await new Builder()
            .forBrowser(browserName)
            .setChromeOptions(this.getChromeOptions())
            .setFirefoxOptions(this.getFirefoxOptions())
            .setEdgeOptions(this.getEdgeOptions())
            .build();
        return driver;
    }

    async saveDebugPage(driver: WebDriver): Promise<void> {
        if (!this.isDebug()) {
            return;
        }

        try {
            const tempPath = path.join(os.tmpdir(), `WebSearch-debug-${Date.now()}.html`);
            const pageSource = await driver.getPageSource();
            await fs.promises.writeFile(tempPath, pageSource, 'utf-8');
            console.log(chalk.green(MODULE_NAME), 'Saving debug page to', tempPath);
        } catch (error) {
            console.error(chalk.red(MODULE_NAME), 'Failed to save debug page', error);
        }
    }

    async getPageHeight(driver: WebDriver): Promise<number> {
        return parseInt(await driver.executeScript('return document.body.scrollHeight'));
    }

    async waitForPageHeightIncrease(driver: WebDriver, previousPageHeight: number): Promise<number> {
        for (let i = 0; i < 5; i++) {
            const pageHeight = await this.getPageHeight(driver);
            await driver.sleep(1000);
            if (pageHeight > previousPageHeight) {
                return pageHeight;
            }
        }
        return previousPageHeight;
    }
}

async function getTextBySelector(driver: WebDriver, selector: string): Promise<string> {
    const elements = await driver.findElements(By.css(selector));
    const texts = await Promise.all(elements.map(el => el.getText()));
    return texts.filter(x => x).join('\n');
}

async function findFirstAndClick(driver: WebDriver, by: By): Promise<void> {
    const elements = await driver.findElements(by);
    if (elements.length > 0) {
        const element = await driver.findElement(by);
        await driver.wait(until.elementIsVisible(element), 1000);
        await driver.wait(until.elementIsEnabled(element), 1000);
        await element.click();
    }
}

async function performGoogleSearch(query: string, includeImages: boolean, maxLinks: number = 10): Promise<SearchResult> {
    const config = new DriverConfig();
    const driver = await config.getDriver();
    try {
        console.log(chalk.green(MODULE_NAME), 'Searching Google for:', query);
        await driver.get(`https://google.com/search?hl=en&q=${encodeURIComponent(query)}&num=${maxLinks}`);
        await config.saveDebugPage(driver);

        // Wait for the main content
        await driver.wait(until.elementLocated(By.id('res')), config.TIMEOUT);

        // Accept cookies
        await findFirstAndClick(driver, By.id('L2AGLb'));

        // Get text from different sections
        const text = [
            await getTextBySelector(driver, '.wDYxhc'), // Answer box
            await getTextBySelector(driver, '.hgKElc'), // Knowledge panel
            await getTextBySelector(driver, '.r025kc.lVm3ye'), // Page snippets
            await getTextBySelector(driver, '.yDYNvb.lyLwlc'), // Old selectors (for compatibility)
        ].join('\n');

        // Get links from the results
        const links = await driver.findElements(By.css('.yuRUbf a'));
        const linksText = await Promise.all(links.map(el => el.getAttribute('href')));

        // Get images
        const images: string[] = [];

        if (includeImages) {
            await driver.get(`https://google.com/search?hl=en&q=${encodeURIComponent(query)}&tbm=isch`);
            await config.saveDebugPage(driver);

            // Wait for the images content
            await driver.wait(until.elementLocated(By.css('#search .ob5Hkd img')), config.TIMEOUT);

            const imageTiles = await driver.findElements(By.css('.ob5Hkd img'));
            const numberOfImages = Math.min(imageTiles.length, config.MAX_IMAGES);

            for (let i = 0; i < numberOfImages; i++) {
                const src = await imageTiles[i].getAttribute('src');
                images.push(src);
            }
        }

        console.log(chalk.green(MODULE_NAME), 'Found:', { text, linksText, images });
        return { results: text, links: linksText, images };
    } finally {
        await driver.quit();
    }
}

async function performDuckDuckGoSearch(query: string, includeImages: boolean, maxLinks: number = 10): Promise<SearchResult> {
    const config = new DriverConfig();
    const driver = await config.getDriver();
    try {
        console.log(chalk.green(MODULE_NAME), 'Searching DuckDuckGo for:', query);
        await driver.get(`https://duckduckgo.com/?kl=wt-wt&kp=-2&kav=1&kf=-1&kac=-1&kbh=-1&ko=-1&k1=-1&kv=n&kz=-1&kat=-1&kbg=-1&kbe=0&kpsb=-1&q=${encodeURIComponent(query)}`);
        await config.saveDebugPage(driver);

        // Wait for the main content
        await driver.wait(until.elementLocated(By.id('web_content_wrapper')), config.TIMEOUT);

        // Get links from the results
        let links = await driver.findElements(By.css('[data-testid="result-title-a"]'));
        let currentPageHeight = await config.getPageHeight(driver);
        if (links.length < maxLinks) {
            // Scroll down to load more results
            for (let i = 0; i < 5; i++) {
                await driver.executeScript('window.scrollTo(0, document.body.scrollHeight)');
                currentPageHeight = await config.waitForPageHeightIncrease(driver, currentPageHeight);
                links = await driver.findElements(By.css('[data-testid="result-title-a"]'));
                if (maxLinks >= links.length) {
                    break;
                }
            }
        }
        const linksText = await Promise.all(links.map(el => el.getAttribute('href')));

        // Get text from the snippets
        const text = await getTextBySelector(driver, '[data-result="snippet"]');

        // Get images
        const images: string[] = [];

        if (includeImages) {
            await driver.get(`https://duckduckgo.com/?kp=-2&kl=wt-wt&q=${encodeURIComponent(query)}&iax=images&ia=images`);
            await config.saveDebugPage(driver);

            // Wait for the images content
            await driver.wait(until.elementLocated(By.css('#zci-images img.tile--img__img')), config.TIMEOUT);

            const imageTiles = await driver.findElements(By.css('img.tile--img__img'));

            for (let i = 0; i < Math.min(imageTiles.length, config.MAX_IMAGES); i++) {
                const src = await imageTiles[i].getAttribute('src');
                images.push(src);
            }
        }

        console.log(chalk.green(MODULE_NAME), 'Found:', { text, linksText, images });
        return { results: text, links: linksText, images };
    } finally {
        await driver.quit();
    }
}

/**
 * Initialize the plugin.
 * @param router Express Router
 */
export async function init(router: Router): Promise<void> {
    const jsonParser = bodyParser.json();
    router.post('/probe', (_req, res) => {
        return res.sendStatus(204);
    });
    router.post('/search', jsonParser, async (req, res) => {
        try {
            switch (req.body.engine) {
                case 'google': {
                    const result = await performGoogleSearch(req.body.query, req.body.include_images, req.body.max_links);
                    return res.send(result);
                }
                case 'duckduckgo': {
                    const result = await performDuckDuckGoSearch(req.body.query, req.body.include_images, req.body.max_links);
                    return res.send(result);
                }
                default:
                    return res.status(400).send('Invalid engine');
            }
        } catch (error) {
            console.error(chalk.red(MODULE_NAME), 'Search failed', error);
            return res.status(500).send('Internal Server Error');
        }
    });

    console.log(chalk.green(MODULE_NAME), 'Plugin loaded!');
}

export async function exit(): Promise<void> {
    console.log(chalk.yellow(MODULE_NAME), 'Plugin exited');
}

export const info: PluginInfo = {
    id: 'selenium',
    name: 'WebSearch Selenium',
    description: 'Search the web using Selenium. Requires a WebSearch UI extension.',
};

const plugin: Plugin = {
    init,
    exit,
    info,
};

export default plugin;
