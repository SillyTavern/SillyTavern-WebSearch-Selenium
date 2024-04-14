# WebSearch Selenium Plugin

## Configuration

The plugin can be configured using [environment variables](https://dev.to/pizofreude/environment-variables-a-comprehensive-guide-34dg) before startup:

`ST_SELENIUM_BROWSER` (string) - sets the browser to be used. Default: `chrome`.

Possible values (case-sensitive!):

* `chrome`
* `firefox`
* `safari`
* `MicrosoftEdge`

A chosen browser must be available and installed on your machine.

`ST_SELENIUM_HEADLESS` (boolean) - launches browser in the headless (no visible GUI) mode. Default: `true`.

`ST_SELENIUM_DEBUG` (boolean) - save the HTML of search result pages to a temp directory. Default: `false`.

## How to build

Clone the repository, then run `npm install`.

```bash
# Debug build
npm run build:dev
# Prod build
npm run build
```

## License

AGPLv3
