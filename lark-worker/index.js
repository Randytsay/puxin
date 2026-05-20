/**
 * Lark Base Proxy Worker
 * 將前端請求安全地代理到 Lark Base API
 * 
 * 部署方式：
 * 1. 在 Cloudflare Workers 建立新專案
 * 2. 貼上此程式碼
 * 3. 在 Workers Settings 加入環境變數：
 *    LARK_APP_ID = cli_a9761ec37da15eea
 *    LARK_APP_SECRET = (你的 app secret，從 keychain 讀取)
 *    LARK_BASE_TOKEN = UF7Mb2UYaa4r4Oss6ZJllugzgse
 *    LARK_TABLE_ID = tblyaZO8XTTwd7fV
 * 4. 設為 公開 REST API，設定 CORS 允許你的前端網域
 */

const LARK_APP_ID = LARK_APP_ID || "";
const LARK_APP_SECRET = LARK_APP_SECRET || "";
const LARK_BASE_TOKEN = LARK_BASE_TOKEN || "";
const LARK_TABLE_ID = LARK_TABLE_ID || "";

// 快取 token，避免每次请求都重新取得
let cachedToken = null;
let tokenExpiry = 0;

/**
 * 取得 Lark App Access Token
 */
async function getLarkToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  
  const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: LARK_APP_ID, app_secret: LARK_APP_SECRET })
  });
  
  const data = await resp.json();
  if (!data.tenant_access_token) {
    throw new Error("無法取得 Lark Token: " + JSON.stringify(data));
  }
  
  cachedToken = data.tenant_access_token;
  tokenExpiry = Date.now() + (data.expire * 1000) - 60000; // 過期前1分鐘提前刷新
  return cachedToken;
}

/**
 * 查詢記錄（用 group 組別當查詢條件）
 */
async function queryRecords(token, filterGroup) {
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/databases/${LARK_TABLE_ID}/records/search`,
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        filter: {
          conjunction: "and",
          conditions: [
            {
              field_name: "組別",
              operator: "is",
              value: [filterGroup]
            }
          ]
        },
        page_size: 1
      })
    }
  );
  const data = await resp.json();
  if (data.code !== 0 && data.code !== 99991663) {
    // 99991663 = record not found，也算 ok
    throw new Error("查詢失敗: " + JSON.stringify(data));
  }
  return data.data?.records || [];
}

/**
 * 查詢所有已回報的組別
 */
async function queryAllRecords(token) {
  // 先用 aggregation 取得所有組別記錄
  // 分頁取得（最多 500 筆）
  const records = [];
  let page_token = "";
  
  do {
    const body = page_token 
      ? { page_token, page_size: 100 }
      : { page_size: 100 };
    
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/databases/${LARK_TABLE_ID}/records`,
      {
        method: "GET",
        headers: { "Authorization": "Bearer " + token },
        params: body
      }
    );
    const data = await resp.json();
    if (data.code !== 0) throw new Error("取得記錄失敗: " + JSON.stringify(data));
    records.push(...(data.data?.items || []));
    page_token = data.data?.page_token || "";
  } while (page_token);
  
  return records;
}

/**
 * 建立記錄
 */
async function createRecord(token, fields) {
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/databases/${LARK_TABLE_ID}/records`,
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    }
  );
  const data = await resp.json();
  if (data.code !== 0) throw new Error("建立記錄失敗: " + JSON.stringify(data));
  return data.data.record;
}

/**
 * 更新記錄
 */
async function updateRecord(token, recordId, fields) {
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/databases/${LARK_TABLE_ID}/records/${recordId}`,
    {
      method: "PUT",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fields })
    }
  );
  const data = await resp.json();
  if (data.code !== 0) throw new Error("更新記錄失敗: " + JSON.stringify(data));
  return data.data.record;
}

/**
 * 組合 Lark fields 物件
 */
