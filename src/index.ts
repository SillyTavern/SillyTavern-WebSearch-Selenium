import { Builder, Browser, By, until, WebDriver } from 'selenium-webdriver';
import { Options as ChromeOptions } from 'selenium-webdriver/chrome.js';
import { Options as FirefoxOptions } from 'selenium-webdriver/firefox.js';
import { Options as EdgeOptions } from 'selenium-webdriver/edge.js';
import bodyParser from 'body-parser';
import { Router } from 'express';
import { Chalk } from 'chalk';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

interface SearchResult {
    results: string;
    links: string[];
}

const chalk = new Chalk();
const TIMEOUT = 5000;
const MODULE_NAME = '[SillyTavern-WebSearch-Selenium]';

function getBrowserName(): string {
    const env = process.env.ST_SELENIUM_BROWSER;
    if (env && Object.values(Browser).includes(env)) {
        return env;
    }

    return Browser.CHROME;
}

function isHeadless(): boolean {
    return (process.env.ST_SELENIUM_HEADLESS ?? 'true') === 'true';
}

function isDebug(): boolean {
    return (process.env.ST_SELENIUM_DEBUG ?? 'false') === 'true';
}

function getChromeOptions(): ChromeOptions {
    const chromeOptions = new ChromeOptions();
    if (isHeadless()) {
        chromeOptions.addArguments('--headless');
    }
    chromeOptions.addArguments('--disable-infobars');
    chromeOptions.addArguments('--disable-gpu');
    chromeOptions.addArguments('--no-sandbox');
    chromeOptions.addArguments('--disable-dev-shm-usage');
    chromeOptions.addArguments('--lang=en-GB');
    return chromeOptions;
}

function getFirefoxOptions(): FirefoxOptions {
    const firefoxOptions = new FirefoxOptions();
    if (isHeadless()) {
        firefoxOptions.addArguments('--headless');
    }
    firefoxOptions.setPreference('intl.accept_languages', 'en,en_US');
    return firefoxOptions;
}

function getEdgeOptions(): EdgeOptions {
    const edgeOptions = new EdgeOptions();
    if (isHeadless()) {
        edgeOptions.addArguments('--headless');
    }
    return edgeOptions;
}

async function getDriver(): Promise<WebDriver> {
    const browserName = getBrowserName();
    console.log(chalk.green(MODULE_NAME), 'Using browser:', browserName);
    console.log(chalk.green(MODULE_NAME), 'Headless:', isHeadless());
    console.log(chalk.green(MODULE_NAME), 'Debug:', isDebug());
    const driver = await new Builder()
        .forBrowser(browserName)
        .setChromeOptions(getChromeOptions())
        .setFirefoxOptions(getFirefoxOptions())
        .setEdgeOptions(getEdgeOptions())
        .build();
    return driver;
}

async function getTextBySelector(driver: WebDriver, selector: string): Promise<string> {
    const elements = await driver.findElements(By.css(selector));
    const texts = await Promise.all(elements.map(el => el.getText()));
    return texts.filter(x => x).join('\n');
}

async function saveDebugPage(driver: WebDriver) {
    if (!isDebug()) {
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

async function performGoogleSearch(query: string): Promise<SearchResult> {
    const driver = await getDriver();
    try {
        console.log(chalk.green(MODULE_NAME), 'Searching Google for:', query);
        await driver.get(`https://google.com/search?hl=en&q=${encodeURIComponent(query)}`);
        await saveDebugPage(driver);

        // Wait for the main content
        await driver.wait(until.elementLocated(By.id('res')), TIMEOUT);

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

        console.log(chalk.green(MODULE_NAME), 'Found:', text, linksText);
        return { results: text, links: linksText };
    } finally {
        await driver.quit();
    }
}

async function performDuckDuckGoSearch(query: string): Promise<SearchResult> {
    const driver = await getDriver();
    try {
        await driver.get(`https://duckduckgo.com/?kp=-2&kl=wt-wt&q=${encodeURIComponent(query)}`);
        await saveDebugPage(driver);

        // Wait for the main content
        await driver.wait(until.elementLocated(By.id('web_content_wrapper')), TIMEOUT);

        // Get text from the snippets
        const text = await getTextBySelector(driver, '[data-result="snippet"]');

        // Get links from the results
        const links = await driver.findElements(By.css('[data-testid="result-title-a"]'));
        const linksText = await Promise.all(links.map(el => el.getAttribute('href')));

        console.log(chalk.green(MODULE_NAME), 'Found:', text, linksText);
        return { results: text, links: linksText };
    } finally {
        await driver.quit();
    }
}

/**
 * Initialize the plugin.
 * @param router Express Router
 */
export async function init(router: Router) {
    const jsonParser = bodyParser.json();
    router.post('/probe', (_req, res) => {
        return res.sendStatus(204);
    });
    router.post('/search', jsonParser, async (req, res) => {
        try {
            switch (req.body.engine) {
                case 'google': {
                    const result = await performGoogleSearch(req.body.query);
                    return res.send(result);
                }
                case 'duckduckgo': {
                    const result = await performDuckDuckGoSearch(req.body.query);
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

export async function exit() {
    console.log(chalk.yellow(MODULE_NAME), 'Plugin exited');
}

export const info = {
    id: 'selenium',
    name: 'WebSearch Selenium',
    description: 'Search the web using Selenium. Requires a WebSearch UI extension.',
};

const plugin = {
    init,
    exit,
    info,
};

export default plugin;
