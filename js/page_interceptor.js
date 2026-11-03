(function() {
  if (window.__phantomJdInterceptorInstalled) return;
  window.__phantomJdInterceptorInstalled = true;

  const originalFetch = window.fetch;
  const originalXhrOpen = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
  const originalXhrSend = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;
  const originalXhrSetHeader = window.XMLHttpRequest && window.XMLHttpRequest.prototype.setRequestHeader;

  function extractHeaderValue(headers, names) {
    if (!headers) return "";
    if (typeof headers.get === "function") {
      for (let i = 0; i < names.length; i++) {
        const val = headers.get(names[i]);
        if (val) return val;
      }
    }
    if (Array.isArray(headers)) {
      for (let i = 0; i < headers.length; i++) {
        const item = headers[i];
        if (Array.isArray(item) && item.length >= 2) {
          if (names.includes(String(item[0] || "").toLowerCase())) {
            return item[1] || "";
          }
        }
      }
    }
    if (typeof headers === "object") {
      for (let i = 0; i < names.length; i++) {
        if (headers[names[i]]) return headers[names[i]];
      }
      const keys = Object.keys(headers);
      for (let i = 0; i < keys.length; i++) {
        if (names.includes(keys[i].toLowerCase())) {
          return headers[keys[i]] || "";
        }
      }
    }
    return "";
  }

  function getUrlString(urlOrReq) {
    if (!urlOrReq) return "";
    if (typeof urlOrReq === "string") return urlOrReq;
    if (typeof URL !== "undefined" && urlOrReq instanceof URL) return urlOrReq.toString();
    if (typeof Request !== "undefined" && urlOrReq instanceof Request) return urlOrReq.url || "";
    return String(urlOrReq);
  }

  function saveAndDispatchHeaders(requestTime, securityToken) {
    if (!requestTime && !securityToken) return;
    try {
      if (requestTime) localStorage.setItem("jd_requesttime", requestTime);
      if (securityToken) localStorage.setItem("jd_securitytoken", securityToken);
      window.dispatchEvent(new CustomEvent("jd-fetch-headers-captured", {
        detail: {
          requesttime: requestTime || localStorage.getItem("jd_requesttime") || "",
          securitytoken: securityToken || localStorage.getItem("jd_securitytoken") || ""
        }
      }));
    } catch (e) {
      console.warn("[Phantom Scraper] Storage error:", e);
    }
  }

  // Intercept Fetch
  if (typeof originalFetch === "function") {
    window.fetch = async function() {
      try {
        const args = Array.prototype.slice.call(arguments);
        const url = getUrlString(args[0]);
        if (url.includes("/api/")) {
          const headers = (args[1] && args[1].headers) || (typeof Request !== "undefined" && args[0] instanceof Request && args[0].headers);
          const reqTime = extractHeaderValue(headers, ["requesttime"]);
          const secToken = extractHeaderValue(headers, ["securitytoken"]);
          if (reqTime || secToken) {
            saveAndDispatchHeaders(reqTime, secToken);
          }
        }
      } catch (err) {
        console.warn("[Phantom Scraper] Fetch hook error:", err);
      }
      return originalFetch.apply(this, arguments);
    };
  }

  // Intercept XHR
  if (originalXhrOpen && originalXhrSend && originalXhrSetHeader) {
    window.XMLHttpRequest.prototype.open = function(method, url) {
      this.__phantomUrl = getUrlString(url);
      this.__phantomHeaders = {};
      return originalXhrOpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
      if (!this.__phantomHeaders) this.__phantomHeaders = {};
      this.__phantomHeaders[String(header || "").toLowerCase()] = value;
      return originalXhrSetHeader.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function() {
      try {
        if (this.__phantomUrl && this.__phantomUrl.includes("/api/")) {
          const reqTime = extractHeaderValue(this.__phantomHeaders, ["requesttime"]);
          const secToken = extractHeaderValue(this.__phantomHeaders, ["securitytoken"]);
          if (reqTime || secToken) {
            saveAndDispatchHeaders(reqTime, secToken);
          }
        }
      } catch (err) {
        console.warn("[Phantom Scraper] XHR hook error:", err);
      }
      return originalXhrSend.apply(this, arguments);
    };
  }

  // Listen to Detail API Requests from Content Script
  window.addEventListener("jd-detail-api-request", function(evt) {
    const detail = evt && evt.detail;
    if (!detail) return;
    const { requestId, url, options } = detail;
    if (!requestId || !url) return;

    fetch(url, options)
      .then(res => res.json())
      .then(data => {
        window.dispatchEvent(new CustomEvent("jd-detail-api-response", {
          detail: { requestId: requestId, success: true, data: data }
        }));
      })
      .catch(err => {
        window.dispatchEvent(new CustomEvent("jd-detail-api-response", {
          detail: { requestId: requestId, success: false, error: err ? err.message : "Request failed" }
        }));
      });
  });

  console.log("%c [Phantom JD Scraper & CRM] Page interceptor initialized.", "color:#10b981; font-weight:bold;");
})();