function buildFields(group, report) {
  const now = new Date().toISOString();
  
  const d1Active = report.d1?.active ?? false;
  const d2Active = report.d2?.active ?? false;
  const d1Members = report.d1?.members || [];
  const d2Members = report.d2?.members || [];
  const d1Extra = report.d1?.extraMembers || [];
  const d2Extra = report.d2?.extraMembers || [];

  const fields = {
    "組別": String(group),
    "回報時間": now,
    "更新時間": now,
    "d1參與": d1Active,
    "d1地點代碼": d1Active ? (report.d1.location || "") : "",
    "d1地點名稱": d1Active ? (report.d1.locationName || "") : "",
    "d1集合地點": d1Active ? (report.d1.meet || "") : "",
    "d1人數": d1Active ? (d1Members.length + d1Extra.length) : 0,
    "d1人員": d1Active ? d1Members.join("；") : "",
    "d1其他人員": d1Active ? d1Extra.join("；") : "",
    "d1備註": d1Active ? (report.d1.note || "") : "",
    "d2參與": d2Active,
    "d2地點代碼": d2Active ? (report.d2.location || "") : "",
    "d2地點名稱": d2Active ? (report.d2.locationName || "") : "",
    "d2集合地點": d2Active ? (report.d2.meet || "") : "",
    "d2人數": d2Active ? (d2Members.length + d2Extra.length) : 0,
    "d2人員": d2Active ? d2Members.join("；") : "",
    "d2其他人員": d2Active ? d2Extra.join("；") : "",
    "d2備註": d2Active ? (report.d2.note || "") : ""
  };
  
  return fields;
}

/**
 * 解析 Lark record 為前端格式
 */
function parseRecordToReport(record) {
  const f = record.fields;
  return {
    group: f["組別"] || "",
    d1: {
      active: f["d1參與"] || false,
      location: f["d1地點代碼"] || "",
      locationName: f["d1地點名稱"] || "",
      meet: f["d1集合地點"] || "",
      members: f["d1人員"] ? f["d1人員"].split("；").filter(Boolean) : [],
      extraMembers: f["d1其他人員"] ? f["d1其他人員"].split("；").filter(Boolean) : [],
      note: f["d1備註"] || ""
    },
    d2: {
      active: f["d2參與"] || false,
      location: f["d2地點代碼"] || "",
      locationName: f["d2地點名稱"] || "",
      meet: f["d2集合地點"] || "",
      members: f["d2人員"] ? f["d2人員"].split("；").filter(Boolean) : [],
      extraMembers: f["d2其他人員"] ? f["d2其他人員"].split("；").filter(Boolean) : [],
      note: f["d2備註"] || ""
    },
    timestamp: f["更新時間"] || f["回報時間"] || ""
  };
}

// ============================================================================
// 主 Handler
// ============================================================================
async function handler(request) {
  // CORS 預檢請求
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  // 只允許 POST
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "只支援 POST" }, 405);
  }

  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "JSON 格式錯誤" }, 400);
    }

    const { action, group, report } = body;

    if (!action) {
      return jsonResponse({ ok: false, error: "缺少 action 參數" }, 400);
    }

    const token = await getLarkToken();

    // ── upsertReport ──────────────────────────────────────────────
    if (action === "upsertReport") {
      if (!group || !report) {
        return jsonResponse({ ok: false, error: "缺少 group 或 report" }, 400);
      }

      const fields = buildFields(group, report);

      // 查詢是否已有該組記錄
      const existing = await queryRecords(token, group);

      if (existing.length > 0) {
        // 更新
        const recordId = existing[0].record_id;
        await updateRecord(token, recordId, fields);
        return jsonResponse({ ok: true, action: "updated", group, recordId });
      } else {
        // 新增
        const record = await createRecord(token, fields);
        return jsonResponse({ ok: true, action: "created", group, recordId: record.record_id });
      }
    }

    // ── listReports ──────────────────────────────────────────────
    if (action === "listReports") {
      const records = await queryAllRecords(token);
      const reports = {};
      for (const rec of records) {
        const r = parseRecordToReport(rec);
        if (r.group) reports[r.group] = r;
      }
      return jsonResponse({ ok: true, reports });
    }

    // ── healthCheck ───────────────────────────────────────────────
    if (action === "healthCheck") {
      return jsonResponse({ ok: true, timestamp: new Date().toISOString() });
    }

    return jsonResponse({ ok: false, error: `未知 action: ${action}` }, 400);

  } catch (err) {
    console.error("Worker Error:", err);
    return jsonResponse({ ok: false, error: err.message || "伺服器錯誤" }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export default { fetch: handler };
