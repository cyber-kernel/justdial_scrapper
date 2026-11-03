/**
 * Phantom JD Scraper - Content Script
 * Injected on https://*.justdial.com/*
 */

(function() {
  if (window.__phantomContentScriptLoaded) return;
  window.__phantomContentScriptLoaded = true;

  const PhantomContent = {
    pageScriptInjected: false,
    headerListenerAttached: false,
    detailResponseListenerAttached: false,
    detailRequestCounter: 0,
    pendingDetailRequests: {},
    uiSettings: {},

    init() {
      this.injectPageScript();
      this.attachHeaderCaptureListener();
      this.attachDetailResponseListener();
      this.syncSavedHeaders();
      this.listenForExtensionMessages();
      this.checkAndResumeScraping();
    },

    injectPageScript() {
      if (this.pageScriptInjected) return;
      const scriptId = "phantom-jd-interceptor";
      if (document.getElementById(scriptId)) {
        this.pageScriptInjected = true;
        return;
      }
      const s = document.createElement("script");
      s.id = scriptId;
      s.src = chrome.runtime.getURL("js/page_interceptor.js");
      s.onload = function() { this.remove(); };
      (document.head || document.documentElement).appendChild(s);
      this.pageScriptInjected = true;
    },

    attachHeaderCaptureListener() {
      if (this.headerListenerAttached) return;
      window.addEventListener("jd-fetch-headers-captured", (e) => {
        const detail = (e && e.detail) || {};
        const reqTime = detail.requesttime || "";
        const secToken = detail.securitytoken || "";
        if (reqTime || secToken) {
          chrome.storage.local.set({ jd_requesttime: reqTime, jd_securitytoken: secToken });
        }
      });
      this.headerListenerAttached = true;
    },

    attachDetailResponseListener() {
      if (this.detailResponseListenerAttached) return;
      window.addEventListener("jd-detail-api-response", (e) => {
        const detail = (e && e.detail) || {};
        const reqId = detail.requestId;
        if (reqId && this.pendingDetailRequests[reqId]) {
          const promiseObj = this.pendingDetailRequests[reqId];
          delete this.pendingDetailRequests[reqId];
          if (detail.success) {
            promiseObj.resolve(detail.data || {});
          } else {
            promiseObj.reject(new Error(detail.error || "Detail API failed"));
          }
        }
      });
      this.detailResponseListenerAttached = true;
    },

    syncSavedHeaders() {
      try {
        const reqTime = localStorage.getItem("jd_requesttime") || "";
        const secToken = localStorage.getItem("jd_securitytoken") || "";
        if (reqTime || secToken) {
          chrome.storage.local.set({ jd_requesttime: reqTime, jd_securitytoken: secToken });
        }
      } catch (err) {}
    },

    listenForExtensionMessages() {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg) return;
        switch (msg.command) {
          case "checkSearchStatus":
            chrome.storage.local.get(null, (st) => {
              const isActive = st.active_search_tab_id && sender && sender.tab && parseInt(sender.tab.id) === parseInt(st.active_search_tab_id);
              sendResponse({ is_search: Boolean(isActive) });
            });
            return true;

          case "stopAutoBotProcess":
            this.removeStatusBanner();
            break;
        }
      });
    },

    checkAndResumeScraping() {
      chrome.storage.local.get(null, (settings) => {
        this.uiSettings = settings || {};
        if (this.uiSettings.scrape_status === "Inprogress") {
          // Show non-intrusive floating indicator
          this.showStatusBanner("Phantom JD Scraper is running...");
          // Wait for page hydration
          setTimeout(() => {
            this.processCurrentPage();
          }, 2000);
        }
      });
    },

    showStatusBanner(text) {
      let banner = document.getElementById("phantom-scrape-banner");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "phantom-scrape-banner";
        banner.style.cssText = `
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 9999999;
          background: linear-gradient(135deg, #1e293b, #0f172a);
          color: #ffffff;
          padding: 12px 20px;
          border-radius: 12px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 12px;
          transition: all 0.3s ease;
        `;
        document.body.appendChild(banner);
      }
      banner.innerHTML = `
        <span style="display:inline-block; width:10px; height:10px; background:#10b981; border-radius:50%; box-shadow:0 0 8px #10b981; animation: pulse 1.5s infinite;"></span>
        <span>${text}</span>
        <button id="phantom-stop-btn" style="background:#ef4444; border:none; color:white; padding:4px 10px; border-radius:6px; font-size:12px; cursor:pointer; font-weight:600;">Stop</button>
      `;
      document.getElementById("phantom-stop-btn").onclick = () => {
        chrome.runtime.sendMessage({ command: "stopAutoBotProcess", reason: "manual_stop" });
        this.removeStatusBanner();
      };
    },

    removeStatusBanner() {
      const banner = document.getElementById("phantom-scrape-banner");
      if (banner) banner.remove();
    },

    buildDetailApiPayload(item) {
      if (!item || !item.link) return null;
      try {
        const itemUrl = new URL(item.link, location.origin);
        const pageUrl = new URL(location.href);
        const parts = itemUrl.pathname.split("/").filter(Boolean);
        if (parts.length < 3) return null;

        const docId = (parts[parts.length - 1] || "").replace(/_BZDET.*$/i, "").replace(/-/g, ".");
        const city = decodeURIComponent(parts[0] || "");
        const search = decodeURIComponent(parts[1] || "");

        return {
          city: city,
          search: search,
          docid: docId,
          ncatid: itemUrl.searchParams.get("ncatid") || pageUrl.searchParams.get("ncatid") || "",
          catname: itemUrl.searchParams.get("mncatname") || itemUrl.searchParams.get("catname") || pageUrl.searchParams.get("mncatname") || "",
          mobile: "",
          bid: 0,
          pdid: [],
          search_id: itemUrl.searchParams.get("search_id") || "",
          trkid: itemUrl.searchParams.get("trkid") || pageUrl.searchParams.get("trkid") || "",
          slat: pageUrl.searchParams.get("slat") || pageUrl.searchParams.get("lat") || "",
          slong: pageUrl.searchParams.get("slong") || pageUrl.searchParams.get("long") || "",
          usercity: city,
          useTabsView: true,
          pid: "",
          dIds: {},
          cat_b2b_flag: itemUrl.searchParams.get("cat_b2b_flag") || "0",
          thumbnail: itemUrl.searchParams.get("thumbnail") || "",
          tabfocus: "",
          referrer: itemUrl.toString()
        };
      } catch (err) {
        console.error("[Phantom Scraper] Payload error:", err);
        return null;
      }
    },

    fetchJustdialDetailData(payload, headers) {
      return new Promise((resolve, reject) => {
        this.detailRequestCounter++;
        const requestId = "phantom-jd-" + this.detailRequestCounter + "-" + Date.now();
        this.pendingDetailRequests[requestId] = { resolve, reject };

        window.dispatchEvent(new CustomEvent("jd-detail-api-request", {
          detail: {
            requestId: requestId,
            url: "https://www.justdial.com/api/detail?searchReferer=gen|lst",
            options: {
              method: "POST",
              mode: "cors",
              credentials: "include",
              referrer: payload.referrer || location.href,
              headers: headers,
              body: JSON.stringify(payload)
            }
          }
        }));

        setTimeout(() => {
          if (this.pendingDetailRequests[requestId]) {
            delete this.pendingDetailRequests[requestId];
            reject(new Error("Timeout waiting for Justdial Detail API"));
          }
        }, 12000);
      });
    },

    async enrichItem(item) {
      if (!item || !item.link) return item;
      try {
        const stored = await chrome.storage.local.get(["jd_requesttime", "jd_securitytoken"]);
        const reqTime = stored.jd_requesttime || localStorage.getItem("jd_requesttime") || "";
        const secToken = stored.jd_securitytoken || localStorage.getItem("jd_securitytoken") || "";

        if (!reqTime && !secToken) {
          // If no tokens yet, mark website status as unknown or fallback
          item.website_status = "UNKNOWN";
          return item;
        }

        const payload = this.buildDetailApiPayload(item);
        if (!payload) return item;

        const headers = {
          "accept": "application/json, text/plain, */*",
          "content-type": "application/json",
          "requesttime": reqTime,
          "securitytoken": secToken
        };
        const jdpk = localStorage.getItem("jdpk");
        if (jdpk) headers.jdpk = jdpk;

        const res = await this.fetchJustdialDetailData(payload, headers);
        const data = (res && res.results) || res || {};

        // Extract contact info
        item.email = data.email || "";
        item.address = data.address || item.address || "";
        item.pincode = data.pincode || "";

        // Extract direct WhatsApp number (unmasked owner number from wup)
        let wpNum = "";
        if (data.msg_num) {
          try {
            const parsed = typeof data.msg_num === "string" ? JSON.parse(data.msg_num) : data.msg_num;
            if (parsed && Array.isArray(parsed.wup) && parsed.wup.length > 0) {
              wpNum = String(parsed.wup[0] || "").trim();
            }
          } catch (e) {}
        }
        item.whatsapp_number = wpNum;
        item.primary_phone = wpNum || item.jd_phone || "";

        // WEBSITE DETECTION ENGINE
        // In Justdial API, website is stored in comp_website, website, web, or comp_url
        const rawWebsite = (data.comp_website || data.website || data.web || data.url || data.comp_url || "").trim();
        if (rawWebsite && rawWebsite.length > 3 && !rawWebsite.includes("justdial.com")) {
          item.has_website = true;
          item.website_status = "HAS_WEBSITE";
          item.website_url = rawWebsite.startsWith("http") ? rawWebsite : "https://" + rawWebsite;
        } else {
          // NO WEBSITE FOUND! Hot prospect for Webizer!
          item.has_website = false;
          item.website_status = "NO_WEBSITE";
          item.website_url = "";
        }
      } catch (err) {
        console.warn("[Phantom Scraper] Enrich error:", err);
      }
      return item;
    },

    async processCurrentPage() {
      const st = await chrome.storage.local.get(null);
      this.uiSettings = st || {};
      if (this.uiSettings.scrape_status !== "Inprogress") {
        this.removeStatusBanner();
        return;
      }

      // Check user scrape limit
      const limitType = this.uiSettings.scrape_limit_type;
      const scrapeLimit = parseInt(this.uiSettings.scrape_limit) || 0;
      const currentCount = parseInt(this.uiSettings.current_processed_count) || 0;

      if (limitType === "Limit" && currentCount >= scrapeLimit) {
        chrome.runtime.sendMessage({ command: "stopAutoBotProcess", reason: "limit_reached" });
        this.removeStatusBanner();
        return;
      }

      // Find listing cards on Justdial
      const cards = document.querySelectorAll('[class*="results_listing_container"] [role="listitem"], .resultbox');
      const itemIndex = parseInt(this.uiSettings.scrape_item_index) || 0;

      if (itemIndex >= cards.length) {
        // Scroll down to load more items
        this.showStatusBanner(`Loaded ${cards.length} items. Scrolling for more...`);
        this.triggerInfiniteScroll();
        return;
      }

      const targetCard = cards[itemIndex];
      targetCard.scrollIntoView({ behavior: "smooth", block: "center" });

      // Extract raw card data
      const nameEl = targetCard.querySelector(".resultbox_title_anchor, [class*='title_anchor'], h2");
      const linkEl = targetCard.querySelector(".resultbox_title_anchorbox, a[href*='/']");
      const phoneEl = targetCard.querySelector(".resultbox_btnbox .callNowAnchor, [class*='callNowAnchor'], [href^='tel:']");
      const ratingEl = targetCard.querySelector(".resultbox_countrate, [class*='countrate']");
      const reviewsEl = targetCard.querySelector(".resultbox_totalrate, [class*='totalrate']");
      const addressEl = targetCard.querySelector(".resultbox_address, [class*='resultbox_address']");
      const categoryEls = targetCard.querySelectorAll(".resultbox_amenities li, [class*='amenities'] li");

      const name = nameEl ? nameEl.textContent.trim() : "";
      const link = linkEl ? linkEl.href : "";
      const jdPhone = phoneEl ? phoneEl.textContent.trim().replace(/[^\d+]/g, "") : "";
      const rating = ratingEl ? ratingEl.textContent.trim() : "";
      const reviews = reviewsEl ? reviewsEl.textContent.trim().replace(/[^\d]/g, "") : "";
      const address = addressEl ? addressEl.textContent.trim() : "";
      const categories = Array.from(categoryEls).map(el => el.textContent.trim()).join(", ");

      if (!name) {
        // Skip invalid item
        await this.advanceItem(itemIndex + 1);
        return;
      }

      this.showStatusBanner(`Analyzing: ${name}...`);

      let item = {
        id: "lead_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        name: name,
        link: link,
        jd_phone: jdPhone,
        whatsapp_number: "",
        primary_phone: jdPhone,
        email: "",
        rating: rating,
        reviews: reviews,
        address: address,
        area: this.extractAreaFromAddress(address),
        city: this.uiSettings.location_input || "",
        category: categories,
        has_website: false,
        website_status: "NO_WEBSITE",
        website_url: "",
        crm_status: "New",
        crm_notes: "",
        created_at: new Date().toISOString()
      };

      // Deep enrich with Detail API
      item = await this.enrichItem(item);

      // Save to local storage
      const keywordsArr = this.uiSettings.scrape_keywords_arr || [];
      const currentKeywordObj = keywordsArr.find(k => k.status === "Inprogress") || keywordsArr[0];
      if (currentKeywordObj) {
        if (!currentKeywordObj.result_items_arr) currentKeywordObj.result_items_arr = [];
        
        // Duplicate check
        const isDuplicate = currentKeywordObj.result_items_arr.some(existing => 
          existing.name === item.name && (existing.primary_phone === item.primary_phone || existing.link === item.link)
        );

        if (!isDuplicate) {
          currentKeywordObj.result_items_arr.push(item);
          const newProcessed = (parseInt(this.uiSettings.current_processed_count) || 0) + 1;
          const newTotal = (parseInt(this.uiSettings.total_scrapped_count) || 0) + 1;

          await chrome.storage.local.set({
            scrape_keywords_arr: keywordsArr,
            current_processed_count: newProcessed,
            total_scrapped_count: newTotal,
            scrape_item_index: itemIndex + 1
          });

          chrome.runtime.sendMessage({ command: "updateScrapeState" });
        } else {
          await this.advanceItem(itemIndex + 1);
        }
      }

      // Next item delay (1.5 to 2.8 seconds to stay safe)
      const delayMs = Math.floor(Math.random() * 1300) + 1500;
      setTimeout(() => {
        this.processCurrentPage();
      }, delayMs);
    },

    async advanceItem(nextIndex) {
      await chrome.storage.local.set({ scrape_item_index: nextIndex });
      setTimeout(() => {
        this.processCurrentPage();
      }, 500);
    },

    triggerInfiniteScroll() {
      const scrollHeight = document.documentElement.scrollHeight;
      window.scrollTo({
        top: scrollHeight - 800,
        behavior: "smooth"
      });

      setTimeout(async () => {
        const newCards = document.querySelectorAll('[class*="results_listing_container"] [role="listitem"], .resultbox');
        const st = await chrome.storage.local.get(["scrape_item_index"]);
        const currIndex = parseInt(st.scrape_item_index) || 0;

        if (newCards.length > currIndex) {
          this.processCurrentPage();
        } else {
          // If no new cards loaded after scroll, try one more bottom scroll or finish
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
          setTimeout(() => {
            const finalCards = document.querySelectorAll('[class*="results_listing_container"] [role="listitem"], .resultbox');
            if (finalCards.length > currIndex) {
              this.processCurrentPage();
            } else {
              chrome.runtime.sendMessage({ command: "stopAutoBotProcess", reason: "all_leads_scraped" });
              this.removeStatusBanner();
            }
          }, 3000);
        }
      }, 3000);
    },

    extractAreaFromAddress(addr) {
      if (!addr) return "";
      const parts = addr.split(",").map(p => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return parts[parts.length - 2];
      }
      return parts[0] || "";
    }
  };

  PhantomContent.init();
})();

