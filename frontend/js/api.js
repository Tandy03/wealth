async function readApiJson(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("The backend is running an older version. Restart the server and try again.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || fallbackMessage);
  return data;
}

const api = {
  async getData() {
    if (window.mobileApi) return window.mobileApi.getData();
    const response = await fetch("/api/data");

    if (!response.ok) {
      throw new Error("Failed to load data.");
    }

    return response.json();
  },

  async getExchangeRates() {
    if (window.mobileApi) {
      const response = await fetch("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json");
      const rows = await response.json();
      const rates = Object.fromEntries(rows.filter((item) => ["USD", "EUR", "GBP"].includes(item.cc)).map((item) => [item.cc, Number(item.rate)]));
      return { rates, exchangeDate: rows[0]?.exchangedate, source: "NBU" };
    }
    const response = await fetch("/api/exchange-rates");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to load NBU exchange rates.");
    return data;
  },

  async getMarketTimeSeries(params) {
    if (window.mobileApi) return window.mobileApi.getMarketTimeSeries(params);
    const query = new URLSearchParams(params);
    const response = await fetch(`/api/market-data/time-series?${query}`);
    return readApiJson(response, "Failed to load market prices.");
  },

  async getMarketCurrencies() {
    const response = await fetch("/api/market-data/currencies");
    return readApiJson(response, "Failed to load NBU currencies.");
  },

  async getCurrencyHistory(params) {
    const query = new URLSearchParams(params);
    const response = await fetch(`/api/market-data/currency-history?${query}`);
    return readApiJson(response, "Failed to load NBU currency history.");
  },

  async getFrankfurterHistory(params) {
    const query = new URLSearchParams(params);
    const response = await fetch(`/api/market-data/frankfurter-history?${query}`);
    return readApiJson(response, "Failed to load Frankfurter exchange-rate history.");
  },

  async getIndexHistory(params) {
    if (window.mobileApi) return window.mobileApi.getIndexHistory(params);
    const query = new URLSearchParams(params);
    const response = await fetch(`/api/market-data/index-history?${query}`);
    return readApiJson(response, "Failed to load index history from FRED.");
  },

  async getMacroeconomics() {
    const response = await fetch("/api/macroeconomics");
    return readApiJson(response, "Failed to load macroeconomic data.");
  },

  async getGoogleDriveStatus() {
    if (window.mobileApi) return window.mobileApi.getGoogleDriveStatus();
    const response = await fetch("/api/sync/status");
    return readApiJson(response, "Failed to load Google Drive status.");
  },

  async syncGoogleDrive(action = "sync") {
    if (window.mobileApi) return window.mobileApi.syncGoogleDrive(action);
    const response = await fetch("/api/sync/google-drive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    return readApiJson(response, "Google Drive operation failed.");
  },

  async getInzhurAssets() {
    if (window.mobileApi) throw new Error("Inzhur catalog sync requires the desktop backend.");
    const response = await fetch("/api/inzhur-assets");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to load the Inzhur catalog.");
    }

    return data;
  },

  async syncInzhurAssets() {
    if (window.mobileApi) throw new Error("API price sync requires the desktop backend.");
    const response = await fetch("/api/assets/sync-inzhur", {
      method: "POST",
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to synchronize Inzhur assets.");
    }

    return data;
  },

  /*
   * ==========================================================
   * ASSETS
   * ==========================================================
   */

  async createAsset(asset) {
    if (window.mobileApi) return window.mobileApi.createAsset(asset);
    const response = await fetch("/api/assets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(asset),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to create asset.");
    }

    return data;
  },

  async updateAsset(id, asset) {
    if (window.mobileApi) return window.mobileApi.updateAsset(id, asset);
    const response = await fetch(`/api/assets/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(asset),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to update asset.");
    }

    return data;
  },

  async mergeAssets(assetIds) {
    if (window.mobileApi) return window.mobileApi.mergeAssets(assetIds);
    const response = await fetch("/api/assets/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to merge duplicate holdings.");
    return data;
  },

  async buyMoreAsset(id, purchase) {
    if (window.mobileApi) return window.mobileApi.buyMoreAsset(id, purchase);
    const response = await fetch(`/api/assets/${id}/buy`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify(purchase),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to buy more asset.");
    }

    return data;
  },

  async deleteAsset(id) {
    if (window.mobileApi) return window.mobileApi.deleteAsset(id);
    const response = await fetch(`/api/assets/${id}`, {
      method: "DELETE",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to delete asset.");
    }

    return data;
  },

  /*
   * ==========================================================
   * SALES
   * ==========================================================
   */

  async getSales() {
    if (window.mobileApi) return window.mobileApi.getSales();
    const response = await fetch("/api/sales");

    if (!response.ok) {
      throw new Error("Failed to load sales.");
    }

    return response.json();
  },

  async createSale(sale) {
    if (window.mobileApi) return window.mobileApi.createSale(sale);
    const response = await fetch("/api/sales", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sale),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to create sale.");
    }

    return data;
  },

  /*
   * ==========================================================
   * TRANSACTIONS
   * ==========================================================
   */

  async getTransactions() {
    if (window.mobileApi) return window.mobileApi.getTransactions();
    const response = await fetch("/api/transactions");

    if (!response.ok) {
      throw new Error("Failed to load transactions.");
    }

    return response.json();
  },

  /*
   * ==========================================================
   * PAYMENTS
   * ==========================================================
   */

  async getPayments() {
    if (window.mobileApi) return window.mobileApi.getPayments();
    const response = await fetch("/api/payments");

    if (!response.ok) {
      throw new Error("Failed to load payments.");
    }

    return response.json();
  },

  async markPaymentReceived(id) {
    if (window.mobileApi) return window.mobileApi.markPaymentReceived(id);
    const response = await fetch(`/api/payments/${id}/received`, {
      method: "PATCH",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to mark payment as received.");
    }

    return data;
  },

  /*
   * ==========================================================
   * CALENDAR NOTES
   * ==========================================================
   */

  async getCalendarNotes() {
    if (window.mobileApi) return window.mobileApi.getCalendarNotes();
    const response = await fetch("/api/calendar-notes");

    if (!response.ok) {
      throw new Error("Failed to load calendar notes.");
    }

    return response.json();
  },

  async createCalendarNote(note) {
    if (window.mobileApi) return window.mobileApi.createCalendarNote(note);
    const response = await fetch("/api/calendar-notes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(note),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to create calendar note.");
    }

    return data;
  },

  async saveWallet(wallet) {
    if (window.mobileApi) return window.mobileApi.saveWallet(wallet);
    const response = await fetch("/api/wallet", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wallet),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to save wallet.");
    return data;
  },
};
