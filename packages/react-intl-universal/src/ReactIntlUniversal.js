import React from "react";
import IntlMessageFormat from "intl-messageformat";
import escapeHtml from "escape-html";
import invariant from "invariant";
import * as constants from "./constants";
import merge from "lodash.merge";

String.prototype.defaultMessage = String.prototype.d = function (msg) {
  return this || msg || "";
};

class ReactIntlUniversal {
  constructor() {
    this.options = {
      currentLocale: null, // Current locale such as 'en-US'
      locales: {}, // app locale data like {"en-US":{"key1":"value1"},"zh-CN":{"key1":"值1"}}
      warningHandler: function warn(...msg) { console.warn(...msg) }, // ability to accumulate missing messages using third party services
      escapeHtml: true, // disable escape html in variable mode
      fallbackLocale: null, // Locale to use if a key is not found in the current locale
      debug: false, // If debugger mode is on, the message will be wrapped by a span
      dataKey: 'data-i18n-key', // If debugger mode is on, the message will be wrapped by a span with this data key
    };
  }

  /**
   * Get the formatted message by key
   * @param {string} key The string representing key in locale data file
   * @param {Object} variables Variables in message
   * @returns {string} message
   */
  _getFormattedMessage(key, variables) {
    if (this.options.intlGetHook) {
      try {
        this.options.intlGetHook(key, this.options.currentLocale);
      } catch (e) {
        console.log('intl get hook error: ', e);
      }
    }
    invariant(key, "key is required");
    const { locales, currentLocale, formats } = this.options;

    // 1. check if the locale data and key exists
    if (!locales || !locales[currentLocale]) {
      let errorMsg = `react-intl-universal locales data "${currentLocale}" not exists.`;
      if (!currentLocale) {
        errorMsg += ' More info: https://github.com/alibaba/react-intl-universal/issues/144#issuecomment-1345193138'
      }
      this.options.warningHandler(errorMsg);
      return "";
    }
    let msg = this.getDescendantProp(locales[currentLocale], key);
    if (msg == null) {
      if (this.options.fallbackLocale) {
        msg = this.getDescendantProp(locales[this.options.fallbackLocale], key);
        if (msg == null) {
          this.options.warningHandler(
            `react-intl-universal key "${key}" not defined in ${currentLocale} or the fallback locale, ${this.options.fallbackLocale}`
          );
          return "";
        }
      } else {
        this.options.warningHandler(
          `react-intl-universal key "${key}" not defined in ${currentLocale}`
        );
        return "";
      }
    }

    // 2. handle security issue for variables
    if (variables) {
      variables = Object.assign({}, variables);
      // HTML message with variables. Escape it to avoid XSS attack.
      for (let i in variables) {
        let value = variables[i];
        if (
          this.options.escapeHtml === true &&
          (typeof value === "string" || value instanceof String) &&
          value.indexOf("<") >= 0
        ) {
          value = escapeHtml(value);
        }
        variables[i] = value;
      }
    }

    // 3. resolve variables
    try {
      let finalMsg;
      if (variables) { // format message with variables
        const msgFormatter = new IntlMessageFormat(msg, currentLocale, formats);
        finalMsg = msgFormatter.format(variables);
      } else { // no variables, just return the message
        finalMsg = msg;
      }
      return finalMsg
    } catch (err) {
      this.options.warningHandler(
        `react-intl-universal format message failed for key='${key}'.`,
        err.message
      );
      return msg;
    }
  }

  /**
   * Get the formatted message by key
   * @param {string} key The string representing key in locale data file
   * @param {Object} [variables] Variables in message
   * @returns {string} message
   */
  get(key, variables) {
    const msg = this._getFormattedMessage(key, variables);
    return this.options.debug ? this._getSpanElementMessage(key, msg) : msg;
  }

  /**
   * Get the formatted html message by key.
   * @param {string} key The string representing key in locale data file
   * @param {Object} [variables] Variables in message
   * @returns {React.ReactElement} html message
  */
  getHTML(key, variables) {
    let msg = this._getFormattedMessage(key, variables);
    if (msg) {
      return this._getSpanElementMessage(key, msg);
    }
    return "";
  }

  /**
   * As same as get(...) API
   * @param {Object} options
   * @param {string} options.id
   * @param {string} options.defaultMessage
   * @param {Object} variables Variables in message
   * @returns {string} message
  */
  formatMessage(messageDescriptor, variables) {
    const { id, defaultMessage } = messageDescriptor;
    return this.get(id, variables).defaultMessage(defaultMessage);
  }

