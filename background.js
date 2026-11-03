/**
 * Phantom JD Scraper & Webizer CRM - Service Worker (background.js)
 * Clean, high-performance background manager. Zero telemetry. Zero limits.
 */

const PhantomBackground = {
  init() {
    this.listenAction();
    this.listenMessages();
    this.listenTabRemoval();
  },

  listenAction() {
    chrome.action.onClicked.addListener(() => {
      this.openAppWindow();
    });
  },

  openAppWindow() {
    const url = chrome.runtime.getURL("html/index.html");
    chrome.tabs.query({}, (tabs) => {
      const existing = tabs.find(t => t.url && t.url === url);
      if (existing && existing.id) {
        chrome.windows.update(existing.windowId, { focused: true });
        chrome.tabs.update(existing.id, { active: true });
      } else {
        chrome.windows.getCurrent((currWin) => {
          const left = Math.max(0, (currWin.left || 0) + 100);
          const top = Math.max(0, (currWin.top || 0) + 50);
          chrome.windows.create({
            url: url,
            type: "popup",
            width: 1240,
            height: 820,
            left: Math.round(left),
            top: Math.round(top),
            focused: true
          });
        });
      }
    });
  },

  listenMessages() {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return;

      switch (msg.command) {
        case "startSearchProcess":
          this.handleStartSearch(msg.data, sendResponse);
          return true;

        case "stopAutoBotProcess":
          this.handleStopSearch(msg.reason);
          break;

        case "resumeAutoBotProcess":
          this.handleResumeSearch();
          break;

        case "downloadCSV":
          this.exportCSV(msg.data);
          break;

        case "openWhatsApp":
          if (msg.url) {
            chrome.tabs.create({ url: msg.url, active: false });
          }
          break;
      }
    });
  },

  async handleStartSearch(data, sendResponse) {
    const initialArr = data.scrape_keywords_arr || [];
    const searchUrl = data.search_query || (initialArr[0] && initialArr[0].keyword) || "";

    await chrome.storage.local.set({
      scrape_status: "Inprogress",
      active_search_tab_id: 0,
      current_processed_count: 0,
      scrape_item_index: 0,
      scrape_limit_type: data.scrape_limit_type || "All",
      scrape_limit: data.scrape_limit || 0,
      scrape_type: data.search_type || "Keyword",
      Keywords_input: data.Keywords_input || "",
      location_input: data.location_input || "",
      resume_url: searchUrl,
      scrape_keywords_arr: initialArr
    });

    chrome.windows.create({
      url: searchUrl,
      width: 960,
      height: 750,
      type: "popup",
      focused: false
    }, (win) => {
      if (win && win.tabs && win.tabs[0]) {
        chrome.storage.local.set({ active_search_tab_id: win.tabs[0].id });
      }
      this.notify("Scraping Started", `Searching Justdial for "${data.Keywords_input || 'Leads'}"`);
      if (sendResponse) sendResponse({ success: true });
    });
  },

  async handleStopSearch(reason) {
    const st = await chrome.storage.local.get(["active_search_tab_id", "total_scrapped_count"]);
    const activeTabId = st.active_search_tab_id;

    if (activeTabId) {
      try {
        chrome.tabs.remove(activeTabId, () => {
          if (chrome.runtime.lastError) {}
        });
      } catch (e) {}
    }

    await chrome.storage.local.set({
      scrape_status: "Finished",
      active_search_tab_id: 0
    });

    chrome.runtime.sendMessage({ command: "updateScrapeState" });

    const count = st.total_scrapped_count || 0;
    this.notify("Scraping Completed", `Successfully gathered ${count} business leads!`);
  },

  async handleResumeSearch() {
    const st = await chrome.storage.local.get(["resume_url", "scrape_status"]);
    const resumeUrl = st.resume_url;
    if (!resumeUrl) return;

    await chrome.storage.local.set({
      scrape_status: "Inprogress",
      active_search_tab_id: 0
    });

    chrome.windows.create({
      url: resumeUrl,
      width: 960,
      height: 750,
      type: "popup",
      focused: false
    }, (win) => {
      if (win && win.tabs && win.tabs[0]) {
        chrome.storage.local.set({ active_search_tab_id: win.tabs[0].id });
      }
      this.notify("Process Resumed", "Resuming lead extraction on Justdial");
    });
  },

  listenTabRemoval() {
    chrome.tabs.onRemoved.addListener((tabId) => {
      chrome.storage.local.get(["active_search_tab_id", "scrape_status"], (st) => {
        if (st.scrape_status === "Inprogress" && st.active_search_tab_id === tabId) {
          this.handleStopSearch("tab_closed");
        }
      });
    });
  },

  exportCSV(items) {
    if (!items || !items.length) return;

    const headers = [
      "CRM Status",
      "Lead Name",
      "Website Status",
      "Official Website",
      "WhatsApp Direct Link",
      "Direct Mobile / WhatsApp",
      "Justdial Virtual Phone",
      "Rating",
      "Reviews",
      "Address",
      "Area",
      "City",
      "Category",
      "Email",
      "Pincode",
      "CRM Notes",
      "Justdial URL"
    ];

    const rows = items.map(item => {
      const waPhone = item.whatsapp_number || item.primary_phone || item.jd_phone || "";
      let cleanPhone = String(waPhone).replace(/\D/g, "");
      if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;
      const waLink = cleanPhone ? `https://wa.me/${cleanPhone}` : "";

      return [
        item.crm_status || "New",
        item.name || "",
        item.has_website ? "Has Website" : "NO WEBSITE (Hot Lead)",
        item.website_url || "None",
        waLink,
        item.whatsapp_number || item.primary_phone || "",
        item.jd_phone || "",
        item.rating || "",
        item.reviews || "",
        item.address || "",
        item.area || "",
        item.city || "",
        item.category || "",
        item.email || "",
        item.pincode || "",
        item.crm_notes || "",
        item.link || ""
      ].map(val => `"${String(val).replace(/"/g, '""').replace(/\r?\n|\r/g, " ")}"`);
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
    const blobUrl = "data:text/csv;charset=utf-8," + encodeURIComponent(csvContent);

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10) + "_" + now.getHours() + "-" + now.getMinutes();
    const filename = `Webizer_Justdial_Leads_${dateStr}.csv`;

    chrome.downloads.download({
      url: blobUrl,
      filename: `Phantom_JD_Leads/${filename}`,
      saveAs: false
    });
  },

  notify(title, message) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/default_icon_128.png"),
      title: title,
      message: message
    }, () => {
      if (chrome.runtime.lastError) {}
    });
  }
};

PhantomBackground.init();

