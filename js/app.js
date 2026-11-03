/**
 * Phantom JD Scraper & Webizer CRM - Main Application Logic
 * Website: https://webizer.vercel.app/
 */

(function() {
  const App = {
    leads: [],
    currentTabFilter: "all",
    currentStatusFilter: "ALL",
    searchQuery: "",
    selectedTemplateId: "loss_aversion",
    scrapeStatus: "Finished",

    init() {
      this.initTemplates();
      this.attachEventListeners();
      this.syncState();
      this.listenBackgroundMessages();
    },

    // 1. Outreach Templates Init
    initTemplates() {
      const select = document.getElementById("select-outreach-template");
      if (!select || typeof WEBIZER_TEMPLATES === "undefined") return;

      select.innerHTML = WEBIZER_TEMPLATES.map(t => 
        `<option value="${t.id}">${t.name}</option>`
      ).join("");

      select.value = this.selectedTemplateId;
      this.updateTemplatePreview();

      select.addEventListener("change", (e) => {
        this.selectedTemplateId = e.target.value;
        this.updateTemplatePreview();
        this.renderTable(); // Re-render to update direct WhatsApp links
      });
    },

    updateTemplatePreview() {
      const tpl = WEBIZER_TEMPLATES.find(t => t.id === this.selectedTemplateId) || WEBIZER_TEMPLATES[0];
      const previewEl = document.getElementById("template-preview-text");
      const tagEl = document.getElementById("template-tag-badge");

      if (previewEl) previewEl.textContent = tpl.message;
      if (tagEl) tagEl.textContent = tpl.tag || "Webizer Strategy";
    },

    // 2. Event Listeners
    attachEventListeners() {
      // Scraper Form Submit
      const form = document.getElementById("scraper-form");
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          this.startScraping();
        });
      }

      // Stop Scrape
      const btnStop = document.getElementById("btn-stop-scrape");
      if (btnStop) {
        btnStop.addEventListener("click", () => {
          chrome.runtime.sendMessage({ command: "stopAutoBotProcess", reason: "manual_stop" });
          this.setScraperUIRunning(false);
          this.showToast("Scraping stopped by user", "info");
        });
      }

      // Resume Scrape
      const btnResume = document.getElementById("btn-resume-scrape");
      if (btnResume) {
        btnResume.addEventListener("click", () => {
          chrome.runtime.sendMessage({ command: "resumeAutoBotProcess" });
          this.setScraperUIRunning(true);
          this.showToast("Scraping process resumed", "success");
        });
      }

      // Limit type selector
      const selectLimitType = document.getElementById("select-limit-type");
      const customLimitWrap = document.getElementById("custom-limit-wrap");
      if (selectLimitType && customLimitWrap) {
        selectLimitType.addEventListener("change", () => {
          customLimitWrap.style.display = selectLimitType.value === "Limit" ? "flex" : "none";
        });
      }

      // Bulk URL toggle
      const toggleBulk = document.getElementById("toggle-bulk-urls");
      const bulkInput = document.getElementById("input-bulk-urls");
      if (toggleBulk && bulkInput) {
        toggleBulk.addEventListener("click", (e) => {
          e.preventDefault();
          const isHidden = bulkInput.style.display === "none";
          bulkInput.style.display = isHidden ? "block" : "none";
          toggleBulk.textContent = isHidden ? "- Hide Custom URLs" : "+ Paste Custom URLs";
        });
      }

      // Filter Tabs (All / No Website / Has Website)
      document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          this.currentTabFilter = btn.dataset.filter || "all";
          this.renderTable();
        });
      });

      // CRM Status Filter Dropdown
      const crmFilter = document.getElementById("crm-status-filter");
      if (crmFilter) {
        crmFilter.addEventListener("change", (e) => {
          this.currentStatusFilter = e.target.value;
          this.renderTable();
        });
      }

      // Search Box
      const searchBox = document.getElementById("crm-search-input");
      if (searchBox) {
        searchBox.addEventListener("input", (e) => {
          this.searchQuery = e.target.value.toLowerCase().trim();
          this.renderTable();
        });
      }

      // Export CSV
      const btnExport = document.getElementById("btn-export-csv");
      if (btnExport) {
        btnExport.addEventListener("click", () => {
          const filtered = this.getFilteredLeads();
          if (!filtered.length) {
            this.showToast("No leads to export!", "warning");
            return;
          }
          chrome.runtime.sendMessage({ command: "downloadCSV", data: filtered });
          this.showToast(`Exporting ${filtered.length} leads to CSV`, "success");
        });
      }

      // Copy Phone Numbers
      const btnCopy = document.getElementById("btn-copy-phones");
      if (btnCopy) {
        btnCopy.addEventListener("click", () => {
          const filtered = this.getFilteredLeads();
          const phones = filtered
            .map(item => item.whatsapp_number || item.primary_phone || item.jd_phone || "")
            .map(p => String(p).replace(/\D/g, ""))
            .filter(p => p.length >= 10)
            .map(p => p.slice(-10));

          const uniquePhones = [...new Set(phones)];
          if (!uniquePhones.length) {
            this.showToast("No phone numbers found in current filter", "warning");
            return;
          }

          navigator.clipboard.writeText(uniquePhones.join("\n")).then(() => {
            this.showToast(`Copied ${uniquePhones.length} clean phone numbers!`, "success");
          });
        });
      }

      // Clear Leads
      const btnClear = document.getElementById("btn-clear-leads");
      if (btnClear) {
        btnClear.addEventListener("click", () => {
          if (confirm("Are you sure you want to clear all leads from local storage? This cannot be undone.")) {
            chrome.storage.local.set({
              scrape_keywords_arr: [],
              total_scrapped_count: 0,
              current_processed_count: 0,
              scrape_item_index: 0
            }, () => {
              this.syncState();
              this.showToast("Local database cleared", "info");
            });
          }
        });
      }
    },

    // 3. Start Scraping
    startScraping() {
      const keyword = (document.getElementById("input-keyword").value || "").trim();
      const location = (document.getElementById("input-location").value || "").trim();
      const bulkUrls = (document.getElementById("input-bulk-urls").value || "").trim();
      const limitType = document.getElementById("select-limit-type").value;
      const limitNum = parseInt(document.getElementById("input-limit-num").value) || 50;

      let searchKeywordsArr = [];
      let initialSearchUrl = "";

      if (bulkUrls) {
        const lines = bulkUrls.split("\n").map(l => l.trim()).filter(l => l.includes("justdial.com"));
        if (!lines.length) {
          this.showToast("Please enter valid Justdial URLs in bulk mode", "warning");
          return;
        }
        lines.forEach(url => {
          searchKeywordsArr.push({ keyword: url, status: "Pending", result_items_arr: [] });
        });
        searchKeywordsArr[0].status = "Inprogress";
        initialSearchUrl = searchKeywordsArr[0].keyword;
      } else {
        if (!keyword || !location) {
          this.showToast("Please enter both Keyword and Location", "warning");
          return;
        }
        initialSearchUrl = this.buildJustdialUrl(keyword, location);
        searchKeywordsArr.push({
          keyword: initialSearchUrl,
          status: "Inprogress",
          result_items_arr: []
        });
      }

      const payload = {
        search_query: initialSearchUrl,
        search_type: bulkUrls ? "Url" : "Keyword",
        Keywords_input: keyword,
        location_input: location,
        scrape_keywords_arr: searchKeywordsArr,
        scrape_limit_type: limitType,
        scrape_limit: limitNum
      };

      chrome.runtime.sendMessage({ command: "startSearchProcess", data: payload }, () => {
        this.setScraperUIRunning(true);
        this.showToast("Automation window launched! Extracting leads...", "success");
      });
    },

    slugify(text) {
      return text.trim()
        .replace(/&/g, "and")
        .replace(/[^a-zA-Z0-9\s-]/g, " ")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    },

    buildJustdialUrl(keyword, location) {
      const kSlug = this.slugify(keyword);
      const locParts = location.split(",").map(p => p.trim()).filter(Boolean);
      let city = "";
      let area = "";

      if (locParts.length >= 2) {
        city = this.slugify(locParts[locParts.length - 1]);
        area = this.slugify(locParts.slice(0, -1).join(" "));
      } else {
        city = this.slugify(locParts[0] || "mumbai");
      }

      const term = encodeURIComponent(keyword.trim());
      if (area) {
        return `https://www.justdial.com/${city}/${kSlug}-in-${area}/?term=${term}`;
      }
      return `https://www.justdial.com/${city}/${kSlug}/?term=${term}`;
    },

    setScraperUIRunning(isRunning) {
      const btnStart = document.getElementById("btn-start-scrape");
      const btnStop = document.getElementById("btn-stop-scrape");
      const badge = document.getElementById("scrape-status-badge");

      if (isRunning) {
        if (btnStart) btnStart.style.display = "none";
        if (btnStop) btnStop.style.display = "inline-flex";
        if (badge) {
          badge.className = "badge badge-no-website";
          badge.textContent = "Status: Scraping in progress...";
        }
      } else {
        if (btnStart) btnStart.style.display = "inline-flex";
        if (btnStop) btnStop.style.display = "none";
        if (badge) {
          badge.className = "badge badge-has-website";
          badge.textContent = "Status: Ready";
        }
      }
    },

    // 4. Data State & Sync
    syncState() {
      chrome.storage.local.get(null, (st) => {
        if (!st) return;

        this.scrapeStatus = st.scrape_status || "Finished";
        this.setScraperUIRunning(this.scrapeStatus === "Inprogress");

        // Aggregate all scraped leads
        const allLeads = [];
        const keywordsArr = st.scrape_keywords_arr || [];
        keywordsArr.forEach(kw => {
          if (Array.isArray(kw.result_items_arr)) {
            allLeads.push(...kw.result_items_arr);
          }
        });

        this.leads = allLeads;
        this.updateStats();
        this.renderTable();
      });
    },

    listenBackgroundMessages() {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.command === "updateScrapeState") {
          this.syncState();
        }
      });
    },

    updateStats() {
      const total = this.leads.length;
      const noWebsite = this.leads.filter(l => !l.has_website).length;
      const hasWebsite = total - noWebsite;
      const contacted = this.leads.filter(l => l.crm_status === "Contacted").length;
      const won = this.leads.filter(l => l.crm_status === "Closed / Won").length;

      document.getElementById("stat-total").textContent = total;
      document.getElementById("stat-no-website").textContent = noWebsite;
      document.getElementById("stat-contacted").textContent = contacted;
      document.getElementById("stat-won").textContent = won;

      document.getElementById("count-all").textContent = total;
      document.getElementById("count-no-website").textContent = noWebsite;
      document.getElementById("count-has-website").textContent = hasWebsite;
      document.getElementById("scrape-progress-text").textContent = `${total} leads gathered in pipeline`;
    },

    // 5. Filter & Render
    getFilteredLeads() {
      return this.leads.filter(item => {
        // Tab filter (Website status)
        if (this.currentTabFilter === "no_website" && item.has_website) return false;
        if (this.currentTabFilter === "has_website" && !item.has_website) return false;

        // CRM Status filter
        if (this.currentStatusFilter !== "ALL" && (item.crm_status || "New") !== this.currentStatusFilter) {
          return false;
        }

        // Search Query
        if (this.searchQuery) {
          const matchString = [
            item.name,
            item.category,
            item.area,
            item.city,
            item.whatsapp_number,
            item.primary_phone,
            item.jd_phone,
            item.crm_notes
          ].join(" ").toLowerCase();
          if (!matchString.includes(this.searchQuery)) return false;
        }

        return true;
      });
    },

    renderTable() {
      const tbody = document.getElementById("leads-tbody");
      const emptyState = document.getElementById("empty-state");
      if (!tbody) return;

      const filtered = this.getFilteredLeads();

      if (!filtered.length) {
        tbody.innerHTML = "";
        if (emptyState) emptyState.style.display = "block";
        return;
      }

      if (emptyState) emptyState.style.display = "none";

      tbody.innerHTML = filtered.map((item, index) => {
        const waPhone = item.whatsapp_number || item.primary_phone || item.jd_phone || "";
        const waUrl = typeof generateWhatsAppUrl === "function" 
          ? generateWhatsAppUrl(waPhone, this.selectedTemplateId, item) 
          : `https://wa.me/91${waPhone.replace(/\D/g, "")}`;

        const websiteBadge = item.has_website
          ? `<a href="${item.website_url}" target="_blank" class="badge badge-has-website" title="${item.website_url}">🌐 Has Website ↗</a>`
          : `<span class="badge badge-no-website">🎯 NO Website (Hot Lead)</span>`;

        const displayPhone = item.whatsapp_number 
          ? `🟢 +91 ${item.whatsapp_number.slice(-10)}`
          : (item.jd_phone ? `📞 ${item.jd_phone}` : "No phone");

        return `
          <tr data-lead-id="${item.id}">
            <td style="color:var(--text-muted); font-weight:600;">${index + 1}</td>
            <td>
              <select class="status-select status-${(item.crm_status || 'New').toLowerCase().replace(/\s+/g, '')}" data-id="${item.id}">
                <option value="New" ${item.crm_status === "New" ? "selected" : ""}>🔵 New</option>
                <option value="Contacted" ${item.crm_status === "Contacted" ? "selected" : ""}>🟠 Contacted</option>
                <option value="Interested" ${item.crm_status === "Interested" ? "selected" : ""}>🟣 Interested</option>
                <option value="Meeting Set" ${item.crm_status === "Meeting Set" ? "selected" : ""}>🟡 Meeting Set</option>
                <option value="Closed / Won" ${item.crm_status === "Closed / Won" ? "selected" : ""}>🟢 Won / Closed</option>
                <option value="Not Interested" ${item.crm_status === "Not Interested" ? "selected" : ""}>⚪ Not Interested</option>
              </select>
            </td>
            <td>
              <b style="color:#fff; font-size:13px;">${item.name || "Unknown"}</b>
              <div style="color:var(--text-muted); font-size:11px; margin-top:2px;">${item.category || "General Listing"}</div>
            </td>
            <td>${websiteBadge}</td>
            <td>
              <div style="font-family:monospace; font-size:12px; font-weight:600;">${displayPhone}</div>
              ${item.email ? `<div style="color:var(--text-muted); font-size:10px;">${item.email}</div>` : ""}
            </td>
            <td>
              ${waPhone ? `
                <a href="${waUrl}" target="_blank" class="btn-wa wa-outreach-btn" data-id="${item.id}">
                  <span>💬 WhatsApp Pitch</span>
                </a>
              ` : `<span style="color:var(--text-muted); font-size:11px;">No Mobile</span>`}
            </td>
            <td>
              <span style="font-weight:700; color:#fbbf24;">${item.rating ? `★ ${item.rating}` : "-"}</span>
              <span style="color:var(--text-muted); font-size:10px;">(${item.reviews || 0})</span>
            </td>
            <td>
              <div style="font-size:12px; color:#cbd5e1;">${item.area || item.city || "-"}</div>
              <div style="color:var(--text-muted); font-size:10px;" title="${item.address}">${item.pincode || ""}</div>
            </td>
            <td>
              <input type="text" class="note-input" data-id="${item.id}" value="${item.crm_notes || ''}" placeholder="Add lead note...">
            </td>
            <td>
              ${item.link ? `<a href="${item.link}" target="_blank" style="color:var(--accent); font-size:14px; text-decoration:none;" title="Open Justdial Listing">🔗</a>` : "-"}
            </td>
          </tr>
        `;
      }).join("");

      this.attachTableRowHandlers();
    },

    attachTableRowHandlers() {
      // Inline Status Change
      document.querySelectorAll(".status-select").forEach(select => {
        select.addEventListener("change", (e) => {
          const leadId = e.target.dataset.id;
          const newStatus = e.target.value;
          this.updateLeadProperty(leadId, { crm_status: newStatus });
          this.showToast(`Lead status updated to ${newStatus}`, "info");
        });
      });

      // Inline Notes Change
      document.querySelectorAll(".note-input").forEach(input => {
        input.addEventListener("change", (e) => {
          const leadId = e.target.dataset.id;
          const newNote = e.target.value;
          this.updateLeadProperty(leadId, { crm_notes: newNote });
          this.showToast("Note saved", "info");
        });
      });

      // WhatsApp Button Click: Auto-mark as "Contacted" if it was "New"
      document.querySelectorAll(".wa-outreach-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const leadId = btn.dataset.id;
          const lead = this.leads.find(l => l.id === leadId);
          if (lead && (!lead.crm_status || lead.crm_status === "New")) {
            this.updateLeadProperty(leadId, { crm_status: "Contacted" });
          }
        });
      });
    },

    async updateLeadProperty(leadId, updates) {
      const st = await chrome.storage.local.get(["scrape_keywords_arr"]);
      const keywordsArr = st.scrape_keywords_arr || [];

      keywordsArr.forEach(kw => {
        if (Array.isArray(kw.result_items_arr)) {
          kw.result_items_arr.forEach(item => {
            if (item.id === leadId) {
              Object.assign(item, updates);
            }
          });
        }
      });

      await chrome.storage.local.set({ scrape_keywords_arr: keywordsArr });
      this.syncState();
    },

    showToast(message, type = "info") {
      const toast = document.getElementById("toast");
      const msgEl = document.getElementById("toast-msg");
      const iconEl = document.getElementById("toast-icon");
      if (!toast || !msgEl) return;

      const icons = {
        success: "✅",
        warning: "⚠️",
        info: "ℹ️"
      };

      iconEl.textContent = icons[type] || "ℹ️";
      msgEl.textContent = message;

      toast.style.display = "flex";
      setTimeout(() => {
        toast.style.display = "none";
      }, 3000);
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    App.init();
  });
})();