  /**
   * As same as getHTML(...) API
   * @param {Object} options
   * @param {string} options.id
   * @param {React.Element} options.defaultMessage
   * @param {Object} variables Variables in message
   * @returns {React.Element} message
  */
  formatHTMLMessage(messageDescriptor, variables) {
    const { id, defaultMessage } = messageDescriptor;
    return this.getHTML(id, variables).defaultMessage(defaultMessage);
  }

  /**
   * Helper: determine user's locale via URL, cookie, localStorage, and browser's language.
   * You may not need this API, if you have other rules to determine user's locale.
   * @param {string} options.urlLocaleKey URL's query Key to determine locale. Example: if URL=http://localhost?lang=en-US, then set it 'lang'
   * @param {string} options.cookieLocaleKey Cookie's Key to determine locale. Example: if cookie=lang:en-US, then set it 'lang'
   * @param {string} options.localStorageLocaleKey LocalStorage's Key to determine locale such as 'lang'
   * @returns {string} determined locale such as 'en-US'
   */
  determineLocale(options = {}) {
    return (
      this.getLocaleFromURL(options) ||
      this.getLocaleFromCookie(options) ||
      this.getLocaleFromLocalStorage(options) ||
      this.getLocaleFromBrowser()
    );
  }
  
  /**
   * Change current locale
   * @param {string} newLocale Current locale such as 'en-US'
   */
  changeCurrentLocale(newLocale) {
    if (!this.options.locales || !this.options.locales[newLocale]) {
      let errorMsg = `react-intl-universal locales data "${newLocale}" not exists.`;
      if (!this.options.locales) {
        errorMsg += 'You should call init function first.'
      }
      this.options.warningHandler(errorMsg);
      return;
    }
    this.options.currentLocale = newLocale;
  }

  /**
   * Initialize properties and load CLDR locale data according to currentLocale
   * @param {Object} options
   * @param {string} options.currentLocale Current locale such as 'en-US'
   * @param {any} options.locales App locale data like {"en-US":{"key1":"value1"},"zh-CN":{"key1":"值1"}}
   * @param {boolean} [options.debug] debug mode
   * @returns {Promise}
   */
  init(options = {}) {
    invariant(options.currentLocale, "options.currentLocale is required");
    invariant(options.locales, "options.locales is required");

    Object.assign(this.options, options);

    this.options.formats = Object.assign(
      {},
      this.options.formats,
      constants.defaultFormats
    );

    return new Promise((resolve, reject) => {
      // init() will not load external common locale data anymore.
      // But, it still return a Promise for backward compatibility.
      resolve();
    });
  }

  /**
   * Get the inital options
   */
  getInitOptions() {
    return this.options;
  }

  /**
   * Load more locales after init
   */
  load(locales) {
    merge(this.options.locales, locales);
  }

  getLocaleFromCookie(options) {
    const { cookieLocaleKey } = options;
    if (cookieLocaleKey && typeof document !== 'undefined') {
      const cookies = document.cookie.split(';'); // Split on semicolon only
      const cookieObj = {};

      cookies.forEach((cookie) => {
        const [key, value] = cookie.trim().split('='); // Trim leading/trailing spaces
        if (key) {
          cookieObj[key] = decodeURIComponent(value); // cookie values may be URL-encoded
        }
      });
      return cookieObj[cookieLocaleKey];
    }
  }

  getLocaleFromLocalStorage(options) {
    const { localStorageLocaleKey } = options;
    if (localStorageLocaleKey && window.localStorage) {
      return localStorage.getItem(localStorageLocaleKey);
    }
  }

  getLocaleFromURL(options) {
    const { urlLocaleKey } = options;
    if (urlLocaleKey) {
      let query = location.search.split("?");
      if (query.length >= 2) {
        const params = new URLSearchParams(query[1]);
        if (params.has(urlLocaleKey)) {
          return params.get(urlLocaleKey);
        }
      }
    }
  }

  getDescendantProp(locale, key) {

    if (locale[key]) {
      return locale[key];
    }

    const msg = key.split(".").reduce(function (a, b) {
      return (a != undefined) ? a[b] : a;
    }, locale);

    return msg;
  }

  getLocaleFromBrowser() {
    return navigator.language || navigator.userLanguage;
  }

  _getSpanElementMessage(key, msg) {
    const options = {
      dangerouslySetInnerHTML: {
        __html: msg
      }
    };
    if (this.options.debug) {
      options[this.options.dataKey] = key
    }
    const el = React.createElement('span', options);
    // when key exists, it should still return element if there's defaultMessage() after getHTML()
    const defaultMessage = () => el;
    return Object.assign(
      { defaultMessage: defaultMessage, d: defaultMessage },
      el
    );
  }

}

export default ReactIntlUniversal;
